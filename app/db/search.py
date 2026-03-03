"""
Search Database Operations
Basic LIKE-based search for transcripts.
"""
from app.db.connection import get_connection_with_row
from app.utils.source_utils import normalize_source_id


def search_transcriptions(query: str, limit: int = 50):
    """
    Search across transcripts using LIKE operator.

    Matches against:
      - transcriptions.raw_text  (transcript content)
      - video_meta.source_id     (normalized source ID)
      - video_meta.original_source (original URL)
      - video_meta.video_title   (video title)

    The query is also normalized via normalize_source_id() so that a raw URL
    can match a normalized source_id (e.g. a Bilibili URL matches its BV ID).

    Args:
        query: Search query
        limit: Maximum results to return

    Returns:
        List of matching transcriptions with snippets
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

        cursor.execute('''
            SELECT
                t.id,
                t.source,
                vm.video_title,
                vm.video_cover,
                vm.source_type,
                vm.original_source,
                t.timestamp,
                t.raw_text,
                CASE
                    WHEN vm.source_id LIKE ?  THEN 'source_id'
                    WHEN vm.source_id LIKE ?  THEN 'source_id'
                    WHEN vm.original_source LIKE ? THEN 'url'
                    WHEN vm.video_title LIKE ? THEN 'title'
                    WHEN t.raw_text LIKE ?    THEN 'text'
                    ELSE 'text'
                END AS match_field
            FROM transcriptions t
            LEFT JOIN video_meta vm ON t.source = vm.source_id
            WHERE t.raw_text LIKE ?
               OR vm.source_id LIKE ?
               OR vm.source_id LIKE ?
               OR vm.original_source LIKE ?
               OR vm.video_title LIKE ?
            ORDER BY
                CASE
                    WHEN vm.source_id LIKE ? OR vm.source_id LIKE ? THEN 0
                    WHEN vm.original_source LIKE ? THEN 1
                    WHEN vm.video_title LIKE ? THEN 2
                    ELSE 3
                END,
                t.timestamp DESC
            LIMIT ?
        ''', (
            # CASE for match_field
            source_pattern, normalized_pattern, source_pattern, text_pattern, text_pattern,
            # WHERE conditions
            text_pattern, source_pattern, normalized_pattern, source_pattern, text_pattern,
            # ORDER BY
            source_pattern, normalized_pattern, source_pattern, text_pattern,
            # LIMIT
            limit,
        ))

        results = []
        seen_sources = set()
        for row in cursor.fetchall():
            match_field = row['match_field']

            # For source_id / url / title matches, deduplicate by source
            if match_field in ('source_id', 'url', 'title'):
                source = row['source']
                if source in seen_sources:
                    continue
                seen_sources.add(source)

            # Generate snippet
            text = row['raw_text']
            snippet_text = text
            if safe_query.lower() in text.lower():
                idx = text.lower().find(safe_query.lower())
                start = max(0, idx - 15)
                end = min(len(text), idx + len(safe_query) + 15)
                prefix = "..." if start > 0 else ""
                suffix = "..." if end < len(text) else ""

                match_text = text[idx:idx+len(safe_query)]
                snippet_text = f"{prefix}{text[start:idx]}<mark>{match_text}</mark>{text[idx+len(safe_query):end]}{suffix}"
            elif len(text) > 32:
                snippet_text = text[:32] + "..."

            results.append({
                'id': row['id'],
                'source': row['source'],
                'title': row['video_title'] or 'Untitled',
                'cover': row['video_cover'],
                'source_type': row['source_type'],
                'original_source': row['original_source'],
                'timestamp': row['timestamp'],
                'snippet': snippet_text,
                'match_field': match_field,
                'score': 1.0
            })

        return results
    except Exception as e:
        # If search query fails, return empty (don't crash)
        print(f"Search error: {e}")
        return []
    finally:
        conn.close()
