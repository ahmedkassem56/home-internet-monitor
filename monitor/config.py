"""Configuration loader for Internet Monitor."""

import copy
import os
import yaml


DEFAULT_CONFIG = {
    "mode": "icmp",
    "target": "10.200.0.2",
    "interval": 1,
    "timeout": 3,
    "count": 1,
    "database": "/opt/internet-monitor/data/pings.db",
    "retention_days": 90,
    "web": {
        "host": "0.0.0.0",
        "port": 8080,
    },
    "auth": {
        "username": "admin",
        "password": "changeme",
    },
}


def load_config(path: str = None) -> dict:
    """Load configuration from YAML file, falling back to defaults.

    Priority: config file values > environment variables > defaults.
    """
    config = copy.deepcopy(DEFAULT_CONFIG)

    # Determine config path
    if path is None:
        path = os.environ.get(
            "MONITOR_CONFIG",
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.yaml"),
        )

    # Load from file
    if os.path.exists(path):
        with open(path, "r") as f:
            file_config = yaml.safe_load(f) or {}
        config = _deep_merge(config, file_config)

    # Environment variable overrides
    env_map = {
        "MONITOR_MODE": ("mode", str),
        "MONITOR_TARGET": ("target", str),
        "MONITOR_INTERVAL": ("interval", int),
        "MONITOR_TIMEOUT": ("timeout", int),
        "MONITOR_COUNT": ("count", int),
        "MONITOR_DATABASE": ("database", str),
        "MONITOR_RETENTION_DAYS": ("retention_days", int),
        "MONITOR_WEB_HOST": ("web.host", str),
        "MONITOR_WEB_PORT": ("web.port", int),
        "MONITOR_AUTH_USERNAME": ("auth.username", str),
        "MONITOR_AUTH_PASSWORD": ("auth.password", str),
    }

    for env_var, (key_path, type_fn) in env_map.items():
        value = os.environ.get(env_var)
        if value is not None:
            keys = key_path.split(".")
            obj = config
            for k in keys[:-1]:
                obj = obj[k]
            obj[keys[-1]] = type_fn(value)

    return config


def _deep_merge(base: dict, override: dict) -> dict:
    """Deep merge override into base dict."""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result
