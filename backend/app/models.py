from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, ForeignKey, Enum, Text
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
    bookings = relationship("Booking", back_populates="user", foreign_keys="Booking.user_id")

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
    responsible_email = Column(String, nullable=True)                 # email del responsabile: puo' approvare le prenotazioni
    technical_assistant = Column(String, nullable=True)               # assistente tecnico (AT)
    technical_assistant_email = Column(String, nullable=True)         # email dell'AT: vede le prenotazioni del locale
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
    # Conversazione con chi ha segnalato (visibile a lui e all'Ufficio Tecnico)
    messages = relationship(
        "TicketMessage", back_populates="ticket", cascade="all, delete-orphan",
        order_by="TicketMessage.created_at",
    )
    # Commenti interni dell'Ufficio Tecnico
    comments = relationship(
        "TicketComment", back_populates="ticket", cascade="all, delete-orphan",
        order_by="TicketComment.created_at",
    )
    # Foto allegate (i file sono nella cartella uploads del backend)
    attachments = relationship(
        "TicketAttachment", back_populates="ticket", cascade="all, delete-orphan",
        order_by="TicketAttachment.created_at",
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
    def messages_count(self):
        return len(self.messages)

    @property
    def attachments_count(self):
        return len(self.attachments)

    @property
    def awaiting_reporter(self):
        """True se l'ultimo messaggio e' dell'Ufficio Tecnico (si aspetta la risposta di chi ha segnalato)."""
        return bool(self.messages) and self.messages[-1].author_id != self.reporter_id

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

class TicketMessage(Base):
    """Messaggio della conversazione tra chi ha segnalato e l'Ufficio Tecnico
    (es. "Quale programma non si avvia?" -> "Office")."""
    __tablename__ = "ticket_messages"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # Risposta a un messaggio in particolare (come su WhatsApp)
    reply_to_id = Column(Integer, ForeignKey("ticket_messages.id", ondelete="SET NULL"), nullable=True)

    ticket = relationship("Ticket", back_populates="messages")
    author = relationship("User")
    reply_to = relationship("TicketMessage", remote_side=[id])

class TicketComment(Base):
    """Commento interno su un ticket, visibile solo all'Ufficio Tecnico."""
    __tablename__ = "ticket_comments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # Risposta a un commento in particolare (come su WhatsApp)
    reply_to_id = Column(Integer, ForeignKey("ticket_comments.id", ondelete="SET NULL"), nullable=True)

    ticket = relationship("Ticket", back_populates="comments")
    author = relationship("User")
    reply_to = relationship("TicketComment", remote_side=[id])

class TicketAttachment(Base):
    """Foto allegata a un ticket. Il file sta su disco (cartella uploads), qui solo i dati."""
    __tablename__ = "ticket_attachments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    uploader_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String, nullable=False)       # nome originale, solo da mostrare
    stored_name = Column(String, nullable=False, unique=True)  # nome casuale sul disco
    content_type = Column(String, nullable=False)
    size = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    ticket = relationship("Ticket", back_populates="attachments")
    uploader = relationship("User")

class NotificationType(str, enum.Enum):
    MENZIONE = "MENZIONE"          # qualcuno ti ha taggato con @ in un commento
    ASSEGNAZIONE = "ASSEGNAZIONE"  # ti e' stato assegnato un ticket
    STATO = "STATO"                # e' cambiato lo stato di una tua segnalazione
    PRENOTAZIONE = "PRENOTAZIONE"  # prenotazione da approvare, approvata o rifiutata
    MESSAGGIO = "MESSAGGIO"        # nuovo messaggio nella conversazione di un ticket
    RISPOSTA = "RISPOSTA"          # qualcuno ha risposto a un tuo messaggio o commento

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
    link = Column(String, nullable=True)  # pagina da aprire cliccando (es. /prenotazioni/gestione)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class BookingStatus(str, enum.Enum):
    APPROVATA = "APPROVATA"
    IN_ATTESA = "IN_ATTESA"    # deve approvarla il responsabile del locale o l'Ufficio Tecnico
    RIFIUTATA = "RIFIUTATA"

# Prenotazioni che occupano il locale (quelle rifiutate lo liberano)
ACTIVE_BOOKING_STATUSES = [BookingStatus.APPROVATA, BookingStatus.IN_ATTESA]

class Booking(Base):
    """Prenotazione di un locale.

    - Ore scolastiche: una riga per ogni ora (slot 1..8).
    - Orario libero (locali con free_schedule): una sola riga con slot vuoto e start_time/end_time.
    Le righe della stessa richiesta condividono lo stesso `code` e vengono approvate o rifiutate insieme."""
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, index=True, nullable=False)
    date = Column(Date, nullable=False, index=True)
    slot = Column(Integer, nullable=True)        # 1..8 (ora scolastica); vuoto se a orario libero
    start_time = Column(String, nullable=True)   # "HH:MM", solo orario libero
    end_time = Column(String, nullable=True)     # "HH:MM", solo orario libero
    extras = Column(Text, nullable=True)         # richieste extra (JSON), es. microfoni, proiezione
    purpose = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    status = Column(_text_enum(BookingStatus), default=BookingStatus.APPROVATA, nullable=False)
    status_reason = Column(String, nullable=True)   # perche' e' in attesa / note di approvazione
    reject_reason = Column(String, nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decided_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    room = relationship("Room", back_populates="bookings")
    user = relationship("User", back_populates="bookings", foreign_keys=[user_id])
    decided_by = relationship("User", foreign_keys=[decided_by_id])

class Resource(Base):
    """Risorsa prenotabile a quantita', es. un carrello mobile con N PC portatili."""
    __tablename__ = "resources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)        # es. "Carrello 1"
    quantity = Column(Integer, nullable=False)                 # numero di PC nel carrello
    plesso = Column(_text_enum(Plesso), default=Plesso.SEDE_PRINCIPALE, nullable=False)
    location = Column(String, nullable=True)                   # dove si trova di solito (es. "Ufficio tecnico, piano terra")
    description = Column(Text, nullable=True)                  # es. "PC Lenovo con Office e Arduino IDE"
    is_active = Column(Boolean, default=True, nullable=False)

    bookings = relationship("ResourceBooking", back_populates="resource", cascade="all, delete-orphan")

class ResourceBooking(Base):
    """Prenotazione di alcuni PC (o di tutto il carrello) per un'ora scolastica.
    Le righe della stessa richiesta (piu' ore dello stesso giorno) condividono il codice CR-XXXXXX."""
    __tablename__ = "resource_bookings"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, index=True, nullable=False)
    resource_id = Column(Integer, ForeignKey("resources.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)  # aula dove portare il carrello
    date = Column(Date, nullable=False, index=True)
    slot = Column(Integer, nullable=False)       # 1..8
    quantity = Column(Integer, nullable=False)   # PC prenotati
    whole_cart = Column(Boolean, default=False, nullable=False)
    purpose = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    resource = relationship("Resource", back_populates="bookings")
    user = relationship("User", foreign_keys=[user_id])
    room = relationship("Room")

class ScheduleVersion(Base):
    """Orario delle lezioni: per ogni locale, le ore occupate da lezioni (non prenotabili).
    Si conservano le versioni caricate; ne e' attiva una alla volta."""
    __tablename__ = "schedule_versions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    academic_year = Column(String, nullable=True)
    data = Column(Text, nullable=False)  # JSON: {"A01": {"1": {"1": true, ...}, ...}, ...}
    active = Column(Boolean, default=True, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
