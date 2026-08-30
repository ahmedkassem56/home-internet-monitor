import pytest, yaml, tempfile, os, sys
sys.path.insert(0, "/home/hermes/projects/home-internet-monitor")
from monitor.config import load_config

def test_load_defaults():
    cfg = load_config()
    assert cfg["mode"] == "icmp"
    assert cfg["interval"] == 1
