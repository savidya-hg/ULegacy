from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
import secrets
import argon2
from supabase import create_client
import os

router = APIRouter(prefix="/api/auth", tags=["auth"])

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)
ph = argon2.PasswordHasher()

class RegisterRequest(BaseModel):
    email: str
    recovery_key: str
    beneficiary_email: str
    beneficiary_phone: str = None

@router.post("/register")
async def register(req: RegisterRequest):
    # Check if user already exists
    existing = supabase.table("users").select("id").eq("email", req.email).execute()
    if existing.data:
        raise HTTPException(400, "User already exists")

    # Hash the recovery key (store hash + salt)
    salt = secrets.token_hex(16)
    hashed_key = ph.hash(f"{req.recovery_key}{salt}")

    # Create user
    new_user = {
        "email": req.email,
        "beneficiary_email": req.beneficiary_email,
        "beneficiary_phone": req.beneficiary_phone,
        "recovery_key_hash": hashed_key,
        "salt": salt,
        "status": "active",
        "last_heartbeat": datetime.utcnow().isoformat(),
        "created_at": datetime.utcnow().isoformat()
    }

    result = supabase.table("users").insert(new_user).execute()
    
    if not result.data:
        raise HTTPException(500, "Failed to create user")

    user_id = result.data[0]["id"]

    # Create an empty vault for this user
    supabase.table("vaults").insert({
        "user_id": user_id,
        "encrypted_data": "{}",  # empty encrypted vault
        "platform_metadata": {}
    }).execute()

    return {
        "user_id": user_id,
        "email": req.email,
        "message": "User registered successfully"
    }

@router.post("/login")
async def login(req: RegisterRequest):
    # Simplified login - just verify user exists and recovery key matches
    user = supabase.table("users").select("*").eq("email", req.email).execute()
    if not user.data:
        raise HTTPException(404, "User not found")
    
    user_data = user.data[0]
    try:
        ph.verify(user_data["recovery_key_hash"], f"{req.recovery_key}{user_data['salt']}")
    except:
        raise HTTPException(401, "Invalid recovery key")

    return {
        "user_id": user_data["id"],
        "email": user_data["email"],
        "status": user_data["status"],
        "message": "Login successful"
    }