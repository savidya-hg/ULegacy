# database.py - Shared database client and helpers

import os
from dotenv import load_dotenv
from supabase import create_client, Client
import argon2
import secrets

load_dotenv()

# Supabase client
supabase: Client = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

# Argon2 password hasher
ph = argon2.PasswordHasher()

# ---------- Helper Functions ----------
def hash_recovery_key(key: str, salt: str = None) -> tuple:
    """Hash recovery key with Argon2id"""
    if not salt:
        salt = secrets.token_hex(16)
    hash_value = ph.hash(f"{key}{salt}")
    return hash_value, salt

def verify_recovery_key(key: str, hash_value: str, salt: str) -> bool:
    """Verify recovery key against stored hash"""
    try:
        ph.verify(hash_value, f"{key}{salt}")
        return True
    except:
        return False

def generate_settlement_token() -> str:
    """Generate a secure one-time settlement token"""
    return secrets.token_urlsafe(32)