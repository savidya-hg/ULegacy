from fastapi import APIRouter, HTTPException
from datetime import datetime
from ..database import supabase, verify_recovery_key, generate_settlement_token
from ..models import VerifyRequest, SettlementTriggerRequest

router = APIRouter(prefix="/api", tags=["settlement"])

@router.post("/settlement/verify")
async def verify_recovery_endpoint(req: VerifyRequest):
    """Verify recovery key and generate settlement token"""
    user = supabase.table("users").select("*").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    user_data = user.data[0]

    if user_data["status"] not in ["deceased", "grace_period"]:
        raise HTTPException(400, "User is not in settlement state")

    if not verify_recovery_key(req.recovery_key, user_data["recovery_key_hash"], user_data["salt"]):
        raise HTTPException(401, "Invalid recovery key")

    token = generate_settlement_token()
    supabase.table("users").update({
        "settlement_token": token,
        "status": "settling"
    }).eq("id", req.user_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": req.user_id,
        "action": "settlement_verified",
        "metadata": {"token_generated": True}
    }).execute()

    return {"settlement_token": token, "user_id": req.user_id}

@router.post("/settlement/complete")
async def complete_settlement(req: SettlementTriggerRequest):
    """Mark settlement as complete and clean up data"""
    user = supabase.table("users").select("*").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    supabase.table("users").update({
        "status": "settled"
    }).eq("id", req.user_id).execute()

    supabase.table("vaults").delete().eq("user_id", req.user_id).execute()
    supabase.table("users").update({
        "settlement_token": None
    }).eq("id", req.user_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": req.user_id,
        "action": "settlement_complete"
    }).execute()

    return {"status": "complete"}