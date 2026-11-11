from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime, date as DateType
from app.models import TicketStatus, UserRole, TicketPriority, TicketCategory, Plesso, RoomType

# --- SCHEMI UTENTE ---
class UserBase(BaseModel):
    email: str  # <--- Usiamo str al posto di EmailStr per evitare la dipendenza email-validator
    full_name: Optional[str] = None
    picture: Optional[str] = None
    created_at: Optional[datetime]

class UserCreate(UserBase):
    role: Optional[UserRole] = UserRole.UTENTE

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
class TicketCreate(BaseModel):
    room_id: int
    title: str
    description: str
    plesso: Plesso = Plesso.SEDE_PRINCIPALE
    category: TicketCategory = TicketCategory.ALTRO
    priority: TicketPriority = TicketPriority.MEDIA

class TicketStatusUpdate(BaseModel):
    status: TicketStatus
    # Usati solo quando lo stato diventa INOLTRATO_FACTOTUM
    factotum_code: Optional[str] = None
    factotum_notes: Optional[str] = None

class TicketResponse(BaseModel):
    id: int
    code: str
    title: str
    description: str
    status: TicketStatus
    plesso: Plesso
    category: TicketCategory
    priority: TicketPriority
    created_at: datetime
    updated_at: Optional[datetime] = None
    room_id: int
    room_code: Optional[str] = None
    reporter_id: int
    reporter_name: Optional[str] = None
    assignees: List["AssigneeOut"] = []
    assigned_to_name: Optional[str] = None   # nomi dei tecnici separati da virgola
    comments_count: int = 0
    taken_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    factotum_code: Optional[str] = None
    factotum_notes: Optional[str] = None
    factotum_date: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AssigneeOut(BaseModel):
    id: int
    name: str
    email: str
    picture: Optional[str] = None
    assigned_at: Optional[datetime] = None

class AssigneesUpdate(BaseModel):
    user_ids: List[int]

class StaffUserOut(BaseModel):
    id: int
    name: str
    email: str
    picture: Optional[str] = None
    role: UserRole

class CommentCreate(BaseModel):
    content: str

class CommentOut(BaseModel):
    id: int
    ticket_id: int
    author_id: int
    author_name: str
    author_email: str
    author_picture: Optional[str] = None
    content: str
    created_at: datetime

TicketResponse.model_rebuild()

# --- SCHEMI AULE ---
class RoomBase(BaseModel):
    code: str
    room_type: RoomType = RoomType.AULA
    plesso: Plesso = Plesso.SEDE_PRINCIPALE
    is_bookable: bool = False
    free_schedule: bool = False
    responsible: Optional[str] = None
    technical_assistant: Optional[str] = None
    equipment: Optional[str] = None

class RoomCreate(RoomBase):
    pass

class RoomResponse(RoomBase):
    id: int
    is_active: bool
    tickets: List[TicketResponse] = []

    model_config = ConfigDict(from_attributes=True)

# --- SCHEMI PRENOTAZIONI AULE ---
class BookingCreate(BaseModel):
    room_id: int
    date: DateType
    slots: List[int]  # ore scolastiche da 1 a 8
    purpose: str

class BookingResponse(BaseModel):
    id: int
    code: str
    room_id: int
    room_code: str
    user_id: int
    user_name: str
    user_email: str
    date: DateType
    slot: int
    purpose: str
    created_at: datetime
