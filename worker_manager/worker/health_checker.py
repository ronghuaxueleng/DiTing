"""Worker health check polling."""

import time
import logging
import urllib.request
import urllib.error
import json

from .. import constants

logger = logging.getLogger(__name__)


def wait_for_health(port: int = constants.DEFAULT_WORKER_PORT,
                    timeout: int = constants.WORKER_HEALTH_TIMEOUT,
                    interval: int = constants.WORKER_HEALTH_INTERVAL) -> dict | None:
    """
    Poll the worker /health endpoint until it responds or timeout.
    Returns the health response dict, or None on timeout.
    """
    url = f"http://127.0.0.1:{port}/health"
    deadline = time.time() + timeout

    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
                if data.get("status") == "ok":
                    logger.info(f"Worker healthy: {data}")
                    return data
        except (urllib.error.URLError, ConnectionError, OSError, json.JSONDecodeError):
            pass

        time.sleep(interval)

    logger.warning(f"Worker health check timed out after {timeout}s")
    return None


def check_health(port: int = constants.DEFAULT_WORKER_PORT) -> dict | None:
    """Single health check attempt. Returns response dict or None."""
    url = f"http://127.0.0.1:{port}/health"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None
