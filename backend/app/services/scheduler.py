import logging
from datetime import datetime, timedelta
from ..database import supabase, generate_settlement_token, generate_confirmation_token
from .notifications import (
    send_grace_period_email,
    send_beneficiary_grace_email,
    send_grace_reminder_email,
    send_settlement_email,
    send_settlement_instructions_email
)

logger = logging.getLogger("ulegacy.scheduler")

async def check_inactive_users():
    """Check for inactive users — runs automatically every 24h via the background scheduler.
    
    Phase 1: Find users inactive for 30+ days → move to grace period,
             email BOTH owner and beneficiary.
    Phase 2: Send reminder emails at day 3 and day 5 of grace period.
    Phase 3: Check expired grace periods (7+ days) → trigger settlement,
             send settlement instructions to beneficiary.
    """

    results = {
        "new_grace_period": 0,
        "reminders_sent": 0,
        "settlements_triggered": 0
    }

    # ---------- Phase 1: Find users inactive for 30+ days ----------
    cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
    inactive = supabase.table("users").select("*").eq("status", "active").lt("last_heartbeat", cutoff).execute()

    for user in inactive.data:
        # Generate a confirmation token for the beneficiary's confirm/deny links
        confirmation_token = generate_confirmation_token()

        # Move to grace period
        supabase.table("users").update({
            "status": "grace_period",
            "grace_period_start": datetime.utcnow().isoformat(),
            "confirmation_token": confirmation_token
        }).eq("id", user["id"]).execute()

        # Email 1: Send grace period email to OWNER
        reset_link = f"http://localhost:8000/api/heartbeat"
        owner_email_result = send_grace_period_email(user["email"], reset_link)
        logger.info(f"Grace period email to owner {user['email']}: {owner_email_result}")

        # Email 2: Send grace period email to BENEFICIARY (if set)
        beneficiary_email_result = {"success": False, "error": "No beneficiary set"}
        if user.get("beneficiary_email"):
            beneficiary_email_result = send_beneficiary_grace_email(
                user["beneficiary_email"],
                user["email"],
                user["id"],
                confirmation_token
            )
            logger.info(f"Grace period email to beneficiary {user['beneficiary_email']}: {beneficiary_email_result}")

        # Audit log
        supabase.table("audit_logs").insert({
            "user_id": user["id"],
            "action": "grace_period_started",
            "metadata": {
                "owner_email_sent": owner_email_result.get("success", False),
                "beneficiary_email_sent": beneficiary_email_result.get("success", False),
                "triggered_by": "scheduler"
            }
        }).execute()

        results["new_grace_period"] += 1

    # ---------- Phase 2: Send reminder emails during grace period (day 3 and 5) ----------
    for reminder_day in [3, 5]:
        # Find users who entered grace period exactly 'reminder_day' days ago (±12h window)
        reminder_start = (datetime.utcnow() - timedelta(days=reminder_day, hours=12)).isoformat()
        reminder_end = (datetime.utcnow() - timedelta(days=reminder_day - 1, hours=12)).isoformat()

        grace_users = (
            supabase.table("users")
            .select("*")
            .eq("status", "grace_period")
            .gte("grace_period_start", reminder_start)
            .lt("grace_period_start", reminder_end)
            .execute()
        )

        days_remaining = 7 - reminder_day
        for user in grace_users.data:
            reset_link = f"http://localhost:8000/api/heartbeat"
            email_result = send_grace_reminder_email(user["email"], days_remaining, reset_link)
            logger.info(f"Grace reminder ({days_remaining} days left) to {user['email']}: {email_result}")

            supabase.table("audit_logs").insert({
                "user_id": user["id"],
                "action": "grace_reminder_sent",
                "metadata": {
                    "days_remaining": days_remaining,
                    "email_sent": email_result.get("success", False),
                    "triggered_by": "scheduler"
                }
            }).execute()

            results["reminders_sent"] += 1

    # ---------- Phase 3: Check expired grace periods (7+ days) ----------
    grace_cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
    expired = supabase.table("users").select("*").eq("status", "grace_period").lt("grace_period_start", grace_cutoff).execute()

    for user in expired.data:
        # Mark deceased and generate settlement token
        token = generate_settlement_token()
        supabase.table("users").update({
            "status": "deceased",
            "settlement_token": token,
            "confirmation_token": None  # Clear the grace period confirmation token
        }).eq("id", user["id"]).execute()

        # Send settlement instructions to beneficiary (or owner as fallback)
        recipient = user.get("beneficiary_email") or user["email"]

        # Send the detailed instructions email
        instructions_result = send_settlement_instructions_email(recipient, user["id"])
        logger.info(f"Settlement instructions to {recipient}: {instructions_result}")

        # Also send the settlement notification email
        settlement_link = "http://localhost:8000"
        settlement_result = send_settlement_email(recipient, token, settlement_link)
        logger.info(f"Settlement notification to {recipient}: {settlement_result}")

        # Audit log
        supabase.table("audit_logs").insert({
            "user_id": user["id"],
            "action": "settlement_triggered",
            "metadata": {
                "token_generated": True,
                "beneficiary_notified": recipient,
                "instructions_sent": instructions_result.get("success", False),
                "settlement_sent": settlement_result.get("success", False),
                "triggered_by": "scheduler"
            }
        }).execute()

        results["settlements_triggered"] += 1

    return results