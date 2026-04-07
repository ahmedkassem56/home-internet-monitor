"""Ping daemon for Internet Monitor.

Continuously pings the target host and records results to the database.
Designed to run as a systemd service.
"""

import subprocess
import sys
import time
import signal
import logging
import re
import platform
import urllib.request
import urllib.error
import socket

from monitor.config import load_config
from monitor.database import PingDatabase

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ping-monitor")

# Graceful shutdown flag
_shutdown = False


def _signal_handler(signum, frame):
    global _shutdown
    logger.info(f"Received signal {signum}, shutting down gracefully...")
    _shutdown = True


def parse_ping_output(output: str) -> float | None:
    """Extract latency in ms from ping command output.

    Handles both Linux and macOS ping output formats.
    Returns None if the ping timed out or failed.
    """
    # Linux: "64 bytes from ...: icmp_seq=1 ttl=64 time=1.23 ms"
    # macOS: "64 bytes from ...: icmp_seq=0 ttl=64 time=1.234 ms"
    match = re.search(r"time[=<]\s*([\d.]+)\s*ms", output)
    if match:
        return float(match.group(1))
    return None


def do_ping(target: str, timeout: int, count: int) -> tuple[float | None, bool, int]:
    """Execute a single ping and return (latency_ms, is_timeout, data_used_bytes).

    Returns:
        (latency_ms, False, bytes) on success
        (None, True, bytes) on timeout/failure
    """
    # Build ping command based on OS
    is_linux = platform.system().lower() == "linux"
    cmd = ["ping"]

    if is_linux:
        cmd += ["-c", str(count), "-W", str(timeout), target]
    else:
        # macOS
        cmd += ["-c", str(count), "-t", str(timeout), target]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout + 2,  # Give a bit of extra time beyond the ping timeout
        )

        latency = parse_ping_output(result.stdout)
        if latency is not None:
            return latency, False, 168 * count
        else:
            return None, True, 84 * count

    except subprocess.TimeoutExpired:
        return None, True, 84 * count
    except Exception as e:
        logger.error(f"Ping command failed: {e}")
        return None, True, 0


def do_http_ping(target: str, timeout: int) -> tuple[float | None, bool, int]:
    """Execute a single HTTP GET request and return (latency_ms, is_timeout, data_used_bytes)."""
    if not target.startswith("http://") and not target.startswith("https://"):
        target = "http://" + target

    start_time = time.time()
    try:
        req = urllib.request.Request(target, headers={"User-Agent": "InternetMonitor/1.0"})
        req_size = 400 + len(target)  # Approx TCP handshake + Request headers
        with urllib.request.urlopen(req, timeout=timeout) as response:
            # Read a tiny bit to measure time to first byte + transfer
            response.read(1)
            res_headers = sum(len(k) + len(v) + 4 for k, v in response.headers.items()) if hasattr(response, 'headers') else 300
            res_size = res_headers + 50
        latency_ms = (time.time() - start_time) * 1000.0
        return latency_ms, False, req_size + res_size
    except (urllib.error.URLError, socket.timeout):
        req_size = 400 + len(target)
        return None, True, req_size
    except Exception as e:
        logger.error(f"HTTP request failed: {e}")
        return None, True, 0


def run_cleanup(db: PingDatabase, retention_days: int):
    """Run periodic cleanup of old data."""
    deleted = db.cleanup(retention_days)
    if deleted > 0:
        logger.info(f"Cleanup: removed {deleted} records older than {retention_days} days")


def main():
    """Main entry point for the ping daemon."""
    # Register signal handlers
    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    # Load configuration
    config_path = sys.argv[1] if len(sys.argv) > 1 else None
    config = load_config(config_path)

    target = config["target"]
    mode = config.get("mode", "icmp")
    interval = config["interval"]
    timeout = config["timeout"]
    count = config["count"]
    retention_days = config["retention_days"]

    logger.info(f"Starting Internet Monitor")
    logger.info(f"  Mode: {mode}")
    logger.info(f"  Target: {target}")
    logger.info(f"  Interval: {interval}s")
    logger.info(f"  Timeout: {timeout}s")
    logger.info(f"  Database: {config['database']}")
    logger.info(f"  Retention: {retention_days} days")

    # Initialize database
    db = PingDatabase(config["database"])

    # Cleanup counter — run cleanup every 3600 pings (~1 hour at 1s interval)
    cleanup_interval = max(3600 // interval, 60)
    ping_count = 0
    bytes_used = 0
    log_start_time = time.time()

    logger.info("Monitoring started. Press Ctrl+C to stop.")

    while not _shutdown:
        start_time = time.time()

        # Execute probe
        if mode == "http":
            latency, is_timeout, b_used = do_http_ping(target, timeout)
        else:
            latency, is_timeout, b_used = do_ping(target, timeout, count)
            
        bytes_used += b_used

        # Record result
        db.insert_ping(start_time, latency, is_timeout)

        # Log
        if is_timeout:
            logger.warning(f"TIMEOUT - {target} did not respond within {timeout}s")
        else:
            logger.debug(f"OK - {target} responded in {latency:.2f}ms")

        # Periodic stats logging (every 60 pings)
        ping_count += 1
        if ping_count % 60 == 0:
            stats = db.get_stats(log_start_time, start_time, interval=interval, timeout=timeout)
            timeouts = stats.get("total_timeouts", 0)
            avg = stats.get("avg_latency")
            avg_str = f"{avg:.1f}ms" if avg else "N/A"
            
            # Formulate data statistics
            data_kb = bytes_used / 1024
            
            # If 60 cycles took e.g. 5 minutes because of timeouts, real elapsed diff provides valid math: 
            elapsed_log_time = start_time - log_start_time
            if elapsed_log_time > 0:
                daily_multi = 86400 / elapsed_log_time
            else:
                daily_multi = 86400 / (60 * interval)
                
            daily_mb = (bytes_used * daily_multi) / (1024 * 1024)
            
            logger.info(
                f"Last 60 pings: avg={avg_str}, "
                f"timeouts={timeouts}, "
                f"total={ping_count}, "
                f"data={data_kb:.1f} KB (~{daily_mb:.1f} MB/day calculated from {elapsed_log_time:.1f}s window)"
            )
            bytes_used = 0
            log_start_time = start_time

        # Periodic cleanup
        if ping_count % cleanup_interval == 0:
            run_cleanup(db, retention_days)

        # Sleep for the remaining interval time
        elapsed = time.time() - start_time
        sleep_time = max(0, interval - elapsed)
        if sleep_time > 0 and not _shutdown:
            time.sleep(sleep_time)

    logger.info("Ping monitor stopped.")


if __name__ == "__main__":
    main()
