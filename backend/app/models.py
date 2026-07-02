from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class UserBase(BaseModel):
    email: EmailStr
    beneficiary_email: Optional[EmailStr] = None
    beneficiary_phone: Optional[str] = None

class UserCreate(UserBase):
    recovery_key: str

class UserResponse(UserBase):
    id: str
    status: str
    last_heartbeat: datetime
    created_at: datetime

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

class UserRegisterRequest(BaseModel):
    email: EmailStr
    recovery_key: str
    beneficiary_email: Optional[EmailStr] = None
    beneficiary_phone: Optional[str] = None