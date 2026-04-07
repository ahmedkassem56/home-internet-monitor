"""SQLite database operations for Internet Monitor."""

import sqlite3
import time
import threading
import os


class PingDatabase:
    """Thread-safe SQLite database for storing ping results."""

    SCHEMA = """
    CREATE TABLE IF NOT EXISTS pings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL NOT NULL,
        latency_ms REAL,
        is_timeout INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_pings_timestamp ON pings(timestamp);
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._local = threading.local()

        # Ensure directory exists
        os.makedirs(os.path.dirname(db_path), exist_ok=True)

        # Initialize schema
        conn = self._get_conn()
        conn.executescript(self.SCHEMA)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.commit()

    def _get_conn(self) -> sqlite3.Connection:
        """Get a thread-local database connection."""
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(self.db_path)
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn

    def insert_ping(self, timestamp: float, latency_ms: float | None, is_timeout: bool):
        """Insert a single ping result."""
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO pings (timestamp, latency_ms, is_timeout) VALUES (?, ?, ?)",
            (timestamp, latency_ms, 1 if is_timeout else 0),
        )
        conn.commit()

    def get_pings(self, start_ts: float, end_ts: float, limit: int = 10000) -> list[dict]:
        """Get raw ping results for a time range."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT timestamp, latency_ms, is_timeout FROM pings "
            "WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp LIMIT ?",
            (start_ts, end_ts, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_downsampled_pings(self, start_ts: float, end_ts: float, bucket_seconds: int) -> list[dict]:
        """Get downsampled ping data, bucketed by time interval.

        Returns avg/min/max latency and timeout count per bucket.
        """
        conn = self._get_conn()
        rows = conn.execute(
            """
            SELECT
                CAST(timestamp / ? AS INTEGER) * ? AS bucket_ts,
                AVG(CASE WHEN is_timeout = 0 THEN latency_ms END) AS avg_latency,
                MIN(CASE WHEN is_timeout = 0 THEN latency_ms END) AS min_latency,
                MAX(CASE WHEN is_timeout = 0 THEN latency_ms END) AS max_latency,
                SUM(is_timeout) AS timeout_count,
                COUNT(*) AS total_count
            FROM pings
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY bucket_ts
            ORDER BY bucket_ts
            """,
            (bucket_seconds, bucket_seconds, start_ts, end_ts),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_stats(self, start_ts: float, end_ts: float, interval: float = 1.0, timeout: float = 5.0) -> dict:
        """Get aggregated statistics for a time range, accurately weighing downtime intervals."""
        conn = self._get_conn()
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS total_pings,
                SUM(is_timeout) AS total_timeouts,
                AVG(CASE WHEN is_timeout = 0 THEN latency_ms END) AS avg_latency,
                MIN(CASE WHEN is_timeout = 0 THEN latency_ms END) AS min_latency,
                MAX(CASE WHEN is_timeout = 0 THEN latency_ms END) AS max_latency
            FROM pings
            WHERE timestamp BETWEEN ? AND ?
            """,
            (start_ts, end_ts),
        ).fetchone()
        result = dict(row)

        # Calculate percentiles (p50, p95, p99)
        successful = conn.execute(
            "SELECT latency_ms FROM pings "
            "WHERE timestamp BETWEEN ? AND ? AND is_timeout = 0 "
            "ORDER BY latency_ms",
            (start_ts, end_ts),
        ).fetchall()

        if successful:
            latencies = [r["latency_ms"] for r in successful]
            n = len(latencies)
            result["p50_latency"] = latencies[int(n * 0.50)]
            result["p95_latency"] = latencies[int(n * 0.95)]
            result["p99_latency"] = latencies[min(int(n * 0.99), n - 1)]
            
            success_pings = result["total_pings"] - result["total_timeouts"]
            uptime_secs = success_pings * interval
            downtime_secs = result["total_timeouts"] * timeout
            total_secs = uptime_secs + downtime_secs
            result["uptime_pct"] = round((uptime_secs / total_secs) * 100, 3) if total_secs > 0 else 100.0
        else:
            result["p50_latency"] = None
            result["p95_latency"] = None
            result["p99_latency"] = None
            result["uptime_pct"] = 100.0

        return result

    def get_hourly_summary(self, start_ts: float, end_ts: float, tz_offset: int = 0) -> list[dict]:
        """Get hourly bucketed summary for heatmap display with timezone offset.

        Returns hour_of_day (0-23), day_of_week (0=Mon, 6=Sun),
        date string, avg latency, and timeout count.
        """
        conn = self._get_conn()
        offset_sec = tz_offset * 60
        rows = conn.execute(
            """
            SELECT
                CAST(strftime('%H', timestamp + ?, 'unixepoch') AS INTEGER) AS hour_of_day,
                CAST(strftime('%w', timestamp + ?, 'unixepoch') AS INTEGER) AS day_of_week,
                strftime('%Y-%m-%d', timestamp + ?, 'unixepoch') AS date_str,
                AVG(CASE WHEN is_timeout = 0 THEN latency_ms END) AS avg_latency,
                MIN(CASE WHEN is_timeout = 0 THEN latency_ms END) AS min_latency,
                MAX(CASE WHEN is_timeout = 0 THEN latency_ms END) AS max_latency,
                SUM(is_timeout) AS timeout_count,
                COUNT(*) AS total_count
            FROM pings
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY date_str, hour_of_day
            ORDER BY date_str, hour_of_day
            """,
            (offset_sec, offset_sec, offset_sec, start_ts, end_ts),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_daily_summary(self, start_ts: float, end_ts: float, tz_offset: int = 0, interval: float = 1.0, timeout: float = 5.0) -> list[dict]:
        """Get daily summary stats accurately weighting downtime."""
        conn = self._get_conn()
        offset_sec = tz_offset * 60
        rows = conn.execute(
            """
            SELECT
                strftime('%Y-%m-%d', timestamp + ?, 'unixepoch') AS date_str,
                COUNT(*) AS total_pings,
                SUM(is_timeout) AS total_timeouts,
                AVG(CASE WHEN is_timeout = 0 THEN latency_ms END) AS avg_latency,
                MIN(CASE WHEN is_timeout = 0 THEN latency_ms END) AS min_latency,
                MAX(CASE WHEN is_timeout = 0 THEN latency_ms END) AS max_latency
            FROM pings
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY date_str
            ORDER BY date_str DESC
            """,
            (offset_sec, start_ts, end_ts),
        ).fetchall()

        results = []
        for row in rows:
            d = dict(row)
            success_pings = d["total_pings"] - d["total_timeouts"]
            if d["total_pings"] > 0:
                uptime_secs = success_pings * interval
                downtime_secs = d["total_timeouts"] * timeout
                total_secs = uptime_secs + downtime_secs
                d["uptime_pct"] = round((uptime_secs / total_secs) * 100, 3) if total_secs > 0 else 100.0
            else:
                d["uptime_pct"] = 100.0
            results.append(d)
        return results

    def get_status(self) -> dict:
        """Get current status — last ping result and recent pings."""
        conn = self._get_conn()
        recent = conn.execute(
            "SELECT timestamp, latency_ms, is_timeout FROM pings "
            "ORDER BY timestamp DESC LIMIT 10"
        ).fetchall()
        recent = [dict(r) for r in recent]

        if recent:
            last = recent[0]
            return {
                "is_up": last["is_timeout"] == 0,
                "last_latency": last["latency_ms"],
                "last_timestamp": last["timestamp"],
                "recent": recent,
            }
        return {
            "is_up": None,
            "last_latency": None,
            "last_timestamp": None,
            "recent": [],
        }

    def cleanup(self, retention_days: int):
        """Delete data older than retention_days."""
        cutoff = time.time() - (retention_days * 86400)
        conn = self._get_conn()
        result = conn.execute("DELETE FROM pings WHERE timestamp < ?", (cutoff,))
        conn.commit()
        return result.rowcount

    def get_db_info(self) -> dict:
        """Get database size and row count info."""
        conn = self._get_conn()
        row_count = conn.execute("SELECT COUNT(*) as cnt FROM pings").fetchone()["cnt"]
        oldest = conn.execute("SELECT MIN(timestamp) as ts FROM pings").fetchone()["ts"]
        newest = conn.execute("SELECT MAX(timestamp) as ts FROM pings").fetchone()["ts"]

        try:
            db_size = os.path.getsize(self.db_path)
        except OSError:
            db_size = 0

        return {
            "row_count": row_count,
            "oldest_timestamp": oldest,
            "newest_timestamp": newest,
            "db_size_bytes": db_size,
            "db_size_mb": round(db_size / (1024 * 1024), 2),
        }
