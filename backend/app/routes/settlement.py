from fastapi import APIRouter, HTTPException
from datetime import datetime
from ..database import supabase, verify_recovery_key, generate_settlement_token, generate_confirmation_token
from ..models import VerifyRequest, SettlementTriggerRequest

router = APIRouter(prefix="/api", tags=["settlement"])

@router.post("/settlement/verify")
async def verify_recovery_endpoint(req: VerifyRequest):
    """Verify recovery key hash and generate settlement token.
    
    The client sends SHA-256(raw_key). We verify it against
    the stored Argon2id(SHA-256(raw_key) + salt).
    """
    user = supabase.table("users").select("*").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    user_data = user.data[0]

    if user_data["status"] not in ["deceased", "grace_period"]:
        raise HTTPException(400, "User is not in settlement state")

    # Verify using client-provided SHA-256 hash
    if not verify_recovery_key(req.recovery_key_hash, user_data["recovery_key_hash"], user_data["salt"]):
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
    """Mark settlement as complete and clean up server-side data.
    
    Deletes the encrypted vault from the database and clears the
    settlement token. The user record is kept for audit trail purposes
    but marked as 'settled'.
    """
    user = supabase.table("users").select("*").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    # Delete encrypted vault from server
    supabase.table("vaults").delete().eq("user_id", req.user_id).execute()

    # Update user status and clear sensitive fields
    supabase.table("users").update({
        "status": "settled",
        "settlement_token": None,
        "recovery_key_hash": None,
        "salt": None
    }).eq("id", req.user_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": req.user_id,
        "action": "settlement_complete",
        "metadata": {"settled_at": datetime.utcnow().isoformat()}
    }).execute()

    return {"status": "complete"}

# ---------- Beneficiary Grace Period Confirmation Endpoints ----------

@router.get("/settlement/confirm-active/{user_id}/{token}")
async def confirm_owner_active(user_id: str, token: str):
    """Beneficiary confirms the owner is still active during grace period.
    
    Resets the owner's status back to 'active' and clears the grace period.
    The token must match the one stored in the confirmation_token field.
    """
    user = supabase.table("users").select("*").eq("id", user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    user_data = user.data[0]
    if user_data["status"] != "grace_period":
        return {"status": "already_resolved", "message": "This user is no longer in grace period."}

    # Verify confirmation token
    if user_data.get("confirmation_token") != token:
        raise HTTPException(401, "Invalid confirmation token")

    # Reset to active
    supabase.table("users").update({
        "status": "active",
        "grace_period_start": None,
        "confirmation_token": None,
        "last_heartbeat": datetime.utcnow().isoformat()
    }).eq("id", user_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": user_id,
        "action": "beneficiary_confirmed_active",
        "metadata": {"confirmed_at": datetime.utcnow().isoformat()}
    }).execute()

    return {
        "status": "confirmed_active",
        "message": "Thank you. The owner has been marked as active and the grace period has been cancelled."
    }

@router.get("/settlement/confirm-inactive/{user_id}/{token}")
async def confirm_owner_inactive(user_id: str, token: str):
    """Beneficiary confirms the owner is inactive — triggers immediate settlement.
    
    Skips the remaining grace period and moves directly to settlement.
    """
    user = supabase.table("users").select("*").eq("id", user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    user_data = user.data[0]
    if user_data["status"] != "grace_period":
        return {"status": "already_resolved", "message": "This user is no longer in grace period."}

    # Verify confirmation token
    if user_data.get("confirmation_token") != token:
        raise HTTPException(401, "Invalid confirmation token")

    # Trigger settlement immediately
    settlement_token = generate_settlement_token()
    supabase.table("users").update({
        "status": "deceased",
        "settlement_token": settlement_token,
        "confirmation_token": None
    }).eq("id", user_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": user_id,
        "action": "beneficiary_confirmed_inactive",
        "metadata": {
            "confirmed_at": datetime.utcnow().isoformat(),
            "settlement_triggered": True
        }
    }).execute()

    # Send settlement instructions email to beneficiary
    from ..services.notifications import send_settlement_instructions_email
    recipient = user_data.get("beneficiary_email") or user_data["email"]
    send_settlement_instructions_email(recipient, user_id)

    return {
        "status": "settlement_triggered",
        "message": "Settlement process has been initiated. The beneficiary will receive instructions via email."
    }