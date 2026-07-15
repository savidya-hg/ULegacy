from fastapi import APIRouter, HTTPException
from datetime import datetime
from ..database import supabase
from ..models import HeartbeatRequest

router = APIRouter(prefix="/api", tags=["heartbeat"])

@router.post("/heartbeat")
async def heartbeat(req: HeartbeatRequest):
    """Receive heartbeat from extension"""
    user = supabase.table("users").select("*").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    user_data = user.data[0]
    new_status = "active"
    if user_data["status"] == "grace_period":
        new_status = "active"

    supabase.table("users").update({
        "last_heartbeat": datetime.utcnow().isoformat(),
        "status": new_status,
        "grace_period_start": None
    }).eq("id", req.user_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": req.user_id,
        "action": "heartbeat",
        "metadata": {"new_status": new_status}
    }).execute()

    return {"status": "ok", "user_status": new_status}