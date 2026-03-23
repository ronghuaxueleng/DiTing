from __future__ import annotations

from datetime import datetime, timezone

UTC = timezone.utc
LOCAL_TZ = datetime.now().astimezone().tzinfo or UTC


def now_local() -> datetime:
    return datetime.now(LOCAL_TZ)


def now_local_sqlite() -> str:
    return now_local().strftime("%Y-%m-%d %H:%M:%S")


def parse_datetime(value) -> datetime | None:
    if value is None:
        return None

    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None

        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"

        if " " in text and "T" not in text:
            dt = datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
        else:
            dt = datetime.fromisoformat(text)

    if dt.tzinfo is None:
        return dt.replace(tzinfo=LOCAL_TZ)

    return dt


def format_datetime_iso(value, *, to_utc: bool = False) -> str | None:
    dt = parse_datetime(value)
    if dt is None:
        return None

    if to_utc:
        dt = dt.astimezone(UTC)

    return dt.isoformat().replace("+00:00", "Z")


def normalize_cache_expires_at(value) -> str | None:
    return format_datetime_iso(value, to_utc=True)
