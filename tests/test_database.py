import os, tempfile, sqlite3
from monitor.database import PingDatabase

def test_insert_and_stats():
    with tempfile.NamedTemporaryFile() as f:
        db = PingDatabase(f.name)
        db.insert_ping(1000.0, 15.5, False)
        stats = db.get_stats(900.0, 1100.0)
        assert stats["total_pings"] == 1
        assert stats["avg_latency"] == 15.5
