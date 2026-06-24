from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv
from supabase import create_client, Client
import argon2
import secrets

load_dotenv()

app = FastAPI(title="ULegacy API")

# CORS for extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supabase client
supabase: Client = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

# ---------- Pydantic Models ----------
class HeartbeatRequest(BaseModel):
    user_id: str

class VaultSaveRequest(BaseModel):
    user_id: str
    encrypted_data: str
    platform_metadata: dict

class VerifyRequest(BaseModel):
    user_id: str
    recovery_key: str

class SettlementTriggerRequest(BaseModel):
    user_id: str

# ---------- Helper Functions ----------
ph = argon2.PasswordHasher()

def hash_recovery_key(key: str, salt: str = None) -> tuple:
    if not salt:
        salt = secrets.token_hex(16)
    hash = ph.hash(f"{key}{salt}")
    return hash, salt

def verify_recovery_key(key: str, hash: str, salt: str) -> bool:
    try:
        ph.verify(hash, f"{key}{salt}")
        return True
    except:
        return False

# ---------- Endpoints ----------
@app.post("/api/heartbeat")
async def heartbeat(req: HeartbeatRequest):
    # Update last_heartbeat and reset status if in grace period
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
    
    # Log
    supabase.table("audit_logs").insert({
        "user_id": req.user_id,
        "action": "heartbeat",
        "metadata": {"status": new_status}
    }).execute()
    
    return {"status": "ok"}

@app.post("/api/vault/save")
async def save_vault(req: VaultSaveRequest):
    # Check if user exists
    user = supabase.table("users").select("id").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")
    
    # Check if vault exists, update or insert
    existing = supabase.table("vaults").select("id").eq("user_id", req.user_id).execute()
    if existing.data:
        supabase.table("vaults").update({
            "encrypted_data": req.encrypted_data,
            "platform_metadata": req.platform_metadata
        }).eq("user_id", req.user_id).execute()
    else:
        supabase.table("vaults").insert({
            "user_id": req.user_id,
            "encrypted_data": req.encrypted_data,
            "platform_metadata": req.platform_metadata
        }).execute()
    
    return {"status": "saved"}

@app.get("/api/vault/{user_id}")
async def get_vault(user_id: str):
    vault = supabase.table("vaults").select("encrypted_data").eq("user_id", user_id).execute()
    if not vault.data:
        raise HTTPException(404, "Vault not found")
    return {"encrypted_data": vault.data[0]["encrypted_data"]}

@app.post("/api/settlement/verify")
async def verify_recovery(req: VerifyRequest):
    user = supabase.table("users").select("*").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")
    user_data = user.data[0]
    
    if not verify_recovery_key(req.recovery_key, user_data["recovery_key_hash"], user_data["salt"]):
        raise HTTPException(401, "Invalid recovery key")
    
    # Generate settlement token
    token = secrets.token_urlsafe(32)
    supabase.table("users").update({
        "settlement_token": token,
        "status": "deceased"
    }).eq("id", req.user_id).execute()
    
    # Log
    supabase.table("audit_logs").insert({
        "user_id": req.user_id,
        "action": "settlement_verified",
        "metadata": {"token_generated": True}
    }).execute()
    
    return {"settlement_token": token}

@app.post("/api/settlement/complete")
async def complete_settlement(req: SettlementTriggerRequest):
    # Mark all accounts as deleted – in practice you'd update platform status
    # Here we just log and clean up
    supabase.table("users").update({
        "status": "settled"
    }).eq("id", req.user_id).execute()
    
    # Optionally delete vault
    supabase.table("vaults").delete().eq("user_id", req.user_id).execute()
    
    supabase.table("audit_logs").insert({
        "user_id": req.user_id,
        "action": "settlement_complete"
    }).execute()
    
    return {"status": "complete"}

# ---------- Scheduler (simplified: runs on startup) ----------
@app.on_event("startup")
async def startup_event():
    # This would be a cron job in production
    # For now, we'll just run a check manually via endpoint
    pass

@app.get("/api/admin/check-inactive")
async def check_inactive():
    # Find users with no heartbeat for 30 days
    cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
    inactive = supabase.table("users").select("*").eq("status", "active").lt("last_heartbeat", cutoff).execute()
    
    for user in inactive.data:
        # Move to grace period
        supabase.table("users").update({
            "status": "grace_period",
            "grace_period_start": datetime.utcnow().isoformat()
        }).eq("id", user["id"]).execute()
        
        # Send notifications (placeholder)
        print(f"GRACE PERIOD STARTED for {user['email']}")
    
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
        
        # Send settlement email (placeholder)
        print(f"SETTLEMENT TRIGGERED for {user['email']} token: {token}")
    
    return {"inactive": len(inactive.data), "expired": len(expired.data)}