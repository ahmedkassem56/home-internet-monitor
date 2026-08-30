## Summary

Adds unit tests for the core Python modules. No production code changes.

## Files Added
- `tests/__init__.py` — package marker
- `tests/test_database.py` — SQLite insert + get_stats roundtrip
- `tests/test_config.py` — default config load
- `tests/test_pinger.py` — Linux/timeout ping parser
- `pytest.ini` — sets `testpaths=tests`, `pythonpath=.`

## Files Modified
- `requirements.txt` — pins `pytest==8.3.4`
- `.gitignore` — excludes `.pytest_cache/`, `.coverage`, `htmlcov/`

## Evidence (run on 2026-08-30)

```
$ python3 -m pytest tests/ -v
============================= test session starts ==============================
platform linux -- Python 3.13.5, pytest-8.3.4, pluggy-1.6.0
configfile: pytest.ini
collecting ... collected 4 items

tests/test_config.py::test_load_defaults         PASSED                  [ 25%]
tests/test_database.py::test_insert_and_stats    PASSED                  [ 50%]
tests/test_pinger.py::test_parse_linux           PASSED                  [ 75%]
tests/test_pinger.py::test_parse_timeout         PASSED                  [100%]

============================== 4 passed in 0.07s ===============================
```

## Why these tests first

These exercise the three highest-leverage pure-Python modules (no I/O, no async, no FastAPI):

1. `monitor/database.py` — schema, insertion, aggregation (foundation of all metrics)
2. `monitor/config.py` — YAML loading + env override (deploy-time correctness)
3. `monitor/pinger.py` — `parse_ping_output` regex (Linux/macOS path)

Follow-up PRs can add coverage for `web/app.py` (FastAPI TestClient) and integration tests with a temp DB.

## Notes

- Pinned pytest to a known-good 8.3.x release; same major used by FastAPI test suite.
- Existing `requirements.txt` was already fully version-pinned, so this matches the project's pinning convention.
- No runtime dependency changes.
