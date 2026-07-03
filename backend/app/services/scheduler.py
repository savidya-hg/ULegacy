import logging
from datetime import datetime, timedelta
from ..database import supabase, generate_settlement_token
from .notifications import send_grace_period_email, send_settlement_email

logger = logging.getLogger("ulegacy.scheduler")

async def check_inactive_users():
    """Check for inactive users — runs automatically every 24h via the background scheduler"""

    # ---------- Phase 1: Find users inactive for 30+ days ----------
    cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
    inactive = supabase.table("users").select("*").eq("status", "active").lt("last_heartbeat", cutoff).execute()

    for user in inactive.data:
        # Move to grace period
        supabase.table("users").update({
            "status": "grace_period",
            "grace_period_start": datetime.utcnow().isoformat()
        }).eq("id", user["id"]).execute()

        # Send grace period email to OWNER only (not beneficiary)
        reset_link = f"http://localhost:8000/api/heartbeat"
        email_result = send_grace_period_email(user["email"], reset_link)
        logger.info(f"Grace period started for {user['email']} — email: {email_result}")

        # Audit log
        supabase.table("audit_logs").insert({
            "user_id": user["id"],
            "action": "grace_period_started",
            "metadata": {
                "email_sent": email_result.get("success", False),
                "triggered_by": "scheduler"
            }
        }).execute()

    # ---------- Phase 2: Check expired grace periods (7+ days) ----------
    grace_cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
    expired = supabase.table("users").select("*").eq("status", "grace_period").lt("grace_period_start", grace_cutoff).execute()

    for user in expired.data:
        # Mark deceased and generate settlement token
        token = generate_settlement_token()
        supabase.table("users").update({
            "status": "deceased",
            "settlement_token": token
        }).eq("id", user["id"]).execute()

        # Send settlement email to beneficiary (or owner as fallback)
        recipient = user.get("beneficiary_email") or user["email"]
        settlement_link = "http://localhost:8000"
        email_result = send_settlement_email(recipient, token, settlement_link)
        logger.info(f"Settlement triggered for {user['email']} — beneficiary: {recipient}, email: {email_result}")

        # Audit log
        supabase.table("audit_logs").insert({
            "user_id": user["id"],
            "action": "settlement_triggered",
            "metadata": {
                "token_generated": True,
                "beneficiary_notified": recipient,
                "email_sent": email_result.get("success", False),
                "triggered_by": "scheduler"
            }
        }).execute()

    return {
        "inactive_count": len(inactive.data),
        "expired_count": len(expired.data)
    }