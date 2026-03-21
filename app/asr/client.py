
import os
import httpx
import asyncio
from urllib.parse import urlparse
from starlette.concurrency import run_in_threadpool
import time
from typing import List, Dict, Optional, Tuple
from app.core.config import settings
from app.core.logger import logger
from app.db.asr_config import get_active_model_for_engine, get_configured_cloud_engines
from app.db.system_config import get_system_config, set_system_config
import json

CLOUD_ENGINES = {"bailian", "openai_asr"}


def _url_to_worker_id(url: str) -> str:
    """Convert a URL to a stable worker ID.

    http://localhost:8001 → localhost:8001
    http://gpu-server:8001 → gpu-server:8001
    """
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 80
    return f"{host}:{port}"


def _migrate_workers_format(raw: dict) -> dict:
    """Convert old {engine: url} format to new {worker_id: {url, ...}} format.

    Old: {"sensevoice": "http://localhost:8001"}
    New: {"localhost:8001": {"url": "http://localhost:8001"}}
    URL-as-key: {"http://localhost:8001": {}} → {"localhost:8001": {"url": "http://localhost:8001"}}
    """
    if not raw:
        return {}

    # Check if any key looks like a full URL — needs normalization
    has_url_keys = any(k.startswith("http") for k in raw)

    first_val = next(iter(raw.values()))
    if isinstance(first_val, str) and first_val.startswith("http"):
        # Old format: {engine: url} → convert
        migrated = {}
        for engine, url in raw.items():
            worker_id = _url_to_worker_id(url)
            migrated[worker_id] = {"url": url}
        return migrated
    elif isinstance(first_val, dict) and not has_url_keys:
        # Already new format with proper worker_id keys
        return raw

    # URL-as-key or mixed format: normalize all keys
    result = {}
    for key, val in raw.items():
        if key.startswith("http"):
            worker_id = _url_to_worker_id(key)
            result[worker_id] = {"url": key, **(val if isinstance(val, dict) else {})}
        else:
            result[key] = val if isinstance(val, dict) else {"url": str(val)}
    return result


def _migrate_priority(old_priority: list, old_workers: dict, new_workers: dict) -> list:
    """Convert old engine-name priority list to worker_id-based priority list.

    Maps engine names to worker_ids using the old worker URL mapping.
    Cloud engine names pass through unchanged.
    """
    if not old_priority:
        return []

    # Build engine→worker_id mapping from old format
    engine_to_id = {}
    first_val = next(iter(old_workers.values()), None) if old_workers else None
    if isinstance(first_val, str) and first_val.startswith("http"):
        for engine, url in old_workers.items():
            engine_to_id[engine] = _url_to_worker_id(url)

    migrated = []
    for item in old_priority:
        if item in CLOUD_ENGINES:
            migrated.append(item)
        elif item in engine_to_id:
            wid = engine_to_id[item]
            if wid not in migrated:
                migrated.append(wid)
        elif item in new_workers:
            # Already a worker_id
            migrated.append(item)

    return migrated


class ASRClient:
    def __init__(self):
        # workers: {worker_id → metadata dict}
        self.workers: Dict[str, dict] = {}
        self._check_task = None

        # Cloud engines that have at least one model configured in DB
        self._configured_clouds = get_configured_cloud_engines() & CLOUD_ENGINES

        # Runtime Config
        self.config = {
            "priority": [],           # Mix of worker_ids + cloud engine names
            "strict_mode": False,
            "active_engine": None,    # DEPRECATED: kept for backward compat
            "disabled_engines": [],
        }

        # Load persisted config from DB, with format migration
        self._load_config_from_db()

        # If no workers loaded from DB, bootstrap from settings
        if not self.workers:
            raw = dict(settings.ASR_WORKERS)
            self.workers = _migrate_workers_format(raw)

        # Ensure initial priority list
        if not self.config["priority"]:
            self.config["priority"] = list(self.workers.keys())
            for ce in sorted(self._configured_clouds):
                if ce not in self.config["priority"]:
                    self.config["priority"].append(ce)

        # Persist bootstrap defaults if DB is empty
        self._ensure_workers_in_db()

        # Set default active engine for backward compat
        if not self.config.get("active_engine") and self.config["priority"]:
            self.config["active_engine"] = self.config["priority"][0]

        self._init_state()

    def _init_state(self):
        """Initialize runtime state for all workers and cloud engines."""
        for worker_id, meta in self.workers.items():
            meta.setdefault("online", False)
            meta.setdefault("latency", -1.0)
            meta.setdefault("engine", None)
            meta.setdefault("model_id", None)
            meta.setdefault("management", False)
            meta.setdefault("gpu", None)
            meta.setdefault("device", None)
            meta.setdefault("shared_paths", [])
            meta.setdefault("registered", False)

    def register_worker(self, engine: str, url: str, metadata: dict = None) -> dict:
        """Register a worker, return server data paths for shared_paths negotiation."""
        worker_id = _url_to_worker_id(url)
        meta = metadata or {}

        if worker_id in self.workers:
            # Update existing worker
            w = self.workers[worker_id]
            w["url"] = url
            w["engine"] = engine
            w["online"] = True
            w["registered"] = True
            w["management"] = meta.get("management", False)
            if meta.get("gpu"):
                w["gpu"] = meta["gpu"]
            if meta.get("device"):
                w["device"] = meta["device"]
            if meta.get("model_id"):
                w["model_id"] = meta["model_id"]
        else:
            # New worker
            self.workers[worker_id] = {
                "url": url,
                "engine": engine,
                "online": True,
                "latency": -1.0,
                "model_id": meta.get("model_id"),
                "management": meta.get("management", False),
                "gpu": meta.get("gpu"),
                "device": meta.get("device"),
                "shared_paths": [],
                "registered": True,
            }

        # Add to priority if new
        if worker_id not in self.config["priority"]:
            self.config["priority"].append(worker_id)

        self._save_workers_to_db()
        self._save_config_to_db()

        logger.info(f"📋 Worker [{worker_id}] registered from {url} (engine={engine})")
        return {
            "status": "registered",
            "worker_id": worker_id,
            "engine": engine,
            "data_paths": self._get_data_paths(),
        }

    def _get_data_paths(self) -> List[str]:
        """Return server-side data directories for shared_paths negotiation."""
        return [
            str(os.path.abspath(settings.MEDIA_CACHE_DIR)),
            str(os.path.abspath(settings.TEMP_DOWNLOADS_DIR)),
        ]

    def refresh_cloud_engines(self):
        """Re-scan DB for configured cloud engines and update priority/availability."""
        new_clouds = get_configured_cloud_engines() & CLOUD_ENGINES
        added = new_clouds - self._configured_clouds
        removed = self._configured_clouds - new_clouds

        for ce in added:
            if ce not in self.config["priority"]:
                self.config["priority"].append(ce)
            logger.info(f"☁️ Cloud engine [{ce}] added to priority list")

        for ce in removed:
            if ce in self.config["priority"]:
                self.config["priority"].remove(ce)
            if self.config.get("active_engine") == ce:
                self.config["active_engine"] = self.config["priority"][0] if self.config["priority"] else None
            logger.info(f"☁️ Cloud engine [{ce}] removed from priority list")

        self._configured_clouds = new_clouds
        if added or removed:
            self._save_config_to_db()

    def _load_config_from_db(self):
        """Load ASR config from system_configs table, with format migration."""
        try:
            # Worker URLs (overrides bootstrap defaults)
            saved_workers_raw = get_system_config("asr_workers")
            old_workers_raw = None  # Keep reference for priority migration
            if saved_workers_raw:
                old_workers_raw = json.loads(saved_workers_raw)
                migrated = _migrate_workers_format(old_workers_raw)
                self.workers = migrated

                # Check if migration happened (format changed)
                if set(old_workers_raw.keys()) != set(migrated.keys()):
                    self._save_workers_to_db()
                    logger.info(f"Migrated ASR workers format: {list(old_workers_raw.keys())} -> {list(migrated.keys())}")

                logger.info(f"📂 Loaded ASR workers from DB: {list(self.workers.keys())}")

            # Priority
            saved_priority = get_system_config("asr_priority")
            if saved_priority:
                loaded = json.loads(saved_priority)

                # Check if priority needs migration (old format keys differ from migrated)
                needs_migration = False
                if old_workers_raw and loaded:
                    needs_migration = set(old_workers_raw.keys()) != set(self.workers.keys())

                if needs_migration:
                    self.config["priority"] = _migrate_priority(loaded, old_workers_raw, self.workers)
                    self._save_config_to_db()
                    logger.info(f"🔄 Migrated ASR priority to worker_id format: {self.config['priority']}")
                else:
                    # Filter out stale entries
                    valid_keys = set(self.workers.keys()) | self._configured_clouds
                    self.config["priority"] = [e for e in loaded if e in valid_keys]
                    # Add any new entries not in saved list
                    for k in valid_keys:
                        if k not in self.config["priority"]:
                            self.config["priority"].append(k)
                    logger.info(f"📂 Loaded ASR priority from DB: {self.config['priority']}")

            # Strict Mode
            saved_strict = get_system_config("asr_strict_mode")
            if saved_strict is not None:
                self.config["strict_mode"] = saved_strict.lower() == "true"
                logger.info(f"📂 Loaded ASR strict_mode from DB: {self.config['strict_mode']}")

            # Active Engine (deprecated but still loaded for compat)
            saved_engine = get_system_config("asr_active_engine")
            if saved_engine:
                self.config["active_engine"] = saved_engine
                logger.info(f"📂 Loaded ASR active_engine from DB: {self.config['active_engine']}")

            # Disabled Engines
            saved_disabled = get_system_config("asr_disabled_engines")
            if saved_disabled:
                try:
                    self.config["disabled_engines"] = json.loads(saved_disabled)
                    logger.info(f"📂 Loaded ASR disabled_engines from DB: {self.config.get('disabled_engines')}")
                except Exception as e:
                    logger.error(f"❌ Failed to parse disabled_engines: {e}")
                    self.config["disabled_engines"] = []
            else:
                self.config["disabled_engines"] = []

        except Exception as e:
            logger.warning(f"⚠️ Failed to load ASR config from DB: {e}")

    def _ensure_workers_in_db(self):
        """If worker URLs have never been saved to DB yet, persist current (bootstrap) values."""
        try:
            existing = get_system_config("asr_workers")
            if not existing:
                self._save_workers_to_db()
                logger.info("📄 Bootstrap worker URLs persisted to DB")
        except Exception as e:
            logger.warning(f"⚠️ Failed to persist bootstrap workers to DB: {e}")

    def _save_workers_to_db(self):
        """Persist current worker map to DB (only static config, not runtime state)."""
        try:
            # Save only url field (not runtime fields like online, latency, etc.)
            persist = {}
            for wid, meta in self.workers.items():
                persist[wid] = {"url": meta.get("url", "")}
            set_system_config("asr_workers", json.dumps(persist))
        except Exception as e:
            logger.warning(f"⚠️ Failed to save ASR workers to DB: {e}")

    def _save_config_to_db(self):
        """Save ASR config to system_configs table."""
        try:
            set_system_config("asr_priority", json.dumps(self.config["priority"]))
            set_system_config("asr_strict_mode", str(self.config["strict_mode"]).lower())
            set_system_config("asr_disabled_engines", json.dumps(self.config.get("disabled_engines", [])))
            if self.config["active_engine"]:
                set_system_config("asr_active_engine", self.config["active_engine"])
            logger.info(f"💾 Saved ASR config to DB")
        except Exception as e:
            logger.warning(f"⚠️ Failed to save ASR config to DB: {e}")

    async def check_health(self):
        """Perform a single health check pass for all workers."""
        worker_ids = list(self.workers.keys())

        async def check_one(worker_id: str):
            worker = self.workers[worker_id]
            url = worker.get("url", "")
            if not url:
                return

            start = time.time()
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    resp = await client.get(f"{url}/health")
                    duration = (time.time() - start) * 1000
                    is_ok = resp.status_code == 200

                    was_online = worker.get("online", False)
                    if is_ok != was_online:
                        if is_ok:
                            logger.info(f"🟢 ASR Worker [{worker_id}] is ONLINE ({duration:.0f}ms)")
                        else:
                            logger.warning(f"🔴 ASR Worker [{worker_id}] is OFFLINE")

                    worker["online"] = is_ok
                    worker["latency"] = duration if is_ok else -1.0

                    if is_ok:
                        try:
                            data = resp.json()
                            # Update dynamic fields from worker's health response
                            worker["engine"] = data.get("engine")
                            worker["model_id"] = data.get("model_id")
                            worker["management"] = data.get("management", False)
                            worker["shared_paths"] = data.get("shared_paths", [])
                            if data.get("gpu"):
                                worker["gpu"] = data["gpu"]
                            if data.get("device"):
                                worker["device"] = data["device"]
                        except Exception:
                            pass
            except Exception:
                was_online = worker.get("online", False)
                if was_online:
                    logger.warning(f"🔴 ASR Worker [{worker_id}] Connection Failed")
                worker["online"] = False
                worker["latency"] = -1.0

        await asyncio.gather(*(check_one(wid) for wid in worker_ids))

    async def start_health_check(self, interval: int = 30):
        """Background task Loop"""
        logger.info("💓 Starting ASR Worker Health Check...")
        while True:
            await self.check_health()
            await asyncio.sleep(interval)

    def get_status(self) -> Dict:
        """Return current status of all workers and clouds, plus wizard state."""
        # Workers
        workers_status = {}
        for worker_id, meta in self.workers.items():
            workers_status[worker_id] = {
                "url": meta.get("url", ""),
                "engine": meta.get("engine"),
                "model_id": meta.get("model_id"),
                "online": meta.get("online", False),
                "latency": meta.get("latency", -1),
                "management": meta.get("management", False),
                "gpu": meta.get("gpu"),
                "device": meta.get("device"),
                "shared_paths": meta.get("shared_paths", []),
                "registered": meta.get("registered", False),
            }

        # Clouds
        clouds_status = {}
        for ce in self._configured_clouds:
            badge = ""
            try:
                db_cfg = get_active_model_for_engine(ce)
                if db_cfg:
                    cfg = json.loads(db_cfg.get("config", "{}"))
                    badge = cfg.get("badge", "") or db_cfg.get("name", "")
            except Exception:
                pass
            clouds_status[ce] = {
                "online": True,
                "badge": badge,
            }

        # Build backward-compat `engines` field
        engines_compat = {}
        for worker_id, info in workers_status.items():
            engines_compat[worker_id] = {
                "type": "worker",
                **info,
            }
        for ce, info in clouds_status.items():
            engines_compat[ce] = {
                "type": "cloud",
                "latency": 0,
                **info,
            }

        return {
            "workers": workers_status,
            "clouds": clouds_status,
            "wizard_state": settings.WIZARD_COMPLETED,  # New flag
            "engines": engines_compat,  # DEPRECATED: backward compat
            "config": self.config,
        }

    def update_config(self, priority: List[str] = None, strict_mode: bool = None, active_engine: str = None, disabled_engines: List[str] = None):
        """Update runtime config."""
        if priority is not None:
            # Validate entries exist (worker_ids or cloud engine names)
            valid_keys = set(self.workers.keys()) | self._configured_clouds
            valid_prio = [e for e in priority if e in valid_keys]
            # Add missing entries to end
            for k in valid_keys:
                if k not in valid_prio:
                    valid_prio.append(k)
            self.config["priority"] = valid_prio

        if strict_mode is not None:
            self.config["strict_mode"] = strict_mode

        if active_engine is not None:
            if active_engine in self.workers or active_engine in self._configured_clouds:
                self.config["active_engine"] = active_engine

        if disabled_engines is not None:
            self.config["disabled_engines"] = disabled_engines

        logger.info(f"⚙️ ASR Config Updated: {self.config}")
        self._save_config_to_db()

    def update_workers(self, workers: dict):
        """Replace the full worker URL map at runtime.

        Accepts both new format {worker_id: {url}} and old format {engine: url}.
        Also accepts URL-as-key format {url: {}}.
        """
        new_workers = _migrate_workers_format(workers)
        old_ids = set(self.workers.keys())
        new_ids = set(new_workers.keys())

        # Merge: new workers get default state
        for wid in new_ids - old_ids:
            new_workers[wid].setdefault("online", False)
            new_workers[wid].setdefault("latency", -1.0)
            new_workers[wid].setdefault("engine", None)
            new_workers[wid].setdefault("model_id", None)
            new_workers[wid].setdefault("management", False)
            new_workers[wid].setdefault("gpu", None)
            new_workers[wid].setdefault("device", None)
            new_workers[wid].setdefault("shared_paths", [])
            new_workers[wid].setdefault("registered", False)
            if wid not in self.config["priority"]:
                self.config["priority"].append(wid)
            logger.info(f"➕ Worker [{wid}] added")

        for wid in old_ids - new_ids:
            if wid in self.config["priority"]:
                self.config["priority"].remove(wid)
            if self.config.get("active_engine") == wid:
                self.config["active_engine"] = self.config["priority"][0] if self.config["priority"] else None
            logger.info(f"➖ Worker [{wid}] removed")

        # Preserve runtime state for existing workers
        for wid in new_ids & old_ids:
            old_meta = self.workers[wid]
            new_meta = new_workers[wid]
            new_meta["url"] = new_meta.get("url", old_meta.get("url", ""))
            # Carry forward runtime state
            for key in ("online", "latency", "engine", "model_id", "management", "gpu", "device", "shared_paths", "registered"):
                new_meta.setdefault(key, old_meta.get(key))

        self.workers = new_workers
        self._save_workers_to_db()
        self._save_config_to_db()
        logger.info(f"⚙️ ASR Workers Updated: {list(self.workers.keys())}")

    def add_worker(self, url: str):
        """Add a single worker URL at runtime."""
        worker_id = _url_to_worker_id(url)
        if worker_id not in self.workers:
            self.workers[worker_id] = {
                "url": url,
                "online": False,
                "latency": -1.0,
                "engine": None,
                "model_id": None,
                "management": False,
                "gpu": None,
                "device": None,
                "shared_paths": [],
                "registered": False,
            }
            if worker_id not in self.config["priority"]:
                self.config["priority"].append(worker_id)
            self._save_workers_to_db()
            self._save_config_to_db()
            logger.info(f"➕ Worker [{worker_id}] added at {url}")
        else:
            # Update URL if changed
            self.workers[worker_id]["url"] = url
            self._save_workers_to_db()

    def remove_worker(self, worker_id: str):
        """Remove a single worker by worker_id at runtime."""
        if worker_id not in self.workers:
            raise ValueError(f"Worker '{worker_id}' not found")

        del self.workers[worker_id]
        if worker_id in self.config["priority"]:
            self.config["priority"].remove(worker_id)
        if self.config.get("active_engine") == worker_id:
            self.config["active_engine"] = self.config["priority"][0] if self.config["priority"] else None

        self._save_workers_to_db()
        self._save_config_to_db()
        logger.info(f"➖ Worker [{worker_id}] removed")

    def select_worker(self, preferred_engine: str = None) -> Tuple[str, str]:
        """Select the best available worker.

        Returns: (worker_id_or_cloud_name, engine_name)

        For cloud engines: returns (cloud_name, cloud_name), e.g. ("bailian", "bailian")
        For workers: returns (worker_id, engine_name), e.g. ("localhost:8001", "sensevoice")
        """
        disabled_list = self.config.get("disabled_engines", [])

        # Priority 1: Preferred engine override (always allow if available)
        if preferred_engine:
            # Check cloud engines first
            if preferred_engine in CLOUD_ENGINES and preferred_engine in self._configured_clouds:
                return (preferred_engine, preferred_engine)

            # Find a worker running the preferred engine
            for wid, meta in self.workers.items():
                if meta.get("engine") == preferred_engine and meta.get("online", False):
                    return (wid, preferred_engine)

            # Also check if preferred_engine is actually a worker_id
            if preferred_engine in self.workers:
                w = self.workers[preferred_engine]
                if w.get("online", False) and w.get("engine"):
                    return (preferred_engine, w["engine"])

            raise RuntimeError(f"Engine '{preferred_engine}' is offline or not available.")

        strict = self.config.get("strict_mode", False)
        active = self.config.get("active_engine")

        # Priority 2: Strict Mode
        if strict and active:
            # Active could be a worker_id or cloud name
            if active in CLOUD_ENGINES and active in self._configured_clouds:
                return (active, active)
            if active in self.workers:
                w = self.workers[active]
                if w.get("online", False) and w.get("engine"):
                    return (active, w["engine"])
            raise RuntimeError(f"Strict Mode: Active engine '{active}' is offline.")

        # Priority 3: Walk priority list (skip disabled)
        for item in self.config["priority"]:
            if item in disabled_list:
                continue

            # Cloud engine?
            if item in CLOUD_ENGINES:
                if item in self._configured_clouds:
                    return (item, item)
                continue

            # Worker?
            if item in self.workers:
                w = self.workers[item]
                if w.get("online", False) and w.get("engine"):
                    return (item, w["engine"])

        # Fallback: any online worker with a loaded engine
        for wid, meta in self.workers.items():
            if meta.get("online", False) and meta.get("engine"):
                return (wid, meta["engine"])

        raise RuntimeError("No available ASR engines (checked priority list and skipped disabled ones).")

    def _is_localhost(self, worker_id: str) -> bool:
        """Check if a worker URL points to localhost."""
        meta = self.workers.get(worker_id, {})
        url = meta.get("url", "")
        try:
            parsed = urlparse(url)
            host = parsed.hostname or ""
            return host in ("localhost", "127.0.0.1", "::1", "0.0.0.0")
        except Exception:
            return False

    def _resolve_path_mode(self, worker_id: str, audio_path: str) -> tuple:
        """Determine if path mode can be used, and resolve the mapped path."""
        # Localhost = same machine, always path mode
        if self._is_localhost(worker_id):
            return True, audio_path

        meta = self.workers.get(worker_id, {})
        worker_paths = meta.get("shared_paths", [])
        if not worker_paths:
            return False, audio_path

        norm_audio = os.path.normpath(os.path.abspath(audio_path))

        for sp in worker_paths:
            if isinstance(sp, dict):
                server_prefix = os.path.normpath(os.path.abspath(sp.get("server", "")))
                worker_prefix = sp.get("worker", "")
            else:
                server_prefix = os.path.normpath(os.path.abspath(str(sp)))
                worker_prefix = str(sp)

            if norm_audio.startswith(server_prefix + os.sep) or norm_audio == server_prefix:
                relative = norm_audio[len(server_prefix):]
                mapped = worker_prefix + relative.replace("\\", "/")
                return True, mapped

        return False, audio_path

    async def transcribe(self, audio_path: str, engine: str = None, language: str = "zh", prompt: str = None, output_format: str = "text") -> str:
        """Transcribe audio using selected engine."""
        try:
            selected_id, selected_engine = self.select_worker(engine)
        except RuntimeError as e:
            logger.error(f"❌ ASR Selection Failed: {e}")
            raise e

        engine_key = selected_engine.lower()
        logger.info(f"🎤 Transcribing with [{engine_key}] via [{selected_id}] (Requested: {engine})")

        # 1. Cloud Engines
        if engine_key == "bailian":
            from app.asr.cloud import BaiLianASREngine

            db_config = get_active_model_for_engine("bailian")
            api_key = None
            model_name = "paraformer-realtime-v2"

            if db_config:
                try:
                    cfg = json.loads(db_config["config"])
                    api_key = cfg.get("api_key")
                    model_name = cfg.get("model_name", model_name)
                    logger.info(f"☁️ Using Bailian Config: {model_name} (ID: {db_config['id']})")
                except Exception as e:
                    logger.error(f"❌ Failed to parse Bailian config: {e}")

            cloud_engine = BaiLianASREngine(api_key=api_key, model_name=model_name)
            if output_format == "srt":
                return await run_in_threadpool(cloud_engine.generate_srt, audio_path, language, prompt)
            else:
                return await run_in_threadpool(cloud_engine.predict, audio_path, language, prompt)

        if engine_key == "openai_asr":
            from app.asr.openai_asr import OpenAIASREngine

            db_config = get_active_model_for_engine("openai_asr")
            api_key = None
            base_url = "https://api.openai.com/v1"
            model_name = "whisper-1"

            if db_config:
                try:
                    cfg = json.loads(db_config["config"])
                    api_key = cfg.get("api_key")
                    base_url = cfg.get("base_url", base_url)
                    model_name = cfg.get("model_name", model_name)
                    logger.info(f"☁️ Using OpenAI ASR Config: {model_name} @ {base_url} (ID: {db_config['id']})")
                except Exception as e:
                    logger.error(f"❌ Failed to parse OpenAI ASR config: {e}")

            cloud_engine = OpenAIASREngine(api_key=api_key, base_url=base_url, model_name=model_name)
            if output_format == "srt":
                return await run_in_threadpool(cloud_engine.generate_srt, audio_path, language, prompt)
            else:
                return await run_in_threadpool(cloud_engine.predict, audio_path, language, prompt)

        # 2. Worker Engines — use worker_id to get URL
        worker = self.workers.get(selected_id)
        if not worker:
            raise RuntimeError(f"Worker '{selected_id}' not found")
        url = worker["url"]

        can_path, resolved_path = self._resolve_path_mode(selected_id, audio_path)
        if can_path:
            payload = {
                "audio_path": resolved_path,
                "language": language,
                "prompt": prompt or "",
                "output_format": output_format
            }
            logger.info(f"📡 Calling Worker [{selected_id}] -> {url}/transcribe (path mode)")
            if resolved_path != audio_path:
                logger.info(f"   Path mapped: {audio_path} -> {resolved_path}")

            async with httpx.AsyncClient(timeout=7200.0) as client:
                resp = await client.post(f"{url}/transcribe", json=payload)
                if resp.status_code != 200:
                    raise RuntimeError(f"Worker Error {resp.status_code}: {resp.text}")
                data = resp.json()
                return data["text"]
        else:
            if not self._is_localhost(selected_id):
                logger.warning(f"⚠️ No shared_path matched for '{audio_path}', falling back to upload mode (slower)")
            filename = os.path.basename(audio_path)
            logger.info(f"📤 Uploading to Worker [{selected_id}] -> {url}/transcribe (upload mode, file={filename})")

            async with httpx.AsyncClient(timeout=7200.0) as client:
                with open(audio_path, "rb") as f:
                    resp = await client.post(
                        f"{url}/transcribe",
                        files={"file": (filename, f, "application/octet-stream")},
                        data={
                            "language": language,
                            "prompt": prompt or "",
                            "output_format": output_format
                        }
                    )
                if resp.status_code != 200:
                    raise RuntimeError(f"Worker Error {resp.status_code}: {resp.text}")
                data = resp.json()
                return data["text"]

    async def proxy_management(self, worker_key: str, method: str, path: str, body=None) -> dict:
        """Proxy a management API call to a worker.

        Args:
            worker_key: Worker ID (e.g. "localhost:8001")
            method: HTTP method (GET, POST, DELETE)
            path: Path under /management/ on the worker
            body: Optional JSON body for POST/DELETE
        """
        worker = self.workers.get(worker_key)
        if not worker:
            raise ValueError(f"Worker '{worker_key}' not found")

        if not worker.get("online", False):
            raise RuntimeError(f"Worker '{worker_key}' is offline")

        url = worker["url"]
        target = f"{url}/management/{path.lstrip('/')}"
        logger.info(f"Proxying {method} {target}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            if method.upper() == "GET":
                resp = await client.get(target)
            elif method.upper() == "POST":
                resp = await client.post(target, json=body)
            elif method.upper() == "DELETE":
                resp = await client.delete(target, json=body)
            else:
                raise ValueError(f"Unsupported method: {method}")

            if resp.status_code >= 400:
                raise RuntimeError(f"Worker returned HTTP {resp.status_code}: {resp.text}")

            return resp.json()

asr_client = ASRClient()
