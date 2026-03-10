"""
Video Notes Database Operations
CRUD operations for the video_notes table.
Stores AI-generated (and editable) whole-video notes with version management.
"""
from app.db.connection import get_connection, get_connection_with_row


def add_video_note(
    source_id: str,
    content: str,
    original_content: str,
    prompt: str = None,
    model: str = None,
    provider_id: int = None,
    style: str = None,
    response_time: float = None,
    gen_params: str = None,
) -> int:
    """Insert a new video note and make it the active version (deactivating others)."""
    conn = get_connection()
    cursor = conn.cursor()
    # Deactivate all existing notes for this video
    cursor.execute(
        "UPDATE video_notes SET is_active = 0 WHERE source_id = ?",
        (source_id,),
    )
    cursor.execute(
        """
        INSERT INTO video_notes
            (source_id, content, original_content, prompt, model, provider_id, style, response_time, gen_params, is_edited, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
        """,
        (source_id, content, original_content, prompt, model, provider_id, style, response_time, gen_params),
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return new_id


def get_active_note(source_id: str):
    """Return the currently active note for a video, or None."""
    conn = get_connection_with_row()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM video_notes WHERE source_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
        (source_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return row


def get_all_notes(source_id: str) -> list:
    """Return all note versions for a video, newest first."""
    conn = get_connection_with_row()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM video_notes WHERE source_id = ? ORDER BY created_at DESC",
        (source_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return rows


def batch_count_notes(source_ids: list[str]) -> dict:
    """Count AI notes for multiple source IDs in one query.
    Returns a dict mapping source_id -> count.
    """
    if not source_ids:
        return {}
        
    conn = get_connection()
    cursor = conn.cursor()
    placeholders = ','.join('?' * len(source_ids))
    cursor.execute(
        f'SELECT source_id, COUNT(*) as cnt FROM video_notes WHERE source_id IN ({placeholders}) GROUP BY source_id',
        list(source_ids)
    )
    result = {row[0]: row[1] for row in cursor.fetchall()}
    conn.close()
    return result


def update_note_content(note_id: int, content: str):
    """Update note content (user edit). Also flags is_edited and refreshes updated_at."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE video_notes
        SET content = ?, is_edited = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (content, note_id),
    )
    conn.commit()
    conn.close()


def reset_note_to_original(note_id: int):
    """Reset content back to original_content, clearing the is_edited flag."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE video_notes
        SET content = original_content, is_edited = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (note_id,),
    )
    conn.commit()
    conn.close()


def delete_video_note(note_id: int):
    """Delete a specific note version."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM video_notes WHERE id = ?", (note_id,))
    conn.commit()
    conn.close()


def set_note_active(note_id: int, source_id: str):
    """Make a specific note the active version (deactivates all others for the video)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE video_notes SET is_active = 0 WHERE source_id = ?",
        (source_id,),
    )
    cursor.execute(
        "UPDATE video_notes SET is_active = 1 WHERE id = ?",
        (note_id,),
    )
    conn.commit()
    conn.close()


def get_note_by_id(note_id: int):
    """Return a single note by its id."""
    conn = get_connection_with_row()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM video_notes WHERE id = ?", (note_id,))
    row = cursor.fetchone()
    conn.close()
    return row
