import re
import json
import requests
import os
import uuid

import httpx

from app.core.logger import logger
from app.services.storage import storage
from app.downloaders._utils import (
    check_and_reraise_cancel,
    safe_cleanup,
    retry_on_network_error,
)

# Mobile Safari UA — required for m.douyin.com share pages
_MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/16.0 Mobile/15E148 Safari/604.1"
)

_DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)


# ── Server-side Douyin extraction (ported from DouyinDL) ──


async def resolve_douyin_short_url(share_text: str) -> str:
    """Extract URL from share text and follow redirects via httpx."""
    url_match = re.search(r"https?://[^\s]+", share_text)
    if url_match:
        share_text = url_match.group(0)

    async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
        resp = await client.get(share_text, headers={"User-Agent": _DESKTOP_UA})
        return str(resp.url)


def extract_aweme_id(url: str) -> str | None:
    """Extract aweme_id from various Douyin URL formats."""
    for pat in [
        r"video/(\d+)",
        r"note/(\d+)",
        r"modal_id=(\d+)",
        r"[?&]vid=(\d+)",
    ]:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return None


async def fetch_douyin_video_data(aweme_id: str) -> dict | None:
    """
    Fetch m.douyin.com mobile share page and parse _ROUTER_DATA JS object.
    No ttwid / a_bogus signatures needed.
    """
    url = f"https://m.douyin.com/share/video/{aweme_id}"
    headers = {"User-Agent": _MOBILE_UA}

    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
        resp = await client.get(url, headers=headers)
        html = resp.text

    match = re.search(
        r"window\._ROUTER_DATA\s*=\s*(\{.+?\})\s*</script>",
        html,
        re.DOTALL,
    )
    if not match:
        logger.warning(f"[Douyin] _ROUTER_DATA not found for aweme_id={aweme_id}")
        return None

    data = json.loads(match.group(1))

    loader = data.get("loaderData", {})
    for val in loader.values():
        if not isinstance(val, dict):
            continue
        res = val.get("videoInfoRes", {})
        items = res.get("item_list", [])
        if items:
            return items[0]

    return None


async def get_douyin_info(url: str) -> dict | None:
    """
    Full extraction: resolve short link → extract ID → fetch data → return info dict.

    Returns:
        {"title", "author", "cover", "direct_url", "aweme_id"} or None on failure.
    """
    try:
        # Step 1: Resolve short link
        resolved_url = await resolve_douyin_short_url(url)
        logger.info(f"[Douyin] Resolved: {url} → {resolved_url}")

        # Step 2: Extract aweme_id
        aweme_id = extract_aweme_id(resolved_url)
        if not aweme_id:
            aweme_id = extract_aweme_id(url)
        if not aweme_id:
            logger.warning(f"[Douyin] Could not extract aweme_id from: {resolved_url}")
            return None

        # Step 3: Fetch video data from mobile page
        detail = await fetch_douyin_video_data(aweme_id)
        if not detail:
            logger.warning(f"[Douyin] No video data for aweme_id={aweme_id}")
            return None

        # Step 4: Extract useful fields
        title = detail.get("desc", "")
        author = detail.get("author", {}).get("nickname", "")

        # Cover: static cover from video.cover.url_list
        cover = ""
        video = detail.get("video", {})
        if video:
            cover_urls = (video.get("cover", {}).get("url_list") or [])
            if cover_urls:
                cover = cover_urls[-1]

        # Direct URL: pick best no-watermark URL
        direct_url = _pick_best_direct_url(detail)

        result = {
            "title": title or f"Douyin {aweme_id}",
            "author": author,
            "cover": cover,
            "direct_url": direct_url,
            "aweme_id": aweme_id,
        }
        logger.info(f"[Douyin] Extracted: title={title[:50]}, author={author}, has_url={bool(direct_url)}")
        return result

    except Exception as e:
        logger.error(f"[Douyin] Extraction failed for {url}: {e}")
        return None


def _pick_best_direct_url(detail: dict) -> str:
    """Pick the best no-watermark CDN URL from video detail."""
    video = detail.get("video", {})
    if not video:
        return ""

    play_addr = video.get("play_addr", {})
    uri = play_addr.get("uri", "")
    url_list = play_addr.get("url_list", [])

    # Priority 1: no-watermark HQ from url_list (playwm → play replacement)
    if url_list:
        wm_url = url_list[0]
        nwm_url = wm_url.replace("playwm", "play")
        if nwm_url != wm_url:
            return nwm_url

    # Priority 2: construct from URI via aweme.snssdk.com
    if uri:
        return (
            f"https://aweme.snssdk.com/aweme/v1/play/"
            f"?video_id={uri}&ratio=1080p&line=0"
        )

    # Priority 3: bit_rate entries
    for br in video.get("bit_rate") or []:
        addr = br.get("play_addr", {})
        br_urls = addr.get("url_list", [])
        if br_urls:
            return br_urls[0].replace("playwm", "play")

    return ""


@retry_on_network_error(max_retries=3, retry_delay=5)
def download_douyin_video(direct_url, referer="https://www.douyin.com/", task_id=None, check_cancel_func=None, progress_callback=None):
    """
    Downloads video from a direct CDN URL provided by the frontend.
    Returns the path to the downloaded file.
    """
    filename = f"{uuid.uuid4()}.mp4"
    output_path = storage.get_temp_download_path(filename)

    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Referer": referer
    }

    logger.info(f"📥 [Douyin] Downloading from CDN: {direct_url[:50]}...")

    if check_cancel_func:
        check_cancel_func(task_id)

    try:
        with requests.get(direct_url, headers=headers, stream=True, timeout=30) as r:
            if r.status_code != 200:
                logger.error(f"❌ [Douyin] Download failed. Status: {r.status_code}")
                return None

            total_size = int(r.headers.get('content-length', 0))
            downloaded = 0

            with open(output_path, 'wb') as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if check_cancel_func:
                        check_cancel_func(task_id)
                    f.write(chunk)
                    downloaded += len(chunk)

                    if total_size > 0 and progress_callback:
                        pct = (downloaded / total_size) * 100
                        progress_callback(task_id, pct, f"Downloading: {int(pct)}%")

        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            logger.info(f"✅ [Douyin] Download saved: {output_path}")
            return output_path
        else:
            logger.error("❌ [Douyin] File not found or empty after download")
            safe_cleanup(output_path)
            return None

    except Exception as e:
        safe_cleanup(output_path)
        check_and_reraise_cancel(e)
        logger.error(f"❌ [Douyin] Exception during download: {e}")
        raise  # Let retry_on_network_error handle it
