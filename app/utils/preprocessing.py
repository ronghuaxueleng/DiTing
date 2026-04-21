import re


def strip_subtitle_metadata(text: str) -> str:
    """
    Remove subtitle sequence numbers and timestamp lines, keeping only text.
    Handles SRT, WebVTT, Whisper raw format, and Bilibili/YouTube inline timestamps.
    """
    lines = text.splitlines()
    result = []

    for line in lines:
        s = line.strip()
        if not s:
            continue

        # Pure number sequence line (SRT/WebVTT)
        if re.fullmatch(r'\d+', s):
            continue

        # SRT timestamp line: 00:00:00,000 --> 00:00:00,000
        if re.fullmatch(r'\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}.*', s):
            continue

        # WebVTT short format: 00:00.000 --> 00:00.000
        if re.fullmatch(r'\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}\.\d{3}.*', s):
            continue

        # WebVTT headers
        if s.upper().startswith('WEBVTT') or s.upper().startswith('NOTE'):
            continue

        # Whisper inline timestamps: <|0.00|>
        s = re.sub(r'<\|[\d.]+\|>', '', s).strip()

        # Inline bracket timestamps: [00:01:23] or (0:01:23)
        s = re.sub(r'[\[\(]\d{1,5}:\d{2}(:\d{2})?\s*[\]\)]', '', s).strip()

        if s:
            result.append(s)

    return '\n'.join(result)
