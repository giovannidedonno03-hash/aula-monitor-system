from pydantic import BaseModel, ConfigDict, Field, field_validator
import json
from typing import Any, Dict, List, Optional
from datetime import datetime, date as DateType
from app.models import TicketStatus, UserRole, TicketPriority, TicketCategory, Plesso, RoomType, NotificationType

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
    token: str = Field(max_length=5000)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# --- SCHEMI TICKET ---
class TicketCreate(BaseModel):
    room_id: int
    title: str = Field(min_length=1, max_length=150)
    description: str = Field(min_length=1, max_length=4000)
    plesso: Plesso = Plesso.SEDE_PRINCIPALE
    category: TicketCategory = TicketCategory.ALTRO
    priority: TicketPriority = TicketPriority.MEDIA

class TicketStatusUpdate(BaseModel):
    status: TicketStatus
    # Usati solo quando lo stato diventa INOLTRATO_FACTOTUM
    factotum_code: Optional[str] = Field(default=None, max_length=50)
    factotum_notes: Optional[str] = Field(default=None, max_length=2000)

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
    messages_count: int = 0
    awaiting_reporter: bool = False   # l'Ufficio Tecnico ha fatto una domanda e aspetta risposta
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
    user_ids: List[int] = Field(max_length=50)

class StaffUserOut(BaseModel):
    id: int
    name: str
    email: str
    picture: Optional[str] = None
    role: UserRole

class CommentCreate(BaseModel):
    content: str = Field(max_length=4000)

class MessageOut(BaseModel):
    id: int
    ticket_id: int
    author_id: int
    author_name: str
    author_email: str
    author_picture: Optional[str] = None
    author_is_staff: bool     # True = risposta dell'Ufficio Tecnico
    content: str
    created_at: datetime

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

class NotificationOut(BaseModel):
    id: int
    type: NotificationType
    title: str
    message: str
    ticket_id: Optional[int] = None
    link: Optional[str] = None
    is_read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class NotificationList(BaseModel):
    unread: int
    items: List[NotificationOut]

# --- SCHEMI AULE ---
class RoomBase(BaseModel):
    code: str
    room_type: RoomType = RoomType.AULA
    plesso: Plesso = Plesso.SEDE_PRINCIPALE
    is_bookable: bool = False
    free_schedule: bool = False
    responsible: Optional[str] = None
    responsible_email: Optional[str] = None
    technical_assistant: Optional[str] = None
    technical_assistant_email: Optional[str] = None
    equipment: Optional[str] = None

class RoomCreate(RoomBase):
    # Limiti solo sui dati in ingresso (le risposte restano libere)
    code: str = Field(min_length=1, max_length=60)
    responsible: Optional[str] = Field(default=None, max_length=120)
    responsible_email: Optional[str] = Field(default=None, max_length=254)
    technical_assistant: Optional[str] = Field(default=None, max_length=120)
    technical_assistant_email: Optional[str] = Field(default=None, max_length=254)
    equipment: Optional[str] = Field(default=None, max_length=2000)

class RoomResponse(RoomBase):
    id: int
    is_active: bool

    model_config = ConfigDict(from_attributes=True)

# --- SCHEMI PRENOTAZIONI AULE ---
class BookingCreate(BaseModel):
    room_id: int
    date: DateType
    slots: List[int] = Field(default=[], max_length=8)   # ore scolastiche da 1 a 8
    start_time: Optional[str] = Field(default=None, max_length=5)   # "HH:MM", solo per i locali a orario libero
    end_time: Optional[str] = Field(default=None, max_length=5)
    extras: Optional[Dict[str, Any]] = Field(default=None, max_length=20)  # richieste extra (microfoni, proiezione, ...)
    purpose: str = Field(max_length=500)

    @field_validator("extras")
    @classmethod
    def _extras_small(cls, v):
        if v is not None and len(json.dumps(v)) > 2000:
            raise ValueError("richieste extra troppo lunghe")
        return v

class BookingResponse(BaseModel):
    id: int
    code: str
    room_id: int
    room_code: str
    user_id: int
    user_name: str
    user_email: str
    date: DateType
    slot: Optional[int] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    extras: Optional[Dict[str, Any]] = None
    purpose: str
    status: str
    status_reason: Optional[str] = None
    reject_reason: Optional[str] = None
    decided_by_name: Optional[str] = None
    decided_at: Optional[datetime] = None
    created_at: datetime

class BookingDecision(BaseModel):
    note: Optional[str] = Field(default=None, max_length=1000)   # per l'approvazione (facoltativa) o motivo del rifiuto (obbligatorio)

# --- SCHEMI CARRELLI MOBILI (risorse) ---
class ResourceBase(BaseModel):
    name: str
    quantity: int
    plesso: Plesso = Plesso.SEDE_PRINCIPALE
    location: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True

class ResourceCreate(ResourceBase):
    # Limiti solo sui dati in ingresso
    name: str = Field(min_length=1, max_length=100)
    quantity: int = Field(ge=0, le=1000)
    location: Optional[str] = Field(default=None, max_length=150)
    description: Optional[str] = Field(default=None, max_length=1000)

class ResourceResponse(ResourceBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class ResourceBookingCreate(BaseModel):
    resource_id: int
    date: DateType
    slots: List[int] = Field(max_length=8)   # ore scolastiche 1..8
    quantity: Optional[int] = None    # PC da prenotare (ignorato se whole_cart)
    whole_cart: bool = False          # tutto il carrello
    room_id: Optional[int] = None     # aula dove serve il carrello
    purpose: str = Field(max_length=500)

class ResourceBookingResponse(BaseModel):
    id: int
    code: str
    resource_id: int
    resource_name: str
    resource_total: int
    user_id: int
    user_name: str
    user_email: str
    room_id: Optional[int] = None
    room_code: Optional[str] = None
    date: DateType
    slot: int
    quantity: int
    whole_cart: bool
    purpose: str
    created_at: datetime

class ScheduleUpload(BaseModel):
    name: str = Field(max_length=100)
    academic_year: Optional[str] = Field(default=None, max_length=20)
    rooms: Dict[str, Dict[str, Dict[str, bool]]]  # aula -> giorno 1-5 -> ora 1-8 -> c'e' lezione
