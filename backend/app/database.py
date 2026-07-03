# database.py - Shared database client and helpers

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client
import argon2
import secrets

# Load .env from the backend/ directory (parent of app/)
# This ensures it works regardless of where uvicorn is launched from
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_env_path)

# Validate required environment variables
_supabase_url = os.getenv("SUPABASE_URL")
_supabase_key = os.getenv("SUPABASE_KEY")

if not _supabase_url or not _supabase_key:
    print(f"ERROR: SUPABASE_URL and SUPABASE_KEY must be set in {_env_path}")
    print(f"  SUPABASE_URL = {_supabase_url!r}")
    print(f"  SUPABASE_KEY = {'***set***' if _supabase_key else None}")
    sys.exit(1)

# Supabase client
supabase: Client = create_client(_supabase_url, _supabase_key)

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
    except Exception:
        return False

def generate_settlement_token() -> str:
    """Generate a secure one-time settlement token"""
    return secrets.token_urlsafe(32)