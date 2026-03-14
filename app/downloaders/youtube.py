import yt_dlp
import os
import uuid
import tempfile
from app.core.logger import logger
from app.core.config import settings
from app.services.storage import storage
from app.downloaders._utils import (
    make_progress_hook,
    find_downloaded_file,
    get_video_format_string,
    check_and_reraise_cancel,
    safe_cleanup,
    retry_on_network_error,
)


def _get_youtube_cookies():
    """Read YouTube cookies text from system config, write to temp file for yt-dlp."""
    from app.db import get_system_config
    cookie_text = get_system_config('youtube_cookies')
    if not cookie_text or not cookie_text.strip():
        return None
    try:
        tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8')
        tmp.write(cookie_text)
        tmp.close()
        return tmp.name
    except Exception as e:
        logger.warning(f"⚠️ Failed to create YouTube cookie file: {e}")
        return None


def _cleanup_cookie_file(cookie_file):
    """Remove temporary cookie file."""
    if cookie_file:
        try:
            os.remove(cookie_file)
        except OSError:
            pass


def _is_format_error(e):
    """Check if an exception is a yt-dlp format availability error (often caused by bad cookies)."""
    msg = str(e).lower()
    return 'requested format is not available' in msg


def get_youtube_info(url, proxy=None):
    """
    Fetch metadata for a YouTube video.
    If cookies cause a format error, automatically retries without cookies.
    """
    cookie_file = _get_youtube_cookies()
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'ignore_no_formats_error': True,
        'proxy': proxy,
    }
    if cookie_file:
        ydl_opts['cookiefile'] = cookie_file

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                'title': info.get('title'),
                'cover': info.get('thumbnail'),
                'duration': info.get('duration'),
                'uploader': info.get('uploader'),
                'description': info.get('description'),
                'view_count': info.get('view_count'),
                'id': info.get('id')
            }
    except Exception as e:
        # If cookies caused format error, retry without cookies
        if cookie_file and _is_format_error(e):
            logger.warning(f"⚠️ yt-dlp format error with cookies (original error: {e}), retrying without cookies...")
            _cleanup_cookie_file(cookie_file)
            cookie_file = None
            try:
                ydl_opts.pop('cookiefile', None)
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    return {
                        'title': info.get('title'),
                        'cover': info.get('thumbnail'),
                        'duration': info.get('duration'),
                        'uploader': info.get('uploader'),
                        'description': info.get('description'),
                        'view_count': info.get('view_count'),
                        'id': info.get('id')
                    }
            except Exception as e2:
                logger.error(f"❌ yt-dlp Info Fetch Error (no cookies): {e2}")
                return None
        logger.error(f"❌ yt-dlp Info Fetch Error: {e}")
        return None
    finally:
        _cleanup_cookie_file(cookie_file)


def download_youtube_video(url, output_dir=None, proxy=None, task_id=None, check_cancel_func=None, progress_callback=None):
    """
    Download YouTube video as audio (m4a/best audio) for ASR.
    Returns the absolute path to the downloaded file.
    """
    if output_dir is None:
        output_dir = settings.TEMP_DOWNLOADS_DIR

    filename_base = str(uuid.uuid4())
    output_template = os.path.join(output_dir, f"{filename_base}.%(ext)s")

    cookie_file = _get_youtube_cookies()
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': output_template,
        'quiet': True,
        'no_warnings': True,
        'proxy': proxy,
        'progress_hooks': [make_progress_hook(task_id, check_cancel_func, progress_callback)],
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'm4a',
        }],
    }
    if cookie_file:
        ydl_opts['cookiefile'] = cookie_file

    @retry_on_network_error(max_retries=3, retry_delay=5)
    def _do_download():
        if check_cancel_func:
            check_cancel_func(task_id)
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            logger.info(f"📥 Downloading YouTube: {url} (Proxy: {proxy})")
            ydl.extract_info(url, download=True)
        return find_downloaded_file(output_dir, filename_base, '.m4a')

    try:
        return _do_download()
    except Exception as e:
        check_and_reraise_cancel(e)
        # Retry without cookies on format error
        if cookie_file and _is_format_error(e):
            logger.warning(f"⚠️ yt-dlp format error with cookies, retrying without cookies...")
            _cleanup_cookie_file(cookie_file)
            cookie_file = None
            ydl_opts.pop('cookiefile', None)
            # Need new filename since old attempt may have partial files
            filename_base2 = str(uuid.uuid4())
            ydl_opts['outtmpl'] = os.path.join(output_dir, f"{filename_base2}.%(ext)s")
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.extract_info(url, download=True)
                return find_downloaded_file(output_dir, filename_base2, '.m4a')
            except Exception as e2:
                check_and_reraise_cancel(e2)
                logger.error(f"❌ yt-dlp Download Error (no cookies): {e2}")
                return None
        logger.error(f"❌ yt-dlp Download Error: {e}")
        return None
    finally:
        _cleanup_cookie_file(cookie_file)


def download_youtube_media(url, quality='best', output_dir=None, proxy=None, task_id=None, check_cancel_func=None, progress_callback=None):
    """
    Download YouTube video (video+audio).
    Returns the absolute path to the downloaded file (.mp4).
    """
    if output_dir is None:
        output_dir = settings.TEMP_DOWNLOADS_DIR

    filename_base = str(uuid.uuid4())
    output_template = os.path.join(output_dir, f"{filename_base}.%(ext)s")

    cookie_file = _get_youtube_cookies()
    ydl_opts = {
        'format': get_video_format_string(quality),
        'outtmpl': output_template,
        'merge_output_format': 'mp4',
        'quiet': True,
        'no_warnings': True,
        'proxy': proxy,
        'progress_hooks': [make_progress_hook(task_id, check_cancel_func, progress_callback, label="Downloading Video")],
    }
    if cookie_file:
        ydl_opts['cookiefile'] = cookie_file

    @retry_on_network_error(max_retries=3, retry_delay=5)
    def _do_download():
        if check_cancel_func:
            check_cancel_func(task_id)
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            logger.info(f"📥 Downloading YouTube Video: {url} (Proxy: {proxy})")
            ydl.extract_info(url, download=True)
        return find_downloaded_file(output_dir, filename_base, '.mp4')

    try:
        return _do_download()
    except Exception as e:
        check_and_reraise_cancel(e)
        # Retry without cookies on format error
        if cookie_file and _is_format_error(e):
            logger.warning(f"⚠️ yt-dlp format error with cookies, retrying without cookies...")
            _cleanup_cookie_file(cookie_file)
            cookie_file = None
            ydl_opts.pop('cookiefile', None)
            filename_base2 = str(uuid.uuid4())
            ydl_opts['outtmpl'] = os.path.join(output_dir, f"{filename_base2}.%(ext)s")
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.extract_info(url, download=True)
                return find_downloaded_file(output_dir, filename_base2, '.mp4')
            except Exception as e2:
                check_and_reraise_cancel(e2)
                logger.error(f"❌ yt-dlp Video Download Error (no cookies): {e2}")
                return None
        logger.error(f"❌ yt-dlp Video Download Error: {e}")
        return None
    finally:
        _cleanup_cookie_file(cookie_file)


def download_youtube_subtitles(url, output_dir=None, proxy=None, language='zh'):
    """
    Attempt to download subtitles for a YouTube video.
    Logic: 
    1. Prefer Manual Subtitles > Auto-generated
    2. Prefer Chinese (zh-Hans, zh-CN, zh, zh-TW, zh-Hant) > English (en, en-US, en-GB) > Any
    Returns: (path_to_subtitle_file, subtitle_content_string) or (None, None)
    """
    if output_dir is None:
        output_dir = settings.TEMP_DOWNLOADS_DIR

    filename_base = str(uuid.uuid4())
    output_template = os.path.join(output_dir, f"{filename_base}")  # yt-dlp appends .lang.srt

    # Priority lists
    zh_langs = ['zh-Hans', 'zh-CN', 'zh', 'zh-TW', 'zh-Hant']
    en_langs = ['en', 'en-US', 'en-GB']

    cookie_file = _get_youtube_cookies()
    try:
        result = _download_subtitles_inner(url, output_dir, proxy, cookie_file, filename_base, output_template, zh_langs, en_langs)
        if result:
            return result
        
        # If failed with cookies, retry without
        if cookie_file:
            logger.warning(f"⚠️ Subtitle fetch failed with cookies, retrying without cookies...")
            _cleanup_cookie_file(cookie_file)
            cookie_file = None
            filename_base = str(uuid.uuid4())
            output_template = os.path.join(output_dir, f"{filename_base}")
            result = _download_subtitles_inner(url, output_dir, proxy, None, filename_base, output_template, zh_langs, en_langs)
            if result:
                return result

        return None, None

    except Exception as e:
        logger.error(f"❌ Subtitle download error: {e}")
        return None, None
    finally:
        _cleanup_cookie_file(cookie_file)


def _download_subtitles_inner(url, output_dir, proxy, cookie_file, filename_base, output_template, zh_langs, en_langs):
    """Inner implementation for subtitle download. Returns (path, content) or None on failure."""
    try:
        # Step 1: Fetch metadata to inspect available subtitles
        ydl_opts_meta = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'proxy': proxy,
        }
        if cookie_file:
            ydl_opts_meta['cookiefile'] = cookie_file

        target_lang = None
        is_auto = False

        with yt_dlp.YoutubeDL(ydl_opts_meta) as ydl:
            logger.info(f"🔍 Fetching subtitle metadata for {url}...")
            info = ydl.extract_info(url, download=False)

            subtitles = info.get('subtitles', {})
            auto_captions = info.get('automatic_captions', {})

            def find_lang(available_langs, priorities):
                for p in priorities:
                    if p in available_langs:
                        return p
                return None

            # 1. Check Manual Subtitles
            target_lang = find_lang(subtitles.keys(), zh_langs)
            if not target_lang:
                target_lang = find_lang(subtitles.keys(), en_langs)
            if not target_lang and subtitles:
                target_lang = list(subtitles.keys())[0]

            if target_lang:
                logger.info(f"✅ Found Manual Subtitle: {target_lang}")
                is_auto = False
            else:
                # 2. Check Auto Subtitles
                target_lang = find_lang(auto_captions.keys(), zh_langs)
                if not target_lang:
                    target_lang = find_lang(auto_captions.keys(), en_langs)
                if not target_lang and auto_captions:
                    target_lang = list(auto_captions.keys())[0]

                if target_lang:
                    logger.info(f"✅ Found Auto-Generated Subtitle: {target_lang}")
                    is_auto = True

        if not target_lang:
            logger.info("❌ No subtitles found.")
            return None

        # Step 2: Download specific subtitle
        ydl_opts_down = {
            'skip_download': True,
            'writesubtitles': not is_auto,
            'writeautomaticsub': is_auto,
            'subtitleslangs': [target_lang],
            'subtitlesformat': 'srt',
            'outtmpl': output_template,
            'quiet': True,
            'no_warnings': True,
            'proxy': proxy,
        }
        if cookie_file:
            ydl_opts_down['cookiefile'] = cookie_file

        with yt_dlp.YoutubeDL(ydl_opts_down) as ydl:
            ydl.download([url])

            # Find the file
            for f in os.listdir(output_dir):
                if f.startswith(filename_base) and f.endswith('.srt'):
                    expected_file = os.path.join(output_dir, f)
                    with open(expected_file, 'r', encoding='utf-8') as fh:
                        content = fh.read()
                    return expected_file, content

    except Exception as e:
        if _is_format_error(e):
            logger.warning(f"⚠️ Subtitle fetch format error (likely bad cookies): {e}")
            return None  # Signal caller to retry without cookies
        logger.error(f"❌ Subtitle download error: {e}")
        return None

    return None
