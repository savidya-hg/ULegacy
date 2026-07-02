from fastapi import APIRouter, HTTPException
from ..database import supabase
from ..models import VaultSaveRequest

router = APIRouter(prefix="/api", tags=["vault"])

@router.post("/vault/save")
async def save_vault(req: VaultSaveRequest):
    """Save encrypted vault to server"""
    user = supabase.table("users").select("id").eq("id", req.user_id).execute()
    if not user.data:
        raise HTTPException(404, "User not found")

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

    supabase.table("audit_logs").insert({
        "user_id": req.user_id,
        "action": "vault_saved",
        "metadata": {"platforms": list(req.platform_metadata.get("accounts", []))}
    }).execute()

    return {"status": "saved"}

@router.get("/vault/{user_id}")
async def get_vault(user_id: str):
    """Get encrypted vault from server"""
    vault = supabase.table("vaults").select("encrypted_data").eq("user_id", user_id).execute()
    if not vault.data:
        raise HTTPException(404, "Vault not found")
    return {"encrypted_data": vault.data[0]["encrypted_data"]}