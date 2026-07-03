import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta

# Import database helpers
from .database import supabase, hash_recovery_key, verify_recovery_key, generate_settlement_token

# Import models (single source of truth)
from .models import UserRegisterRequest, UserResponse, SimulateInactivityRequest

# Import routers
from .routes import heartbeat, settlement, vault

# Import services
from .services.notifications import send_grace_period_email, send_settlement_email
from .services.scheduler import check_inactive_users

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ulegacy")

# ---------- Background Scheduler ----------
async def _scheduler_loop():
    """Run the inactivity check every 24 hours"""
    while True:
        try:
            logger.info("Running scheduled inactivity check...")
            result = await check_inactive_users()
            logger.info(f"Inactivity check complete: {result}")
        except Exception as e:
            logger.error(f"Scheduler error: {e}")
        # Wait 24 hours before next check
        await asyncio.sleep(86400)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle"""
    # Startup: launch background scheduler
    task = asyncio.create_task(_scheduler_loop())
    logger.info("ULegacy background scheduler started (24h cycle)")
    yield
    # Shutdown: cancel scheduler
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    logger.info("ULegacy scheduler stopped")

app = FastAPI(
    title="ULegacy API",
    description="Post Mortem Data Management System",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Include Routers ----------
app.include_router(heartbeat.router)
app.include_router(settlement.router)
app.include_router(vault.router)

# ---------- User Endpoints ----------
@app.post("/api/users/register")
async def register_user(req: UserRegisterRequest):
    existing = supabase.table("users").select("id").eq("email", req.email).execute()
    if existing.data:
        raise HTTPException(400, "User already exists")

    hash_value, salt = hash_recovery_key(req.recovery_key)
    user_data = {
        "email": req.email,
        "recovery_key_hash": hash_value,
        "salt": salt,
        "beneficiary_email": req.beneficiary_email,
        "status": "active",
        "last_heartbeat": datetime.utcnow().isoformat()
    }

    result = supabase.table("users").insert(user_data).execute()
    if not result.data:
        raise HTTPException(500, "Failed to create user")

    user = result.data[0]
    supabase.table("audit_logs").insert({
        "user_id": user["id"],
        "action": "user_registered",
        "metadata": {"email": req.email}
    }).execute()

    logger.info(f"User registered: {req.email}")

    return UserResponse(
        id=user["id"],
        email=user["email"],
        status=user["status"],
        last_heartbeat=user["last_heartbeat"],
        created_at=user["created_at"],
        beneficiary_email=user.get("beneficiary_email")
    )

@app.get("/api/users/{user_id}")
async def get_user(user_id: str):
    result = supabase.table("users").select("*").eq("id", user_id).execute()
    if not result.data:
        raise HTTPException(404, "User not found")
    user = result.data[0]
    return UserResponse(
        id=user["id"],
        email=user["email"],
        status=user["status"],
        last_heartbeat=user["last_heartbeat"],
        created_at=user["created_at"],
        beneficiary_email=user.get("beneficiary_email")
    )

# ---------- Admin Endpoints ----------
@app.get("/api/admin/check-inactive")
async def check_inactive():
    """Manually trigger the inactivity check (also runs automatically every 24h)"""
    cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
    inactive = supabase.table("users").select("*").eq("status", "active").lt("last_heartbeat", cutoff).execute()

    results = {"inactive_users": [], "expired_grace": [], "settlement_triggered": []}

    for user in inactive.data:
        supabase.table("users").update({
            "status": "grace_period",
            "grace_period_start": datetime.utcnow().isoformat()
        }).eq("id", user["id"]).execute()
        results["inactive_users"].append(user["email"])

        # Send grace period email to owner
        reset_link = f"http://localhost:8000/api/heartbeat"
        email_result = send_grace_period_email(user["email"], reset_link)
        logger.info(f"Grace period email to {user['email']}: {email_result}")

        supabase.table("audit_logs").insert({
            "user_id": user["id"],
            "action": "grace_period_started",
            "metadata": {"email_sent": email_result.get("success", False)}
        }).execute()

    grace_cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
    expired = supabase.table("users").select("*").eq("status", "grace_period").lt("grace_period_start", grace_cutoff).execute()

    for user in expired.data:
        token = generate_settlement_token()
        supabase.table("users").update({
            "status": "deceased",
            "settlement_token": token
        }).eq("id", user["id"]).execute()
        results["expired_grace"].append(user["email"])
        results["settlement_triggered"].append(user["email"])

        # Send settlement email to beneficiary (or owner if no beneficiary)
        recipient = user.get("beneficiary_email") or user["email"]
        settlement_link = "http://localhost:8000"
        email_result = send_settlement_email(recipient, token, settlement_link)
        logger.info(f"Settlement email to {recipient}: {email_result}")

        supabase.table("audit_logs").insert({
            "user_id": user["id"],
            "action": "settlement_triggered",
            "metadata": {
                "token_generated": True,
                "beneficiary_notified": recipient,
                "email_sent": email_result.get("success", False)
            }
        }).execute()

    return results

@app.post("/api/admin/simulate-inactivity")
async def simulate_inactivity(req: SimulateInactivityRequest):
    """Set a user's last_heartbeat to 31 days ago to test the dead man's switch"""
    user = supabase.table("users").select("id, email").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    if req.date:
        old_date = req.date
    else:
        old_date = (datetime.utcnow() - timedelta(days=31)).isoformat()

    supabase.table("users").update({
        "last_heartbeat": old_date
    }).eq("id", req.user_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": req.user_id,
        "action": "simulate_inactivity",
        "metadata": {"simulated_date": old_date}
    }).execute()

    logger.info(f"Simulated inactivity for user {req.user_id}")

    return {"status": "simulated", "last_heartbeat": old_date}

@app.get("/")
async def root():
    return {"message": "ULegacy API", "status": "running"}