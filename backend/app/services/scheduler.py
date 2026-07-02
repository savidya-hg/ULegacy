import asyncio
from datetime import datetime, timedelta
from ..database import supabase
from .notifications import send_grace_period_email, send_settlement_email
import secrets

async def check_inactive_users():
    """Check for inactive users - should be run daily via cron"""
    # Find users with no heartbeat for 30 days
    cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
    inactive = supabase.table("users").select("*").eq("status", "active").lt("last_heartbeat", cutoff).execute()

    for user in inactive.data:
        # Move to grace period
        supabase.table("users").update({
            "status": "grace_period",
            "grace_period_start": datetime.utcnow().isoformat()
        }).eq("id", user["id"]).execute()

        # Send notifications
        reset_link = f"https://ulegacy.com/reset/{user['id']}"
        send_grace_period_email(user["email"], reset_link)

        if user.get("beneficiary_email"):
            send_grace_period_email(
                user["beneficiary_email"],
                f"Owner {user['email']} has been inactive"
            )

    # Check expired grace periods (7 days)
    grace_cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
    expired = supabase.table("users").select("*").eq("status", "grace_period").lt("grace_period_start", grace_cutoff).execute()

    for user in expired.data:
        # Mark deceased and generate token
        token = secrets.token_urlsafe(32)
        supabase.table("users").update({
            "status": "deceased",
            "settlement_token": token
        }).eq("id", user["id"]).execute()

        # Send settlement email
        settlement_link = "https://ulegacy.com/settle"
        send_settlement_email(
            user.get("beneficiary_email") or user["email"],
            token,
            settlement_link
        )

    return {
        "inactive_count": len(inactive.data),
        "expired_count": len(expired.data)
    }

# For local testing
if __name__ == "__main__":
    asyncio.run(check_inactive_users())