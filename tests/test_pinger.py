from monitor.pinger import parse_ping_output

def test_parse_linux():
    out = "64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=1.23 ms"
    assert parse_ping_output(out) == 1.23

def test_parse_timeout():
    assert parse_ping_output("Request timeout") is None
