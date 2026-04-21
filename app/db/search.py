"""
Search Database Operations
Searches across video metadata and transcripts.
"""
from app.db.connection import get_connection_with_row
from app.utils.source_utils import normalize_source_id


def search_transcriptions(query: str, limit: int = 50):
    """
    Search across videos and transcripts using LIKE operator.

    Matches against:
      - video_meta.source_id       (normalized source ID)
      - video_meta.original_source (original URL)
      - video_meta.video_title     (video title)
      - transcriptions.raw_text    (transcript content)

    The query is also normalized via normalize_source_id() so that a raw URL
    can match a normalized source_id (e.g. a Bilibili URL matches its BV ID).

    Args:
        query: Search query
        limit: Maximum results to return

    Returns:
        List of matching results with snippets
    """
    if not query or not query.strip():
        return []

    conn = get_connection_with_row()
    cursor = conn.cursor()

    # Clean query
    safe_query = query.strip()

    # Try to normalize the query for source_id matching
    try:
        normalized_query = normalize_source_id(safe_query)
    except Exception:
        normalized_query = safe_query

    try:
        # Build LIKE patterns
        text_pattern = f'%{safe_query}%'
        source_pattern = f'%{safe_query}%'
        normalized_pattern = f'%{normalized_query}%'

        # Start from video_meta so bookmark-only entries (no transcription) are included.
        # LEFT JOIN transcriptions to pick up transcript text when available.
        cursor.execute('''
            SELECT
                vm.source_id,
                vm.video_title,
                vm.video_cover,
                vm.source_type,
                vm.original_source,
                vm.created_at,
                t.id AS transcription_id,
                t.raw_text,
                t.timestamp AS t_timestamp,
                CASE
                    WHEN vm.source_id LIKE ?       THEN 'source_id'
                    WHEN vm.source_id LIKE ?       THEN 'source_id'
                    WHEN vm.original_source LIKE ? THEN 'url'
                    WHEN vm.video_title LIKE ?     THEN 'title'
                    WHEN t.raw_text LIKE ?         THEN 'text'
                    ELSE 'other'
                END AS match_field
            FROM video_meta vm
            LEFT JOIN transcriptions t ON t.source = vm.source_id
            WHERE vm.source_id LIKE ?
               OR vm.source_id LIKE ?
               OR vm.original_source LIKE ?
               OR vm.video_title LIKE ?
               OR t.raw_text LIKE ?
            ORDER BY
                CASE
                    WHEN vm.source_id LIKE ? OR vm.source_id LIKE ? THEN 0
                    WHEN vm.original_source LIKE ? THEN 1
                    WHEN vm.video_title LIKE ? THEN 2
                    ELSE 3
                END,
                COALESCE(t.timestamp, vm.created_at) DESC
            LIMIT ?
        ''', (
            # CASE for match_field
            source_pattern, normalized_pattern, source_pattern, text_pattern, text_pattern,
            # WHERE conditions
            source_pattern, normalized_pattern, source_pattern, text_pattern, text_pattern,
            # ORDER BY
            source_pattern, normalized_pattern, source_pattern, text_pattern,
            # LIMIT
            limit,
        ))

        results = []
        seen_sources = set()
        for row in cursor.fetchall():
            match_field = row['match_field']
            source_id = row['source_id']

            # For non-text matches, deduplicate by source_id
            if match_field != 'text':
                if source_id in seen_sources:
                    continue
                seen_sources.add(source_id)

            # Generate snippet based on match type
            snippet_text = _build_snippet(row, match_field, safe_query)

            results.append({
                'id': row['transcription_id'] or 0,
                'source': source_id,
                'title': row['video_title'] or 'Untitled',
                'cover': row['video_cover'],
                'source_type': row['source_type'],
                'original_source': row['original_source'],
                'timestamp': row['t_timestamp'] or row['created_at'],
                'snippet': snippet_text,
                'match_field': match_field,
                'score': 1.0
            })

        return results
    except Exception as e:
        print(f"Search error: {e}")
        return []
    finally:
        conn.close()


def _build_snippet(row, match_field: str, query: str) -> str:
    """Build a display snippet based on which field matched."""
    if match_field == 'source_id':
        sid = row['source_id'] or ''
        return _highlight(sid, query)

    if match_field == 'url':
        url = row['original_source'] or ''
        return _highlight(url, query)

    if match_field == 'title':
        title = row['video_title'] or ''
        return _highlight(title, query)

    # Text match: show context around the match in raw_text
    text = row['raw_text'] or ''
    if not text:
        return row['video_title'] or row['source_id'] or ''

    lower_text = text.lower()
    lower_query = query.lower()
    if lower_query in lower_text:
        idx = lower_text.find(lower_query)
        start = max(0, idx - 15)
        end = min(len(text), idx + len(query) + 15)
        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(text) else ""
        match_text = text[idx:idx + len(query)]
        return f"{prefix}{text[start:idx]}<mark>{match_text}</mark>{text[idx + len(query):end]}{suffix}"

    return text[:32] + "..." if len(text) > 32 else text


def _highlight(text: str, query: str) -> str:
    """Highlight the query within text using <mark> tags."""
    if not text:
        return ''
    lower_text = text.lower()
    lower_query = query.lower()
    idx = lower_text.find(lower_query)
    if idx >= 0:
        return f"{text[:idx]}<mark>{text[idx:idx + len(query)]}</mark>{text[idx + len(query):]}"
    return text

