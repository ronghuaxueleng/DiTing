"""
QA Conversations Database Operations
CRUD operations for qa_conversations and qa_messages tables.
"""
from app.db.connection import get_connection, get_connection_with_row


# --- Conversations ---

def create_conversation(source_id: str, title: str = None, llm_model_id: int = None) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO qa_conversations (source_id, title, llm_model_id) VALUES (?, ?, ?)",
        (source_id, title, llm_model_id),
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return new_id


def get_conversations_by_source(source_id: str) -> list:
    conn = get_connection_with_row()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM qa_conversations WHERE source_id = ? ORDER BY updated_at DESC",
        (source_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return rows


def get_conversation(conversation_id: int):
    conn = get_connection_with_row()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM qa_conversations WHERE id = ?", (conversation_id,))
    row = cursor.fetchone()
    conn.close()
    return row


def update_conversation_title(conversation_id: int, title: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE qa_conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (title, conversation_id),
    )
    conn.commit()
    conn.close()


def touch_conversation(conversation_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE qa_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (conversation_id,),
    )
    conn.commit()
    conn.close()


def delete_conversation(conversation_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM qa_conversations WHERE id = ?", (conversation_id,))
    conn.commit()
    conn.close()


def delete_conversations_by_source(source_id: str) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM qa_conversations WHERE source_id = ?", (source_id,))
    deleted = cursor.rowcount
    conn.commit()
    conn.close()
    return deleted


def count_conversations_by_source(source_id: str) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM qa_conversations WHERE source_id = ?", (source_id,))
    count = cursor.fetchone()[0]
    conn.close()
    return count


# --- Messages ---

def add_message(conversation_id: int, role: str, content: str, model: str = None, response_time: float = None) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO qa_messages (conversation_id, role, content, model, response_time) VALUES (?, ?, ?, ?, ?)",
        (conversation_id, role, content, model, response_time),
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return new_id


def get_messages(conversation_id: int) -> list:
    conn = get_connection_with_row()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM qa_messages WHERE conversation_id = ? ORDER BY created_at ASC",
        (conversation_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return rows


def get_message(message_id: int):
    conn = get_connection_with_row()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM qa_messages WHERE id = ?", (message_id,))
    row = cursor.fetchone()
    conn.close()
    return row


def update_message_content(message_id: int, content: str, model: str = None, response_time: float = None):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE qa_messages SET content = ?, model = ?, response_time = ? WHERE id = ?",
        (content, model, response_time, message_id),
    )
    conn.commit()
    conn.close()


def delete_message(message_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM qa_messages WHERE id = ?", (message_id,))
    conn.commit()
    conn.close()
