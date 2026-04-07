"""FastAPI web server for Internet Monitor dashboard."""

import os
import sys
import time
import secrets

from fastapi import FastAPI, Query, Depends, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from monitor.config import load_config
from monitor.database import PingDatabase

# Load configuration
config_path = sys.argv[1] if len(sys.argv) > 1 else None
config = load_config(config_path)

# Initialize database (read-only usage)
db = PingDatabase(config["database"])

# Auth config
AUTH_USERNAME = config["auth"]["username"]
AUTH_PASSWORD = config["auth"]["password"]

# Create FastAPI app
app = FastAPI(title="Internet Monitor", docs_url=None, redoc_url=None)

# Security
security = HTTPBasic()


def verify_auth(credentials: HTTPBasicCredentials = Depends(security)):
    """Verify HTTP Basic Auth credentials."""
    username_ok = secrets.compare_digest(credentials.username.encode(), AUTH_USERNAME.encode())
    password_ok = secrets.compare_digest(credentials.password.encode(), AUTH_PASSWORD.encode())
    if not (username_ok and password_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials


# ─── Static Files ──────────────────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


@app.get("/", dependencies=[Depends(verify_auth)])
async def serve_dashboard():
    """Serve the main dashboard page."""
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/settings", dependencies=[Depends(verify_auth)])
def api_settings():
    """Return backend configuration settings to the frontend UI."""
    return {
        "mode": config.get("mode", "icmp"),
        "interval": config.get("interval", 1),
        "timeout": config.get("timeout", 5),
    }


# Mount static files with auth not enforced (CSS/JS are non-sensitive)
# but the HTML page itself requires auth via the route above.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ─── Helper ────────────────────────────────────────────────────────────

def parse_range(range_str: str) -> tuple[float, float]:
    """Parse a time range string into (start_ts, end_ts) unix timestamps.

    Supported formats: '1h', '6h', '24h', '7d', '30d', '90d'
    """
    now = time.time()
    multipliers = {"m": 60, "h": 3600, "d": 86400}

    suffix = range_str[-1].lower()
    if suffix in multipliers:
        try:
            value = int(range_str[:-1])
            return now - (value * multipliers[suffix]), now
        except ValueError:
            pass

    raise HTTPException(status_code=400, detail=f"Invalid range format: {range_str}. Use e.g. '1h', '24h', '7d'")


def auto_bucket_seconds(start_ts: float, end_ts: float) -> int:
    """Automatically calculate bucket size for downsampling.

    Target: ~250-500 data points for ultra smooth charts without UI stuttering.
    """
    duration = end_ts - start_ts
    if duration <= 300:        # <= 5 min: raw data (1s)
        return 0
    elif duration <= 3600:     # <= 1 hour: 10s buckets
        return 10
    elif duration <= 21600:    # <= 6 hours: 60s (1m) buckets
        return 60
    elif duration <= 86400:    # <= 24 hours: 4-min buckets
        return 240
    elif duration <= 604800:   # <= 7 days: 30-min buckets
        return 1800
    else:                      # > 7 days: 2-hour buckets
        return 7200


# ─── API Routes ────────────────────────────────────────────────────────

@app.get("/api/status", dependencies=[Depends(verify_auth)])
def api_status():
    """Current status and last 10 pings."""
    return db.get_status()


@app.get("/api/stats", dependencies=[Depends(verify_auth)])
def api_stats(
    range: str = Query("24h", description="Time range: 1h, 6h, 24h, 7d, 30d"),
    start: float = Query(None, description="Custom start timestamp"),
    end: float = Query(None, description="Custom end timestamp"),
):
    """Get aggregated statistics for a time range."""
    if start is not None and end is not None:
        start_ts, end_ts = start, end
    else:
        start_ts, end_ts = parse_range(range)

    interval = config.get("interval", 1)
    timeout = config.get("timeout", 5)
    stats = db.get_stats(start_ts, end_ts, interval=interval, timeout=timeout)
    stats["range"] = range
    stats["start_ts"] = start_ts
    stats["end_ts"] = end_ts
    return stats


@app.get("/api/summary", dependencies=[Depends(verify_auth)])
def api_summary(range: str = Query("30m", description="Time range: 15m, 30m, 1h")):
    """Get a short text summary of performance."""
    start_ts, end_ts = parse_range(range)
    interval = config.get("interval", 1)
    timeout = config.get("timeout", 5)
    stats = db.get_stats(start_ts, end_ts, interval=interval, timeout=timeout)
    
    total = stats.get("total_pings", 0)
    if total == 0:
        return {"summary": "No data available for this period."}
        
    uptime = stats.get("uptime_pct", 100.0)
    avg_lat = stats.get("avg_latency")
    timeouts = stats.get("total_timeouts", 0)
    
    avg_str = f"{avg_lat:.1f}ms" if avg_lat is not None else "N/A"
    
    if timeouts > 0:
        peak = stats.get("max_latency")
        peak_str = f" • Peak {peak:.1f}ms" if peak is not None else ""
        text = f"{uptime}% Uptime • Avg {avg_str}{peak_str} • {timeouts} Timeouts"
    else:
        text = f"100% Uptime • Avg {avg_str} • 0 Timeouts"
        
    return {"summary": text}



@app.get("/api/pings", dependencies=[Depends(verify_auth)])
def api_pings(
    range: str = Query("1h", description="Time range: 1h, 6h, 24h, 7d, 30d"),
    start: float = Query(None, description="Custom start timestamp"),
    end: float = Query(None, description="Custom end timestamp"),
    bucket: int = Query(None, description="Bucket size in seconds (auto if omitted)"),
):
    """Get time-series ping data, auto-downsampled for large ranges."""
    if start is not None and end is not None:
        start_ts, end_ts = start, end
    else:
        start_ts, end_ts = parse_range(range)

    # Determine bucket size
    if bucket is not None:
        bucket_seconds = bucket
    else:
        bucket_seconds = auto_bucket_seconds(start_ts, end_ts)

    if bucket_seconds == 0:
        # Return raw data
        data = db.get_pings(start_ts, end_ts)
    else:
        data = db.get_downsampled_pings(start_ts, end_ts, bucket_seconds)

    return {
        "data": data,
        "bucket_seconds": bucket_seconds,
        "start_ts": start_ts,
        "end_ts": end_ts,
        "count": len(data),
    }


@app.get("/api/hourly", dependencies=[Depends(verify_auth)])
def api_hourly(
    days: int = Query(7, description="Number of days of hourly data"),
    tz: int = Query(0, description="Timezone offset in minutes"),
):
    """Get hourly breakdown for heatmap visualization."""
    now = time.time()
    start_ts = now - (days * 86400)
    data = db.get_hourly_summary(start_ts, now, tz)
    return {"data": data, "days": days}


@app.get("/api/daily", dependencies=[Depends(verify_auth)])
def api_daily(
    days: int = Query(30, description="Number of days"),
    tz: int = Query(0, description="Timezone offset in minutes"),
):
    """Get daily summary statistics."""
    now = time.time()
    start_ts = now - (days * 86400)
    interval = config.get("interval", 1)
    timeout = config.get("timeout", 5)
    data = db.get_daily_summary(start_ts, now, tz, interval=interval, timeout=timeout)
    return {"data": data, "days": days}


@app.get("/api/incidents", dependencies=[Depends(verify_auth)])
def api_incidents(
    days: int = Query(7, description="Number of days to search for incidents")
):
    """Detect and list recent internet degradation incidents."""
    now = time.time()
    start_ts = now - (days * 86400)
    
    # Query 1-minute buckets for precise grouping
    buckets = db.get_downsampled_pings(start_ts, now, bucket_seconds=60)
    
    incidents = []
    current = None
    good_streak = 0
    REQUIRED_GOOD_MINUTES = 3
    
    mode = config.get("mode", "icmp")
    interval = config.get("interval", 1)
    ping_timeout = config.get("timeout", 5)
    lat_threshold = 250 if mode == "http" else 150
    
    for b in buckets:
        ts = b["bucket_ts"]
        tc = b["timeout_count"] or 0
        total = b["total_count"] or 1
        avg_lat = b["avg_latency"] if b["avg_latency"] is not None else 0
        
        success = total - tc
        up_secs = success * interval
        down_secs = tc * ping_timeout
        tot_secs = up_secs + down_secs
        timeout_pct = (down_secs / tot_secs) if tot_secs > 0 else 0
        
        is_bad = timeout_pct >= 0.5 or avg_lat >= lat_threshold
        
        if current is None:
            if is_bad:
                # Start new incident
                itype = "Outage" if timeout_pct >= 0.5 else "High Latency"
                current = {
                    "start_ts": ts,
                    "last_bad_ts": ts,
                    "type": itype,
                    "max_latency": avg_lat,
                    "max_loss": timeout_pct * 100
                }
                good_streak = 0
        else:
            if is_bad:
                current["last_bad_ts"] = ts
                good_streak = 0
                
                # Upgrade severity if necessary
                if timeout_pct >= 0.5 and current["type"] == "High Latency":
                    current["type"] = "Outage"
                if avg_lat > current["max_latency"]:
                    current["max_latency"] = avg_lat
                if (timeout_pct * 100) > current["max_loss"]:
                    current["max_loss"] = timeout_pct * 100
            else:
                good_streak += 1
                if good_streak >= REQUIRED_GOOD_MINUTES:
                    # Resolve incident
                    duration_seconds = (current["last_bad_ts"] + 60) - current["start_ts"]
                    current["duration_minutes"] = max(1, int(duration_seconds / 60))
                    incidents.append(current)
                    current = None
                    good_streak = 0
                    
    # Handle currently ongoing incident
    if current is not None:
        duration_seconds = (current["last_bad_ts"] + 60) - current["start_ts"]
        current["duration_minutes"] = max(1, int(duration_seconds / 60))
        current["ongoing"] = (good_streak == 0)
        incidents.append(current)
            
    # Sort newest first and return top 50
    incidents.sort(key=lambda x: x["start_ts"], reverse=True)
    return {"data": incidents[:50]}


@app.get("/api/info", dependencies=[Depends(verify_auth)])
async def api_info():
    """Get database info and configuration."""
    db_info = db.get_db_info()
    return {
        "target": config["target"],
        "interval": config["interval"],
        "timeout": config["timeout"],
        "retention_days": config["retention_days"],
        "database": db_info,
    }


# ─── Run ───────────────────────────────────────────────────────────────

def main():
    """Run the web server."""
    import uvicorn

    host = config["web"]["host"]
    port = config["web"]["port"]

    print(f"Starting Internet Monitor Dashboard on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
