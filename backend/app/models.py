from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class UserBase(BaseModel):
    email: EmailStr
    beneficiary_email: Optional[EmailStr] = None

class UserCreate(UserBase):
    recovery_key_hash: str

class UserResponse(BaseModel):
    id: str
    email: str
    status: str
    last_heartbeat: str
    created_at: str
    beneficiary_email: Optional[str] = None

class HeartbeatRequest(BaseModel):
    user_id: str

class VaultSaveRequest(BaseModel):
    user_id: str
    encrypted_data: str
    platform_metadata: dict

class VerifyRequest(BaseModel):
    user_id: str
    recovery_key_hash: str

class SettlementTriggerRequest(BaseModel):
    user_id: str

class UserRegisterRequest(BaseModel):
    email: EmailStr
    recovery_key_hash: str
    beneficiary_email: Optional[EmailStr] = None

class SimulateInactivityRequest(BaseModel):
    user_id: str
    date: Optional[str] = None