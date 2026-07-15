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
def hash_recovery_key(client_hash: str, salt: str = None) -> tuple:
    """Hash the client-provided SHA-256 hash with Argon2id.
    
    The client sends a SHA-256 hash of the raw recovery key.
    We never receive the raw key — only its SHA-256 digest.
    We then store Argon2id(SHA-256(raw_key) + salt) in the database.
    """
    if not salt:
        salt = secrets.token_hex(16)
    hash_value = ph.hash(f"{client_hash}{salt}")
    return hash_value, salt

def verify_recovery_key(client_hash: str, stored_hash: str, salt: str) -> bool:
    """Verify client-provided SHA-256 hash against stored Argon2id hash.
    
    The client sends SHA-256(raw_key). We verify it against
    the stored Argon2id(SHA-256(raw_key) + salt).
    """
    try:
        ph.verify(stored_hash, f"{client_hash}{salt}")
        return True
    except Exception:
        return False

def generate_settlement_token() -> str:
    """Generate a secure one-time settlement token"""
    return secrets.token_urlsafe(32)

def generate_confirmation_token() -> str:
    """Generate a token for beneficiary grace-period confirmation links"""
    return secrets.token_urlsafe(24)