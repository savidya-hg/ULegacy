from fastapi import APIRouter, HTTPException
from datetime import datetime
from ..database import supabase, verify_recovery_key, generate_settlement_token
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

    if user_data["status"] == "active":
        raise HTTPException(400, "Cannot start settlement: Owner account is currently active.")
    if user_data["status"] == "grace_period":
        raise HTTPException(400, "Cannot start settlement: Account is in grace period.")
    if user_data["status"] != "deceased":
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
    but marked as 'settled'. Sends a completion report email with full
    audit logs to both the owner and the beneficiary.
    """
    user = supabase.table("users").select("*").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    user_data = user.data[0]

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

    # Fetch full audit trail for this user (ordered by time)
    audit_logs_result = (
        supabase.table("audit_logs")
        .select("*")
        .eq("user_id", req.user_id)
        .order("created_at", desc=False)
        .execute()
    )
    audit_logs = audit_logs_result.data if audit_logs_result.data else []

    # Send completion report emails to both owner and beneficiary
    from ..services.notifications import send_settlement_complete_email

    owner_email = user_data.get("email")
    beneficiary_email = user_data.get("beneficiary_email")

    if owner_email:
        send_settlement_complete_email(owner_email, req.user_id, audit_logs, is_owner=True)
    if beneficiary_email:
        send_settlement_complete_email(beneficiary_email, req.user_id, audit_logs, is_owner=False)

    return {"status": "complete"}

# ---------- Beneficiary Grace Period Confirmation Endpoints ----------

@router.get("/settlement/confirm-active/{user_id}/{token}")
async def confirm_owner_active(user_id: str, token: str):
    """Confirm the owner is still active. Can be triggered by beneficiary or owner.
    
    Resets the owner's status back to 'active' and clears the grace/settlement period.
    The token must match the settlement_token stored in the database.
    """
    user = supabase.table("users").select("*").eq("id", user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    user_data = user.data[0]
    if user_data["status"] not in ["grace_period", "deceased"]:
        return {"status": "already_resolved", "message": "This account is already active or fully settled."}

    # Verify token against the settlement_token stored in database
    if user_data.get("settlement_token") != token:
        raise HTTPException(401, "Invalid confirmation token")

    # Reset to active
    supabase.table("users").update({
        "status": "active",
        "grace_period_start": None,
        "settlement_token": None,
        "last_heartbeat": datetime.utcnow().isoformat()
    }).eq("id", user_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": user_id,
        "action": "owner_marked_active",
        "metadata": {
            "previous_status": user_data["status"],
            "confirmed_at": datetime.utcnow().isoformat()
        }
    }).execute()

    return {
        "status": "confirmed_active",
        "message": "Thank you. The account has been marked as active and the grace period/settlement has been cancelled."
    }

@router.get("/settlement/confirm-inactive/{user_id}/{token}")
async def confirm_owner_inactive(user_id: str, token: str):
    """Beneficiary confirms the owner is inactive — triggers immediate settlement.
    
    Skips the remaining grace period, moves directly to settlement, sends settlement instructions
    to the beneficiary, and alerts the owner with a timer-reset option.
    """
    user = supabase.table("users").select("*").eq("id", user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    user_data = user.data[0]
    if user_data["status"] != "grace_period":
        return {"status": "already_resolved", "message": "This user is no longer in grace period."}

    # Verify token against the settlement_token stored during grace period
    if user_data.get("settlement_token") != token:
        raise HTTPException(401, "Invalid confirmation token")

    # Trigger settlement immediately — generate a fresh settlement token
    settlement_token = generate_settlement_token()
    supabase.table("users").update({
        "status": "deceased",
        "settlement_token": settlement_token
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
    from ..services.notifications import (
        send_settlement_instructions_email,
        send_owner_reported_inactive_email,
        BASE_URL
    )
    
    recipient = user_data.get("beneficiary_email") or user_data["email"]
    send_settlement_instructions_email(recipient, user_id)

    # Also notify the owner that their beneficiary marked them inactive, offering a reset timer option
    if user_data.get("email"):
        owner_reset_link = f"{BASE_URL}/api/settlement/confirm-active/{user_id}/{settlement_token}"
        send_owner_reported_inactive_email(user_data["email"], owner_reset_link)

    return {
        "status": "settlement_triggered",
        "message": "Settlement process has been initiated. The beneficiary will receive instructions via email."
    }