from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
from typing import Optional
from pydantic import BaseModel, EmailStr

# Import database helpers
from .database import supabase, hash_recovery_key, verify_recovery_key, generate_settlement_token

# Import routers
from .routes import heartbeat, settlement, vault

app = FastAPI(
    title="ULegacy API",
    description="Post Mortem Data Management System",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Include Routers ----------
app.include_router(heartbeat.router)
app.include_router(settlement.router)
app.include_router(vault.router)

# ---------- Models ----------
class UserRegisterRequest(BaseModel):
    email: EmailStr
    recovery_key: str
    beneficiary_email: Optional[EmailStr] = None
    beneficiary_phone: Optional[str] = None

class UserResponse(BaseModel):
    id: str
    email: str
    status: str
    last_heartbeat: str
    created_at: str

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
        "beneficiary_phone": req.beneficiary_phone,
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

    return UserResponse(
        id=user["id"],
        email=user["email"],
        status=user["status"],
        last_heartbeat=user["last_heartbeat"],
        created_at=user["created_at"]
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
        created_at=user["created_at"]
    )

# ---------- Admin Endpoints ----------
@app.get("/api/admin/check-inactive")
async def check_inactive():
    cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
    inactive = supabase.table("users").select("*").eq("status", "active").lt("last_heartbeat", cutoff).execute()

    results = {"inactive_users": [], "expired_grace": [], "settlement_triggered": []}

    for user in inactive.data:
        supabase.table("users").update({
            "status": "grace_period",
            "grace_period_start": datetime.utcnow().isoformat()
        }).eq("id", user["id"]).execute()
        results["inactive_users"].append(user["email"])
        print(f"GRACE PERIOD STARTED for {user['email']}")

    grace_cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
    expired = supabase.table("users").select("*").eq("status", "grace_period").lt("grace_period_start", grace_cutoff).execute()

    for user in expired.data:
        token = generate_settlement_token()
        supabase.table("users").update({
            "status": "deceased",
            "settlement_token": token
        }).eq("id", user["id"]).execute()
        results["expired_grace"].append(user["email"])
        print(f"SETTLEMENT TRIGGERED for {user['email']} token: {token}")

    return results

@app.get("/")
async def root():
    return {"message": "ULegacy API", "status": "running"}