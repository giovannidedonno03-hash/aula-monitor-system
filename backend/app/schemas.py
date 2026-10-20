from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime
from app.models import TicketStatus, UserRole

# --- SCHEMI UTENTE ---
class UserBase(BaseModel):
    email: str  # <--- Usiamo str al posto di EmailStr per evitare la dipendenza email-validator
    full_name: Optional[str] = None
    picture: Optional[str] = None
    created_at: Optional[datetime]

class UserCreate(UserBase):
    role: Optional[UserRole] = UserRole.DOCENTE

class UserResponse(UserBase):
    id: int
    role: UserRole
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class GoogleAuthSchema(BaseModel):
    token: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# --- SCHEMI TICKET ---
import enum

class TicketStatus(str, enum.Enum):
    IN_ATTESA = "IN_ATTESA"
    IN_LAVORAZIONE = "IN_LAVORAZIONE"
    RISOLTO = "RISOLTO"

class TicketCreate(BaseModel):
    room_id: int
    title: str
    description: str

class TicketStatusUpdate(BaseModel):
    status: TicketStatus

class TicketResponse(BaseModel):
    id: int
    code: str
    title: str
    description: str
    status: TicketStatus
    created_at: datetime
    room_id: int
    reporter_id: int

    class Config:
        from_attributes = True


# --- SCHEMI AULE ---
class RoomBase(BaseModel):
    code: str
    building: str
    capacity: int
    has_projector: bool = True

class RoomCreate(RoomBase):
    pass

class RoomResponse(RoomBase):
    id: int
    is_active: bool
    tickets: List[TicketResponse] = []

    model_config = ConfigDict(from_attributes=True)