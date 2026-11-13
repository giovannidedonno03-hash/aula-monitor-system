from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, ForeignKey, Enum, Text, UniqueConstraint
from sqlalchemy.orm import relationship
import enum
from datetime import datetime
from app.database import Base


# I ruoli e gli stati sono salvati come testo (native_enum=False) cosi' si possono
# aggiungere o cambiare valori senza dover modificare i tipi ENUM di PostgreSQL.

class UserRole(str, enum.Enum):
    SUPERVISORE = "SUPERVISORE"                # gestisce tutto: utenti, aule, ticket
    MANAGER = "MANAGER"                        # personale dell'Ufficio Tecnico: lavora i ticket
    RESPONSABILE_LAB = "RESPONSABILE_LAB"      # docente responsabile di un laboratorio
    ASSISTENTE_TECNICO = "ASSISTENTE_TECNICO"  # assistente tecnico (AT) di laboratorio
    UTENTE = "UTENTE"                          # docente / personale: apre segnalazioni e prenota

# Ruoli dell'Ufficio Tecnico che possono lavorare i ticket
STAFF_ROLES = [UserRole.SUPERVISORE, UserRole.MANAGER]

class TicketStatus(str, enum.Enum):
    APERTO = "APERTO"
    IN_CARICO = "IN_CARICO"
    IN_ESECUZIONE = "IN_ESECUZIONE"
    INOLTRATO_FACTOTUM = "INOLTRATO_FACTOTUM"
    RISOLTO = "RISOLTO"

class TicketPriority(str, enum.Enum):
    BASSA = "BASSA"
    MEDIA = "MEDIA"
    ALTA = "ALTA"
    URGENTE = "URGENTE"

class TicketCategory(str, enum.Enum):
    INFORMATICO = "INFORMATICO"
    ELETTRICO = "ELETTRICO"
    IDRAULICO = "IDRAULICO"
    EDILE = "EDILE"
    ARREDI = "ARREDI"
    SICUREZZA = "SICUREZZA"
    ALTRO = "ALTRO"

class Plesso(str, enum.Enum):
    SEDE_PRINCIPALE = "SEDE_PRINCIPALE"   # sede di via Veronese ("Grassi")
    GIANELLI = "GIANELLI"                 # plesso Gianelli (locali G..)

class RoomType(str, enum.Enum):
    AULA = "AULA"
    AULA_PRIORITA = "AULA_PRIORITA"
    LAB = "LAB"
    NON_ASSEGNABILE = "NON_ASSEGNABILE"
    CORRIDOIO = "CORRIDOIO"
    PALESTRA = "PALESTRA"
    NOAULA = "NOAULA"


def _text_enum(enum_cls):
    return Enum(enum_cls, native_enum=False, length=30)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    role = Column(_text_enum(UserRole), default=UserRole.UTENTE, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tickets = relationship("Ticket", back_populates="reporter", foreign_keys="Ticket.reporter_id")
    bookings = relationship("Booking", back_populates="user")

class Room(Base):
    """Locale della scuola. Il codice e' Lettera piano (A, B, C, I, G, R, P) + numero,
    es. A01; i locali G sono nel plesso Gianelli."""
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)
    room_type = Column(_text_enum(RoomType), default=RoomType.AULA, nullable=False)
    plesso = Column(_text_enum(Plesso), default=Plesso.SEDE_PRINCIPALE, nullable=False)
    is_bookable = Column(Boolean, default=False, nullable=False)      # prenotabile dal sito
    free_schedule = Column(Boolean, default=False, nullable=False)    # prenotabile anche fuori dall'orario scolastico
    responsible = Column(String, nullable=True)                       # "Ne risponde"
    technical_assistant = Column(String, nullable=True)               # assistente tecnico (AT)
    equipment = Column(Text, nullable=True)                           # dotazioni, separate da " · "
    is_active = Column(Boolean, default=True)

    # Campi del vecchio modello, non piu' usati dal sito (restano per i dati esistenti)
    building = Column(String, nullable=True)
    capacity = Column(Integer, nullable=True)
    has_projector = Column(Boolean, nullable=True)

    tickets = relationship("Ticket", back_populates="room", cascade="all, delete-orphan")
    bookings = relationship("Booking", back_populates="room", cascade="all, delete-orphan")

class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    status = Column(_text_enum(TicketStatus), default=TicketStatus.APERTO, nullable=False)
    plesso = Column(_text_enum(Plesso), default=Plesso.SEDE_PRINCIPALE, nullable=False)
    category = Column(_text_enum(TicketCategory), default=TicketCategory.ALTRO, nullable=False)
    priority = Column(_text_enum(TicketPriority), default=TicketPriority.MEDIA, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True)

    # Presa in carico e chiusura da parte del tecnico
    taken_at = Column(DateTime, nullable=True)      # quando e' stato preso in carico
    resolved_at = Column(DateTime, nullable=True)   # quando e' stato segnato come risolto

    # Inoltro alla piattaforma FACTOTUM della Citta' metropolitana
    factotum_code = Column(String, nullable=True)
    factotum_notes = Column(Text, nullable=True)
    factotum_date = Column(DateTime, nullable=True)

    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Vecchio campo "un solo tecnico": all'avvio viene copiato in ticket_assignees e svuotato
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    room = relationship("Room", back_populates="tickets")
    reporter = relationship("User", back_populates="tickets", foreign_keys=[reporter_id])
    # Tecnici assegnati (anche piu' di uno), in ordine di assegnazione
    assignments = relationship(
        "TicketAssignee", back_populates="ticket", cascade="all, delete-orphan",
        order_by="TicketAssignee.assigned_at",
    )
    # Commenti interni dell'Ufficio Tecnico
    comments = relationship(
        "TicketComment", back_populates="ticket", cascade="all, delete-orphan",
        order_by="TicketComment.created_at",
    )

    @property
    def assignees(self):
        return [
            {
                "id": a.user.id,
                "name": a.user.full_name or a.user.email,
                "email": a.user.email,
                "picture": a.user.picture,
                "assigned_at": a.assigned_at,
            }
            for a in self.assignments
            if a.user is not None
        ]

    @property
    def assigned_to_name(self):
        names = [a["name"] for a in self.assignees]
        return ", ".join(names) if names else None

    @property
    def comments_count(self):
        return len(self.comments)

    @property
    def reporter_name(self):
        if not self.reporter:
            return None
        return self.reporter.full_name or self.reporter.email

    @property
    def room_code(self):
        return self.room.code if self.room else None

class TicketAssignee(Base):
    """Assegnazione di un tecnico (Manager o Supervisore) a un ticket."""
    __tablename__ = "ticket_assignees"

    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    assigned_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    assigned_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    ticket = relationship("Ticket", back_populates="assignments")
    user = relationship("User", foreign_keys=[user_id])
    assigned_by = relationship("User", foreign_keys=[assigned_by_id])

class TicketComment(Base):
    """Commento interno su un ticket, visibile solo all'Ufficio Tecnico."""
    __tablename__ = "ticket_comments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    ticket = relationship("Ticket", back_populates="comments")
    author = relationship("User")

class NotificationType(str, enum.Enum):
    MENZIONE = "MENZIONE"          # qualcuno ti ha taggato con @ in un commento
    ASSEGNAZIONE = "ASSEGNAZIONE"  # ti e' stato assegnato un ticket
    STATO = "STATO"                # e' cambiato lo stato di una tua segnalazione

class Notification(Base):
    """Notifica per un utente (campanella in alto)."""
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(_text_enum(NotificationType), nullable=False)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    # Se il ticket viene eliminato, le sue notifiche spariscono con lui
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class Booking(Base):
    """Prenotazione di un'aula: una riga per ogni ora (slot) prenotata.
    Le righe create con la stessa richiesta condividono lo stesso `code`."""
    __tablename__ = "bookings"
    __table_args__ = (
        UniqueConstraint("room_id", "date", "slot", name="uq_booking_room_date_slot"),
    )

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, index=True, nullable=False)
    date = Column(Date, nullable=False, index=True)
    slot = Column(Integer, nullable=False)  # 1..8 (ora scolastica)
    purpose = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    room = relationship("Room", back_populates="bookings")
    user = relationship("User", back_populates="bookings")
