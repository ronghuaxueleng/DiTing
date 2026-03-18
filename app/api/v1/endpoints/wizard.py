"""Wizard completion endpoints"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.config import settings
from app.db.system_config import get_system_config, set_system_config

router = APIRouter(tags=["Wizard"])

@router.get("/status")
async def get_wizard_status():
    """Return whether the first‑run wizard has been completed."""
    # Use settings if loaded, else fallback to DB
    completed = getattr(settings, "WIZARD_COMPLETED", False)
    return {"completed": completed}

class CompleteWizardResponse(BaseModel):
    status: str = "completed"

@router.post("/complete")
async def complete_wizard():
    """Mark the wizard as completed and persist the flag."""
    # Persist via system config helper
    try:
        set_system_config("wizard_completed", "true")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    # Also update settings attribute if possible
    if hasattr(settings, "WIZARD_COMPLETED"):
        settings.WIZARD_COMPLETED = True
    return {"status": "completed"}
