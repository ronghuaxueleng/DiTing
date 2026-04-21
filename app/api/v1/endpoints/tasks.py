"""
Task Management Router
Handles: Task status polling, cancellation
"""
from fastapi import APIRouter

from app.core.task_manager import task_manager

router = APIRouter(prefix="/tasks", tags=["Tasks"])


@router.get("")
async def get_all_tasks_status():
    """Get status of all active tasks in TaskManager"""
    sanitized = {}
    tasks_copy = task_manager.tasks.copy()
    for tid, tinfo in tasks_copy.items():
        sanitized[tid] = {k: v for k, v in tinfo.items() if k != 'cancel_event'}
    return sanitized


@router.post("/{task_id}/cancel")
async def cancel_task_endpoint(task_id: int):
    """Signal task cancellation. For AI tasks, immediately update DB status."""
    task = task_manager.tasks.get(task_id)

    success = task_manager.cancel_task(task_id)
    if not success:
        return {"status": "error", "message": "Task not found or unable to cancel"}

    # For AI tasks, immediately update ai_status so VideoCard reflects cancellation
    if task:
        meta = task.get("meta", {})
        if meta.get("type") == "ai" and meta.get("item_id"):
            from app.db import update_ai_status
            update_ai_status(meta["item_id"], "cancelled")

    return {"status": "success", "message": f"Task {task_id} cancellation signaled"}
