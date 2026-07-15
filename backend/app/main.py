import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, BackgroundTasks, Response
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta

# Import database helpers
from .database import supabase, hash_recovery_key, verify_recovery_key, generate_settlement_token

# Import models (single source of truth)
from .models import UserRegisterRequest, UserResponse, SimulateInactivityRequest

# Import routers
from .routes import heartbeat, settlement, vault

# Import services
from .services.notifications import (
    send_grace_period_email,
    send_beneficiary_grace_email, send_settlement_instructions_email
)
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

    # The client sends SHA-256(raw_key) — we never see the raw key
    hash_value, salt = hash_recovery_key(req.recovery_key_hash)
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
async def check_inactive(background_tasks: BackgroundTasks):
    """Manually trigger the inactivity check (also runs automatically every 24h)"""
    cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
    inactive = supabase.table("users").select("*").eq("status", "active").lt("last_heartbeat", cutoff).execute()

    results = {"inactive_users": [], "expired_grace": [], "settlement_triggered": []}

    for user in inactive.data:
        # Generate a confirmation token for grace period
        grace_token = generate_settlement_token()

        supabase.table("users").update({
            "status": "grace_period",
            "grace_period_start": datetime.utcnow().isoformat(),
            "settlement_token": grace_token
        }).eq("id", user["id"]).execute()
        results["inactive_users"].append(user["email"])

        # Send grace period email to OWNER in background
        reset_link = f"http://localhost:8000/api/settlement/confirm-active/{user['id']}/{grace_token}"
        background_tasks.add_task(send_grace_period_email, user["email"], reset_link)

        # Send grace period email to BENEFICIARY in background (if set)
        if user.get("beneficiary_email"):
            background_tasks.add_task(
                send_beneficiary_grace_email,
                user["beneficiary_email"],
                user["email"],
                user["id"],
                grace_token
            )

        supabase.table("audit_logs").insert({
            "user_id": user["id"],
            "action": "grace_period_started",
            "metadata": {
                "owner_email_queued": True,
                "beneficiary_email_queued": bool(user.get("beneficiary_email"))
            }
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

        # Send settlement instructions email to beneficiary in background
        recipient = user.get("beneficiary_email") or user["email"]
        background_tasks.add_task(send_settlement_instructions_email, recipient, user["id"])

        supabase.table("audit_logs").insert({
            "user_id": user["id"],
            "action": "settlement_triggered",
            "metadata": {
                "token_generated": True,
                "beneficiary_notified": recipient,
                "email_queued": True
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

@app.post("/api/admin/simulate-settlement")
async def simulate_settlement(req: SimulateInactivityRequest, background_tasks: BackgroundTasks):
    """Jump a user directly to 'deceased' (final settlement) status for testing.
    
    Skips the 30-day inactivity and 7-day grace period entirely.
    Generates a settlement token so the beneficiary can verify and begin deletion.
    """
    user = supabase.table("users").select("id, email, beneficiary_email").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

    user_data = user.data[0]
    token = generate_settlement_token()
    supabase.table("users").update({
        "status": "deceased",
        "settlement_token": token,
        "grace_period_start": None
    }).eq("id", req.user_id).execute()

    # Queue settlement instructions email in the background
    recipient = user_data.get("beneficiary_email") or user_data["email"]
    background_tasks.add_task(send_settlement_instructions_email, recipient, req.user_id)

    supabase.table("audit_logs").insert({
        "user_id": req.user_id,
        "action": "simulate_settlement",
        "metadata": {
            "token_generated": True,
            "simulated": True,
            "beneficiary_notified": recipient,
            "emails_queued": True
        }
    }).execute()

    logger.info(f"Simulated final settlement for user {req.user_id}")

    return {"status": "deceased", "settlement_token": token}

@app.get("/")
async def root():
    return {"message": "ULegacy API", "status": "running"}