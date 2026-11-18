from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from collections import deque
import os
import time
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime, timedelta
from sqlalchemy import text
from pydantic import BaseModel
import csv
import io
from app.database import engine, Base, get_db, SessionLocal
import app.models as models
import app.schemas as schemas
from app.auth import verify_google_token, create_access_token, get_current_user, get_optional_user, require_role, email_allowed, domain_error, ALLOWED_EMAIL_DOMAIN, TV_KIOSK_KEY
import hmac
from app.room_import import parse_rooms_csv, apply_rooms
from app.notifications import notify, notify_status_change, notify_assigned, notify_mentions, notify_message
from app import bookings as booking_rules
from app import resources as resource_rules
import json

models.Base.metadata.create_all(bind=engine)

# --- MIGRAZIONI DEL DATABASE (eseguite a ogni avvio, sono idempotenti) ---
def _is_native_enum(conn, table: str, column: str) -> bool:
    row = conn.execute(text(
        "SELECT data_type FROM information_schema.columns WHERE table_name = :t AND column_name = :c"
    ), {"t": table, "c": column}).first()
    return bool(row and row[0] == "USER-DEFINED")

with engine.begin() as conn:
    # 1. Ruoli e stati passano da ENUM di PostgreSQL a testo semplice
    for table, column in (("users", "role"), ("tickets", "status")):
        if _is_native_enum(conn, table, column):
            conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE VARCHAR(30) USING {column}::text"))

    # 2. Nuovi ruoli (come il gestionale IIS Grassi)
    conn.execute(text("UPDATE users SET role = 'SUPERVISORE' WHERE role = 'ADMIN'"))
    conn.execute(text("UPDATE users SET role = 'MANAGER' WHERE role = 'TECNICO'"))
    conn.execute(text("UPDATE users SET role = 'UTENTE' WHERE role IN ('DOCENTE', 'STUDENTE')"))

    # 3. Nuovi stati dei ticket
    conn.execute(text("UPDATE tickets SET status = 'APERTO' WHERE status = 'IN_ATTESA'"))
    conn.execute(text("UPDATE tickets SET status = 'IN_CARICO' WHERE status = 'IN_LAVORAZIONE'"))

    # 4. Nuove colonne dei ticket
    for ddl in (
        "assigned_to_id INTEGER REFERENCES users(id)",
        "taken_at TIMESTAMP",
        "resolved_at TIMESTAMP",
        "updated_at TIMESTAMP",
        "plesso VARCHAR(30) NOT NULL DEFAULT 'SEDE_PRINCIPALE'",
        "category VARCHAR(30) NOT NULL DEFAULT 'ALTRO'",
        "priority VARCHAR(30) NOT NULL DEFAULT 'MEDIA'",
        "factotum_code VARCHAR",
        "factotum_notes TEXT",
        "factotum_date TIMESTAMP",
    ):
        conn.execute(text(f"ALTER TABLE tickets ADD COLUMN IF NOT EXISTS {ddl}"))

    # 5. Nuovi campi dei locali (elenco ufficiale della scuola)
    for ddl in (
        "room_type VARCHAR(30) NOT NULL DEFAULT 'AULA'",
        "plesso VARCHAR(30) NOT NULL DEFAULT 'SEDE_PRINCIPALE'",
        "is_bookable BOOLEAN NOT NULL DEFAULT FALSE",
        "free_schedule BOOLEAN NOT NULL DEFAULT FALSE",
        "responsible VARCHAR",
        "technical_assistant VARCHAR",
        "equipment TEXT",
    ):
        conn.execute(text(f"ALTER TABLE rooms ADD COLUMN IF NOT EXISTS {ddl}"))
    for column in ("building", "capacity", "has_projector"):
        conn.execute(text(f"ALTER TABLE rooms ALTER COLUMN {column} DROP NOT NULL"))

    # 6. Assegnazione a piu' tecnici: il vecchio tecnico unico passa nella tabella ticket_assignees
    conn.execute(text("""
        INSERT INTO ticket_assignees (ticket_id, user_id, assigned_at)
        SELECT t.id, t.assigned_to_id, COALESCE(t.taken_at, t.created_at, NOW())
        FROM tickets t
        WHERE t.assigned_to_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = t.assigned_to_id
          )
    """))
    conn.execute(text("UPDATE tickets SET assigned_to_id = NULL WHERE assigned_to_id IS NOT NULL"))

    # 7. Prenotazioni con approvazione e orario libero; email di responsabile e AT sui locali
    conn.execute(text("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS uq_booking_room_date_slot"))
    conn.execute(text("ALTER TABLE bookings ALTER COLUMN slot DROP NOT NULL"))
    for ddl in (
        "start_time VARCHAR(5)",
        "end_time VARCHAR(5)",
        "extras TEXT",
        "status VARCHAR(30) NOT NULL DEFAULT 'APPROVATA'",
        "status_reason VARCHAR",
        "reject_reason VARCHAR",
        "decided_at TIMESTAMP",
        "decided_by_id INTEGER REFERENCES users(id)",
    ):
        conn.execute(text(f"ALTER TABLE bookings ADD COLUMN IF NOT EXISTS {ddl}"))
    for ddl in ("responsible_email VARCHAR", "technical_assistant_email VARCHAR"):
        conn.execute(text(f"ALTER TABLE rooms ADD COLUMN IF NOT EXISTS {ddl}"))
    conn.execute(text("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link VARCHAR"))

# Orario delle lezioni iniziale (data/orario_lezioni.json) al primo avvio
with SessionLocal() as _db:
    booking_rules.ensure_default_schedule(_db)

app = FastAPI(title="Aula Monitor API")

# --- PROTEZIONI GENERALI ---

# Errori di validazione (campo mancante, testo troppo lungo, ...) con un messaggio
# leggibile in italiano invece della lista tecnica di Pydantic.
FIELD_LABELS = {
    "title": "Titolo", "description": "Descrizione", "content": "Testo", "purpose": "Motivo",
    "note": "Nota", "factotum_code": "Codice FACTOTUM", "factotum_notes": "Note FACTOTUM",
    "code": "Codice", "name": "Nome", "responsible": "Responsabile", "responsible_email": "Email responsabile",
    "technical_assistant": "Assistente tecnico", "technical_assistant_email": "Email assistente tecnico",
    "equipment": "Dotazioni", "location": "Posizione", "quantity": "Numero di PC", "slots": "Ore",
    "extras": "Richieste extra", "user_ids": "Tecnici", "token": "Token",
}

@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    messages = []
    for err in exc.errors():
        field = str(err.get("loc", ["", ""])[-1])
        label = FIELD_LABELS.get(field, field)
        ctx = err.get("ctx") or {}
        kind = err.get("type", "")
        if kind == "string_too_long":
            messages.append(f"{label}: massimo {ctx.get('max_length')} caratteri.")
        elif kind == "string_too_short":
            messages.append(f"{label}: campo obbligatorio.")
        elif kind == "too_long":
            messages.append(f"{label}: troppi elementi.")
        elif kind == "missing":
            messages.append(f"{label}: campo obbligatorio.")
        else:
            messages.append(f"{label}: valore non valido.")
    return JSONResponse(status_code=422, content={"detail": " ".join(messages) or "Dati non validi."})

# Limite al numero di richieste per indirizzo IP, in una finestra di 60 secondi.
# In produzione l'IP e' quello reale del visitatore (Caddy lo passa e uvicorn usa --proxy-headers).
# Il limite generale e' alto perche' tutta la scuola puo' uscire su internet con lo stesso IP.
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "1200"))
LOGIN_LIMIT_PER_MINUTE = int(os.getenv("LOGIN_LIMIT_PER_MINUTE", "30"))
MAX_BODY_BYTES = 2 * 1024 * 1024   # 2 MB: bastano per l'orario delle lezioni e il CSV dei locali
_hits: dict[str, deque] = {}
_hits_cleanup = [0.0]

def _rate_limited(key: str, limit: int, now: float) -> bool:
    q = _hits.setdefault(key, deque())
    while q and q[0] <= now - 60:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False

@app.middleware("http")
async def security_limits(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    # Corpo della richiesta troppo grande
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"detail": "Richiesta troppo grande (massimo 2 MB)."})

    now = time.monotonic()
    if now - _hits_cleanup[0] > 300:   # ogni 5 minuti si dimenticano gli IP inattivi
        for k in [k for k, q in _hits.items() if not q or q[-1] <= now - 60]:
            del _hits[k]
        _hits_cleanup[0] = now

    ip = request.client.host if request.client else "sconosciuto"
    limited = _rate_limited(f"all:{ip}", RATE_LIMIT_PER_MINUTE, now)
    if not limited and request.url.path == "/api/v1/auth/google":
        limited = _rate_limited(f"login:{ip}", LOGIN_LIMIT_PER_MINUTE, now)
    if limited:
        return JSONResponse(
            status_code=429,
            content={"detail": "Troppe richieste: riprova tra un minuto."},
            headers={"Retry-After": "60"},
        )
    return await call_next(request)

# CORS: in produzione sito e API hanno lo stesso indirizzo, quindi basta ammettere il dominio
# del sito (CORS_ORIGINS nel .env, separati da virgola). Vuoto = tutti (sviluppo sul PC e in rete locale).
# Il login usa il token nell'header Authorization, non i cookie: allow_credentials non serve.
CORS_ORIGINS = [o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# --- AUTH ---
@app.post("/api/v1/auth/google", response_model=schemas.TokenResponse)
def google_auth(auth_data: schemas.GoogleAuthSchema, db: Session = Depends(get_db)):
    id_info = verify_google_token(auth_data.token)
    email = id_info.get("email")
    full_name = id_info.get("name")
    picture = id_info.get("picture")

    if not email:
        raise HTTPException(status_code=400, detail="Impossibile estrarre l'email da Google.")
    if not email_allowed(email) or id_info.get("email_verified") is False:
        raise domain_error()

    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        # Se non c'e' ancora nessun Supervisore con l'email della scuola, chi accede per primo
        # lo diventa (cosi' attivando il blocco del dominio non si resta senza amministratore).
        # Tutti gli altri nuovi utenti sono UTENTE.
        has_school_supervisor = any(
            email_allowed(u.email)
            for u in db.query(models.User).filter(
                models.User.role == models.UserRole.SUPERVISORE, models.User.is_active == True
            ).all()
        )
        role = models.UserRole.UTENTE if has_school_supervisor else models.UserRole.SUPERVISORE

        user = models.User(
            email=email,
            full_name=full_name,
            picture=picture,
            role=role
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    access_token = create_access_token(data={"sub": user.email, "role": user.role.value})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }

# Configurazione pubblica del login (dominio email ammesso), usata dal pulsante di accesso
@app.get("/api/v1/auth/config")
def get_auth_config():
    return {"allowed_domain": ALLOWED_EMAIL_DOMAIN or None}

@app.get("/api/v1/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user


# --- ROOMS (AULE) ---

# Lettura: solo utenti autenticati (la composizione della scuola non e' pubblica)
@app.get("/api/v1/rooms", response_model=List[schemas.RoomResponse])
def get_rooms(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Room).order_by(models.Room.code.asc()).all()

# Creazione Aula: Solo SUPERVISORE
@app.post("/api/v1/rooms", response_model=schemas.RoomResponse)
def create_room(
    room: schemas.RoomCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE]))
):
    room_data = room.model_dump() if hasattr(room, "model_dump") else room.dict()
    existing_room = db.query(models.Room).filter(models.Room.code == room.code).first()
    if existing_room:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Un'aula con il codice '{room.code}' esiste già."
        )

    db_room = models.Room(**room_data)
    db.add(db_room)
    db.commit()
    db.refresh(db_room)
    return db_room

# Modifica Aula: Solo SUPERVISORE
@app.put("/api/v1/rooms/{room_id}", response_model=schemas.RoomResponse)
def update_room(
    room_id: int,
    room_in: schemas.RoomCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE]))
):
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Aula non trovata.")
    code = room_in.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Il codice del locale e' obbligatorio.")
    duplicate = db.query(models.Room).filter(models.Room.code == code, models.Room.id != room_id).first()
    if duplicate:
        raise HTTPException(status_code=400, detail=f"Un locale con il codice '{code}' esiste gia'.")

    data = room_in.model_dump()
    data["code"] = code
    if not data["is_bookable"]:
        data["free_schedule"] = False
    for key, value in data.items():
        setattr(room, key, value)
    db.commit()
    db.refresh(room)
    return room

# Attiva/Disattiva Aula: Solo SUPERVISORE
@app.patch("/api/v1/rooms/{room_id}/toggle", response_model=schemas.RoomResponse)
def toggle_room_status(
    room_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE]))
):
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Aula non trovata.")
    
    room.is_active = not room.is_active
    db.commit()
    db.refresh(room)
    return room

# Eliminazione Aula: Solo SUPERVISORE
@app.delete("/api/v1/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_room(
    room_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE]))
):
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Aula non trovata.")
    
    db.delete(room)
    db.commit()
    return None

import uuid

# --- TICKETS ---

def _is_staff(user: models.User) -> bool:
    return user.role in models.STAFF_ROLES

# Lettura ticket: l'Ufficio Tecnico (SUPERVISORE, MANAGER) vede tutto,
# gli altri ruoli vedono solo le proprie segnalazioni.
@app.get("/api/v1/tickets", response_model=List[schemas.TicketResponse])
def get_tickets(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Ticket)
    if not _is_staff(current_user):
        q = q.filter(models.Ticket.reporter_id == current_user.id)
    return q.order_by(models.Ticket.created_at.desc()).all()

# Creazione Ticket: tutti gli utenti autenticati
@app.post("/api/v1/tickets", response_model=schemas.TicketResponse)
def create_ticket(
    ticket_in: schemas.TicketCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    room = db.query(models.Room).filter(models.Room.id == ticket_in.room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Aula non trovata.")

    ticket_code = f"TCK-{uuid.uuid4().hex[:6].upper()}"
    new_ticket = models.Ticket(
        code=ticket_code,
        title=ticket_in.title,
        description=ticket_in.description,
        status=models.TicketStatus.APERTO,
        plesso=room.plesso,  # il plesso e' sempre quello del locale scelto
        category=ticket_in.category,
        priority=ticket_in.priority,
        room_id=ticket_in.room_id,
        reporter_id=current_user.id,
    )
    db.add(new_ticket)
    db.commit()
    db.refresh(new_ticket)
    return new_ticket

# Cambio Stato Ticket: riservato all'Ufficio Tecnico (SUPERVISORE, MANAGER)
@app.patch("/api/v1/tickets/{ticket_id}/status", response_model=schemas.TicketResponse)
def update_ticket_status(
    ticket_id: int,
    status_update: schemas.TicketStatusUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.STAFF_ROLES)),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato.")

    new_status = status_update.status
    old_status = ticket.status
    now = datetime.utcnow()

    if new_status == models.TicketStatus.APERTO:
        # Torna aperto: si azzerano assegnazioni e date
        ticket.assignments.clear()
        ticket.taken_at = None
        ticket.resolved_at = None
    else:
        # Qualsiasi altro stato implica che qualcuno se ne stia occupando:
        # se nessuno era assegnato, diventa assegnatario chi cambia lo stato
        if not ticket.assignments:
            ticket.assignments.append(
                models.TicketAssignee(user_id=current_user.id, assigned_at=now, assigned_by_id=current_user.id)
            )
        if ticket.taken_at is None:
            ticket.taken_at = now
        ticket.resolved_at = now if new_status == models.TicketStatus.RISOLTO else None

    if new_status == models.TicketStatus.INOLTRATO_FACTOTUM:
        # Codice della pratica sulla piattaforma FACTOTUM (generato se non indicato, come nel gestionale Grassi)
        code = (status_update.factotum_code or "").strip()
        ticket.factotum_code = code or f"TO-FACT-{now.year}-{uuid.uuid4().int % 9000 + 1000}"
        ticket.factotum_notes = (status_update.factotum_notes or "").strip() or None
        ticket.factotum_date = now

    ticket.status = new_status
    ticket.updated_at = now
    notify_status_change(db, ticket, old_status, current_user)
    db.commit()
    db.refresh(ticket)
    return ticket

# Eliminazione Ticket: chi l'ha creato oppure il SUPERVISORE
@app.delete("/api/v1/tickets/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato.")
    if ticket.reporter_id != current_user.id and current_user.role != models.UserRole.SUPERVISORE:
        raise HTTPException(status_code=403, detail="Puoi eliminare solo le segnalazioni che hai creato tu.")
    db.delete(ticket)
    db.commit()
    return None

# --- ASSEGNAZIONE DEI TICKET ---

def _staff_query(db: Session):
    return db.query(models.User).filter(models.User.is_active == True, models.User.role.in_(models.STAFF_ROLES))

def _set_assignees(db: Session, ticket: models.Ticket, user_ids: List[int], by: models.User):
    """Imposta gli assegnatari del ticket e aggiorna stato e date di conseguenza."""
    now = datetime.utcnow()
    old_status = ticket.status
    wanted = list(dict.fromkeys(user_ids))  # senza duplicati, ordine mantenuto
    current = {a.user_id: a for a in ticket.assignments}
    added = [uid for uid in wanted if uid not in current]

    for a in list(ticket.assignments):
        if a.user_id not in wanted:
            ticket.assignments.remove(a)
    for uid in wanted:
        if uid not in current:
            ticket.assignments.append(models.TicketAssignee(user_id=uid, assigned_at=now, assigned_by_id=by.id))

    if wanted:
        # Un ticket aperto che riceve un tecnico passa "In Carico"
        if ticket.status == models.TicketStatus.APERTO:
            ticket.status = models.TicketStatus.IN_CARICO
        if ticket.taken_at is None:
            ticket.taken_at = now
    elif ticket.status == models.TicketStatus.IN_CARICO:
        # Nessuno se ne occupa piu': torna Aperto
        ticket.status = models.TicketStatus.APERTO
        ticket.taken_at = None
    ticket.updated_at = now

    # Notifiche: ai tecnici appena aggiunti e a chi ha aperto la segnalazione se cambia lo stato
    notify_assigned(db, ticket, added, by)
    notify_status_change(db, ticket, old_status, by)

def _get_ticket_or_404(db: Session, ticket_id: int) -> models.Ticket:
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato.")
    return ticket

# Elenco dei tecnici assegnabili (Manager e Supervisore)
@app.get("/api/v1/users/staff", response_model=List[schemas.StaffUserOut])
def get_staff_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.STAFF_ROLES)),
):
    users = _staff_query(db).order_by(models.User.full_name.asc()).all()
    return [
        {"id": u.id, "name": u.full_name or u.email, "email": u.email, "picture": u.picture, "role": u.role}
        for u in users
    ]

# Il Supervisore sceglie i tecnici del ticket (uno o piu')
@app.put("/api/v1/tickets/{ticket_id}/assignees", response_model=schemas.TicketResponse)
def set_ticket_assignees(
    ticket_id: int,
    data: schemas.AssigneesUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE])),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    staff_ids = {u.id for u in _staff_query(db).all()}
    invalid = [uid for uid in data.user_ids if uid not in staff_ids]
    if invalid:
        raise HTTPException(status_code=400, detail="Si possono assegnare solo utenti Manager o Supervisore.")
    _set_assignees(db, ticket, data.user_ids, current_user)
    db.commit()
    db.refresh(ticket)
    return ticket

# Un tecnico prende in carico il ticket (si aggiunge agli assegnatari)
@app.post("/api/v1/tickets/{ticket_id}/presa-in-carico", response_model=schemas.TicketResponse)
def take_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.STAFF_ROLES)),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    ids = [a.user_id for a in ticket.assignments]
    if current_user.id not in ids:
        _set_assignees(db, ticket, ids + [current_user.id], current_user)
        db.commit()
        db.refresh(ticket)
    return ticket

# Un tecnico lascia la presa in carico
@app.delete("/api/v1/tickets/{ticket_id}/presa-in-carico", response_model=schemas.TicketResponse)
def release_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.STAFF_ROLES)),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    ids = [a.user_id for a in ticket.assignments]
    if current_user.id in ids:
        _set_assignees(db, ticket, [i for i in ids if i != current_user.id], current_user)
        db.commit()
        db.refresh(ticket)
    return ticket


# --- CONVERSAZIONE CON CHI HA SEGNALATO ---
# Visibile e scrivibile da chi ha aperto il ticket e dall'Ufficio Tecnico (Supervisore, Manager).

MAX_TEXT = 4000  # lunghezza massima di un messaggio o commento

def _can_talk(user: models.User, ticket: models.Ticket) -> bool:
    return user.role in models.STAFF_ROLES or ticket.reporter_id == user.id

def _message_out(m: models.TicketMessage) -> dict:
    return {
        "id": m.id,
        "ticket_id": m.ticket_id,
        "author_id": m.author_id,
        "author_name": (m.author.full_name or m.author.email) if m.author else "",
        "author_email": m.author.email if m.author else "",
        "author_picture": m.author.picture if m.author else None,
        "author_is_staff": bool(m.author and m.author.role in models.STAFF_ROLES and m.author_id != m.ticket.reporter_id),
        "content": m.content,
        "created_at": m.created_at,
    }

@app.get("/api/v1/tickets/{ticket_id}/messages", response_model=List[schemas.MessageOut])
def get_ticket_messages(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    if not _can_talk(current_user, ticket):
        raise HTTPException(status_code=403, detail="Non puoi vedere questa conversazione.")
    return [_message_out(m) for m in ticket.messages]

@app.post("/api/v1/tickets/{ticket_id}/messages", response_model=schemas.MessageOut)
def add_ticket_message(
    ticket_id: int,
    data: schemas.CommentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    if not _can_talk(current_user, ticket):
        raise HTTPException(status_code=403, detail="Non puoi scrivere in questa conversazione.")
    content = data.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Il messaggio e' vuoto.")
    if len(content) > MAX_TEXT:
        raise HTTPException(status_code=400, detail=f"Il messaggio e' troppo lungo (massimo {MAX_TEXT} caratteri).")
    msg = models.TicketMessage(ticket_id=ticket.id, author_id=current_user.id, content=content)
    db.add(msg)
    ticket.updated_at = datetime.utcnow()
    db.flush()
    notify_message(db, ticket, current_user, content)
    db.commit()
    db.refresh(msg)
    return _message_out(msg)


# --- COMMENTI INTERNI (solo Ufficio Tecnico) ---

def _comment_out(c: models.TicketComment) -> dict:
    return {
        "id": c.id,
        "ticket_id": c.ticket_id,
        "author_id": c.author_id,
        "author_name": (c.author.full_name or c.author.email) if c.author else "",
        "author_email": c.author.email if c.author else "",
        "author_picture": c.author.picture if c.author else None,
        "content": c.content,
        "created_at": c.created_at,
    }

@app.get("/api/v1/tickets/{ticket_id}/comments", response_model=List[schemas.CommentOut])
def get_ticket_comments(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.STAFF_ROLES)),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    return [_comment_out(c) for c in ticket.comments]

@app.post("/api/v1/tickets/{ticket_id}/comments", response_model=schemas.CommentOut)
def add_ticket_comment(
    ticket_id: int,
    data: schemas.CommentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.STAFF_ROLES)),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    content = data.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Il commento e' vuoto.")
    if len(content) > MAX_TEXT:
        raise HTTPException(status_code=400, detail=f"Il commento e' troppo lungo (massimo {MAX_TEXT} caratteri).")
    comment = models.TicketComment(ticket_id=ticket.id, author_id=current_user.id, content=content)
    db.add(comment)
    ticket.updated_at = datetime.utcnow()
    notify_mentions(db, ticket, content, current_user)
    db.commit()
    db.refresh(comment)
    return _comment_out(comment)

# Elimina un commento: l'autore oppure il Supervisore
@app.delete("/api/v1/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ticket_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.STAFF_ROLES)),
):
    comment = db.query(models.TicketComment).filter(models.TicketComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Commento non trovato.")
    if comment.author_id != current_user.id and current_user.role != models.UserRole.SUPERVISORE:
        raise HTTPException(status_code=403, detail="Puoi eliminare solo i tuoi commenti.")
    db.delete(comment)
    db.commit()
    return None


# --- NOTIFICHE (campanella) ---

@app.get("/api/v1/notifications", response_model=schemas.NotificationList)
def get_my_notifications(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Notification).filter(models.Notification.user_id == current_user.id)
    unread = q.filter(models.Notification.is_read == False).count()  # noqa: E712
    items = q.order_by(models.Notification.created_at.desc()).limit(30).all()
    return {"unread": unread, "items": items}

@app.post("/api/v1/notifications/{notification_id}/letta", status_code=status.HTTP_204_NO_CONTENT)
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    n = db.query(models.Notification).filter(
        models.Notification.id == notification_id, models.Notification.user_id == current_user.id
    ).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notifica non trovata.")
    n.is_read = True
    db.commit()
    return None

@app.post("/api/v1/notifications/lette", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db.query(models.Notification).filter(
        models.Notification.user_id == current_user.id, models.Notification.is_read == False  # noqa: E712
    ).update({models.Notification.is_read: True}, synchronize_session=False)
    db.commit()
    return None


# --- STATISTICHE (solo Ufficio Tecnico) ---

def _hours(start, end):
    return (end - start).total_seconds() / 3600 if start and end and end >= start else None

def _avg(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 1) if values else None

@app.get("/api/v1/stats")
def get_stats(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.STAFF_ROLES)),
):
    S = models.TicketStatus
    tickets = db.query(models.Ticket).all()
    total = len(tickets)
    resolved = [t for t in tickets if t.status == S.RISOLTO]

    def breakdown(enum_cls, attr):
        rows = []
        for value in enum_cls:
            group = [t for t in tickets if getattr(t, attr) == value]
            rows.append({
                "id": value.value,
                "total": len(group),
                "open": sum(1 for t in group if t.status != S.RISOLTO),
            })
        return rows

    # Carico di lavoro per tecnico: tutto lo staff + chiunque abbia ticket assegnati
    people = {u.id: u for u in _staff_query(db).all()}
    for t in tickets:
        for a in t.assignments:
            if a.user is not None:
                people.setdefault(a.user_id, a.user)
    technicians = []
    for uid, u in people.items():
        mine = [t for t in tickets if any(a.user_id == uid for a in t.assignments)]
        mine_resolved = [t for t in mine if t.status == S.RISOLTO]
        technicians.append({
            "id": uid,
            "name": u.full_name or u.email,
            "email": u.email,
            "picture": u.picture,
            "role": u.role.value,
            "open": len(mine) - len(mine_resolved),
            "resolved": len(mine_resolved),
            "avg_resolution_hours": _avg(_hours(t.created_at, t.resolved_at) for t in mine_resolved),
        })
    technicians.sort(key=lambda x: (-x["open"], -x["resolved"], x["name"]))

    # Andamento ultimi 14 giorni: ticket aperti e risolti per giorno
    today = datetime.utcnow().date()
    days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    trend = [
        {
            "date": d.isoformat(),
            "opened": sum(1 for t in tickets if t.created_at and t.created_at.date() == d),
            "resolved": sum(1 for t in resolved if t.resolved_at and t.resolved_at.date() == d),
        }
        for d in days
    ]

    return {
        "total": total,
        "open": total - len(resolved),
        "resolved": len(resolved),
        "resolution_rate": round(len(resolved) / total, 3) if total else None,
        "unassigned": sum(1 for t in tickets if t.status != S.RISOLTO and not t.assignments),
        "avg_take_hours": _avg(_hours(t.created_at, t.taken_at) for t in tickets),
        "avg_resolution_hours": _avg(_hours(t.created_at, t.resolved_at) for t in resolved),
        "by_status": breakdown(S, "status"),
        "by_priority": breakdown(models.TicketPriority, "priority"),
        "by_category": breakdown(models.TicketCategory, "category"),
        "by_plesso": breakdown(models.Plesso, "plesso"),
        "technicians": technicians,
        "trend": trend,
    }


# --- DASHBOARD METRICS ---

@app.get("/api/v1/dashboard/stats")
def get_dashboard_stats(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    S = models.TicketStatus
    total_rooms = db.query(models.Room).count()
    active_rooms = db.query(models.Room).filter(models.Room.is_active == True).count()

    def count(*statuses):
        return db.query(models.Ticket).filter(models.Ticket.status.in_(statuses)).count()

    recent_tickets = (
        db.query(models.Ticket)
        .order_by(models.Ticket.created_at.desc())
        .limit(5)
        .all()
    )

    return {
        "rooms": {
            "total": total_rooms,
            "active": active_rooms,
            "inactive": total_rooms - active_rooms,
        },
        "tickets": {
            "total": db.query(models.Ticket).count(),
            "pending": count(S.APERTO),
            "in_progress": count(S.IN_CARICO, S.IN_ESECUZIONE),
            "factotum": count(S.INOLTRATO_FACTOTUM),
            "resolved": count(S.RISOLTO),
        },
        "recent_tickets": [schemas.TicketResponse.model_validate(t) for t in recent_tickets],
    }

# --- DASHBOARD TV (Smart TV dell'Ufficio Tecnico) ---
# Visibile all'Ufficio Tecnico dopo il login, oppure al televisore in modalita' kiosk
# con la chiave segreta TV_KIOSK_KEY: /tv?kiosk=CHIAVE (la pagina la passa come ?key=).
@app.get("/api/v1/tv")
def get_tv_data(
    key: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_user),
):
    kiosk_ok = bool(TV_KIOSK_KEY) and key is not None and hmac.compare_digest(key, TV_KIOSK_KEY)
    if not kiosk_ok and (current_user is None or current_user.role not in models.STAFF_ROLES):
        raise HTTPException(status_code=403, detail="Dashboard TV riservata all'Ufficio Tecnico (o chiave kiosk non valida).")
    week_ago = datetime.utcnow() - timedelta(days=7)
    tickets = (
        db.query(models.Ticket)
        .filter(
            (models.Ticket.status != models.TicketStatus.RISOLTO)
            | (models.Ticket.resolved_at >= week_ago)
        )
        .order_by(models.Ticket.created_at.desc())
        .all()
    )
    # Tecnici mostrati nel riquadro "Carico Tecnici": tutto l'Ufficio Tecnico
    # (Manager e Supervisore) piu' chiunque abbia ticket assegnati ancora aperti
    assigned_ids = {
        a.user_id for t in tickets if t.status != models.TicketStatus.RISOLTO for a in t.assignments
    }
    technicians = (
        db.query(models.User)
        .filter(
            models.User.is_active == True,
            (models.User.role.in_(models.STAFF_ROLES)) | (models.User.id.in_(list(assigned_ids) or [-1])),
        )
        .order_by(models.User.full_name.asc())
        .all()
    )
    return {
        "tickets": [schemas.TicketResponse.model_validate(t) for t in tickets],
        "technicians": [
            {"id": u.id, "name": u.full_name or u.email.split("@")[0], "picture": u.picture}
            for u in technicians
        ],
        "resolved_total": db.query(models.Ticket).filter(models.Ticket.status == models.TicketStatus.RISOLTO).count(),
    }

# --- GESTIONE UTENTI (SOLO SUPERVISORE) ---

class RoleUpdateSchema(BaseModel):
    role: models.UserRole

@app.get("/api/v1/users", response_model=List[schemas.UserResponse])
def get_all_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE]))
):
    return db.query(models.User).order_by(models.User.id.asc()).all()

@app.patch("/api/v1/users/{user_id}/role", response_model=schemas.UserResponse)
def update_user_role(
    user_id: int,
    role_data: RoleUpdateSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE]))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato.")

    # Impedisce all'admin di declassarsi se è l'unico rimasto
    if user.id == current_user.id and role_data.role != models.UserRole.SUPERVISORE:
        admin_count = db.query(models.User).filter(models.User.role == models.UserRole.SUPERVISORE).count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=400, 
                detail="Impossibile modificare il proprio ruolo: deve rimanere almeno un Supervisore attivo."
            )

    user.role = role_data.role
    db.commit()
    db.refresh(user)
    return user

# --- POPOLARE AULE TRAMITE CSV ---   
@app.post("/api/v1/rooms/upload-csv")
async def upload_rooms_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE]))
):
    """Crea o aggiorna i locali dal CSV (stesso formato di backend/data/aule_grassi.csv).
    I locali non presenti nel file NON vengono eliminati: per sostituire tutto l'elenco
    si usa lo script import_aule.py."""
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Caricare esclusivamente file con estensione .csv")

    content = await file.read(MAX_BODY_BYTES + 1)
    if len(content) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="File troppo grande (massimo 2 MB).")
    try:
        rooms = parse_rooms_csv(content.decode("utf-8"))
        if not rooms:
            raise HTTPException(
                status_code=400,
                detail="Nessun locale trovato. Il CSV deve avere le colonne: codice,tipo,sede,prenotabile,orario_libero,responsabile,assistente_tecnico,dotazioni",
            )
        result = apply_rooms(db, rooms, delete_missing=False)
        return {
            "message": f"Importazione completata: {len(result.created)} nuovi locali, {len(result.updated)} aggiornati."
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Errore durante la lettura del CSV: {str(e)}")


# --- PRENOTAZIONE AULE ---
# Le regole (preavviso, approvazione automatica, anti-abuso, orario libero) sono in app/bookings.py.
# Ore scolastiche: una riga per ogni ora; orario libero: una riga con start_time/end_time.
# Le righe della stessa richiesta condividono il codice BK-XXXXXX.

BOOKING_MIN_DAYS_AHEAD = booking_rules.MIN_DAYS_AHEAD

def _booking_to_response(b: models.Booking) -> dict:
    return {
        "id": b.id,
        "code": b.code,
        "room_id": b.room_id,
        "room_code": b.room.code if b.room else f"#{b.room_id}",
        "user_id": b.user_id,
        "user_name": (b.user.full_name or b.user.email) if b.user else "",
        "user_email": b.user.email if b.user else "",
        "date": b.date,
        "slot": b.slot,
        "start_time": b.start_time,
        "end_time": b.end_time,
        "extras": json.loads(b.extras) if b.extras else None,
        "purpose": b.purpose,
        "status": b.status.value if b.status else "APPROVATA",
        "status_reason": b.status_reason,
        "reject_reason": b.reject_reason,
        "decided_by_name": (b.decided_by.full_name or b.decided_by.email) if b.decided_by else None,
        "decided_at": b.decided_at,
        "created_at": b.created_at,
    }

def _sorted(q):
    return q.order_by(models.Booking.date.asc(), models.Booking.slot.asc(), models.Booking.start_time.asc())

# Prenotazioni che occupano un locale (griglia settimanale): approvate e in attesa
@app.get("/api/v1/bookings", response_model=List[schemas.BookingResponse])
def get_bookings(
    room_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Booking).filter(models.Booking.status.in_(models.ACTIVE_BOOKING_STATUSES))
    if room_id is not None:
        q = q.filter(models.Booking.room_id == room_id)
    if date_from is not None:
        q = q.filter(models.Booking.date >= date_from)
    if date_to is not None:
        q = q.filter(models.Booking.date <= date_to)
    return [_booking_to_response(b) for b in _sorted(q).all()]

# Le mie prossime prenotazioni, anche quelle in attesa o rifiutate (per vederne il motivo)
@app.get("/api/v1/bookings/mine", response_model=List[schemas.BookingResponse])
def get_my_bookings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Booking).filter(
        models.Booking.user_id == current_user.id, models.Booking.date >= date.today()
    )
    return [_booking_to_response(b) for b in _sorted(q).all()]

@app.post("/api/v1/bookings")
def create_booking(
    booking_in: schemas.BookingCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    room = db.query(models.Room).filter(models.Room.id == booking_in.room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Aula non trovata.")
    if not room.is_active:
        raise HTTPException(status_code=400, detail="L'aula e' disattivata e non puo' essere prenotata.")
    if not room.is_bookable:
        raise HTTPException(status_code=400, detail=f"Il locale {room.code} non e' prenotabile.")

    # Preavviso minimo: si prenota a partire da 3 giorni dopo oggi
    min_date = date.today() + timedelta(days=BOOKING_MIN_DAYS_AHEAD)
    if booking_in.date < min_date:
        raise HTTPException(
            status_code=400,
            detail=f"Le aule si prenotano con almeno 2 giorni di anticipo: prima data utile {min_date.strftime('%d/%m/%Y')}.",
        )
    if booking_in.date.weekday() > 4:
        raise HTTPException(status_code=400, detail="Si possono prenotare solo giorni dal lunedi' al venerdi'.")
    purpose = booking_in.purpose.strip()
    if not purpose:
        raise HTTPException(status_code=400, detail="Indica il motivo della prenotazione.")

    slots = sorted(set(booking_in.slots))
    start, end = booking_in.start_time, booking_in.end_time
    if slots:
        start = end = None
        if any(s < 1 or s > 8 for s in slots):
            raise HTTPException(status_code=400, detail="Le ore valide vanno dalla 1a all'8a.")
    else:
        if not (start or end):
            raise HTTPException(status_code=400, detail="Seleziona almeno un'ora.")
        if not room.free_schedule:
            raise HTTPException(status_code=400, detail=f"Il locale {room.code} si prenota solo a ore scolastiche.")
        if not (booking_rules.valid_time(start) and booking_rules.valid_time(end)) or start >= end:
            raise HTTPException(status_code=400, detail="Orario non valido: indica un orario di inizio precedente a quello di fine.")

    conflicts = booking_rules.find_conflicts(db, room, booking_in.date, slots, start, end)
    if conflicts:
        raise HTTPException(status_code=409, detail=f"{room.code} non e' libero: " + "; ".join(conflicts) + ".")

    extras = None
    if not slots and booking_in.extras:
        chosen = {k: True for k, v in booking_in.extras.items() if v and k in booking_rules.EXTRA_LABELS}
        extras = json.dumps(chosen) if chosen else None

    reasons = booking_rules.approval_reasons(db, room, current_user, booking_in.date, start, end)
    status_value = models.BookingStatus.IN_ATTESA if reasons else models.BookingStatus.APPROVATA
    now = datetime.utcnow()

    code = f"BK-{uuid.uuid4().hex[:6].upper()}"
    created = []
    for s in (slots or [None]):
        b = models.Booking(
            code=code,
            date=booking_in.date,
            slot=s,
            start_time=start,
            end_time=end,
            extras=extras,
            purpose=purpose,
            room_id=room.id,
            user_id=current_user.id,
            status=status_value,
            status_reason="; ".join(reasons) if reasons else None,
            decided_at=None if reasons else now,
        )
        db.add(b)
        created.append(b)
    db.flush()

    when = booking_rules.describe_when(created)
    who = current_user.full_name or current_user.email
    if reasons:
        # Richiesta da approvare: avvisa il responsabile del locale (o l'Ufficio Tecnico)
        notify(
            db,
            [u.id for u in booking_rules.approvers_for(db, room)],
            models.NotificationType.PRENOTAZIONE,
            f"Prenotazione da approvare: {room.code}",
            f"{who} chiede {room.code} per {when}: \"{purpose}\". Motivo: {'; '.join(reasons)}.",
            actor=current_user,
            link="/prenotazioni/gestione",
        )
    else:
        # Prenotazione confermata: avvisa l'assistente tecnico del locale, se ha un account
        at = booking_rules.user_by_email(db, room.technical_assistant_email)
        if at is not None:
            notify(
                db,
                [at.id],
                models.NotificationType.PRENOTAZIONE,
                f"Nuova prenotazione in {room.code}",
                f"{who} ha prenotato {room.code} per {when}: \"{purpose}\".",
                actor=current_user,
                link="/prenotazioni/gestione",
            )
    db.commit()
    for b in created:
        db.refresh(b)
    return {
        "code": code,
        "status": status_value.value,
        "reasons": reasons,
        "bookings": [_booking_to_response(b) for b in created],
    }

# Gestione prenotazioni: richieste da approvare e prossime prenotazioni dei propri locali
@app.get("/api/v1/bookings/gestione")
def get_bookings_management(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    staff = current_user.role in models.STAFF_ROLES
    rooms = db.query(models.Room).all()
    approve_ids = {r.id for r in rooms if booking_rules.can_approve(current_user, r)}
    assistant_ids = {r.id for r in rooms if booking_rules.is_room_assistant(current_user, r)}
    visible_ids = approve_ids | assistant_ids

    upcoming_q = db.query(models.Booking).filter(
        models.Booking.date >= date.today(),
        models.Booking.status.in_(models.ACTIVE_BOOKING_STATUSES),
    )
    if not staff:
        upcoming_q = upcoming_q.filter(models.Booking.room_id.in_(list(visible_ids) or [-1]))
    upcoming = _sorted(upcoming_q).all()

    return {
        "is_staff": staff,
        "can_approve": bool(approve_ids),
        "responsible_rooms": sorted(r.code for r in rooms if r.id in approve_ids) if not staff else [],
        "assistant_rooms": sorted(r.code for r in rooms if r.id in assistant_ids),
        "pending": [_booking_to_response(b) for b in upcoming if b.status == models.BookingStatus.IN_ATTESA and b.room_id in approve_ids],
        "upcoming": [_booking_to_response(b) for b in upcoming],
    }

def _decide_booking(db: Session, code: str, user: models.User, approve: bool, note: Optional[str]):
    rows = db.query(models.Booking).filter(models.Booking.code == code).all()
    if not rows:
        raise HTTPException(status_code=404, detail="Prenotazione non trovata.")
    room = rows[0].room
    if not booking_rules.can_approve(user, room):
        raise HTTPException(status_code=403, detail=f"Solo il responsabile di {room.code} o l'Ufficio Tecnico possono decidere.")
    if any(r.status != models.BookingStatus.IN_ATTESA for r in rows):
        raise HTTPException(status_code=400, detail="Questa prenotazione non e' in attesa di approvazione.")
    note = (note or "").strip()
    if not approve and not note:
        raise HTTPException(status_code=400, detail="Indica il motivo del rifiuto.")

    now = datetime.utcnow()
    for r in rows:
        r.status = models.BookingStatus.APPROVATA if approve else models.BookingStatus.RIFIUTATA
        r.decided_at = now
        r.decided_by_id = user.id
        if approve:
            r.status_reason = f"Approvata da {user.full_name or user.email}" + (f": {note}" if note else "")
        else:
            r.reject_reason = note

    when = booking_rules.describe_when(rows)
    notify(
        db,
        [rows[0].user_id],
        models.NotificationType.PRENOTAZIONE,
        f"Prenotazione {'approvata' if approve else 'rifiutata'}: {room.code}",
        f"La tua prenotazione di {room.code} per {when} e' stata {'approvata' if approve else 'rifiutata'}"
        + (f". Motivo: {note}" if not approve else (f". Nota: {note}" if note else "")) + ".",
        actor=user,
        link="/prenotazioni",
    )
    db.commit()
    return [_booking_to_response(r) for r in rows]

@app.post("/api/v1/bookings/{code}/approva", response_model=List[schemas.BookingResponse])
def approve_booking(
    code: str,
    data: schemas.BookingDecision,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return _decide_booking(db, code, current_user, True, data.note)

@app.post("/api/v1/bookings/{code}/rifiuta", response_model=List[schemas.BookingResponse])
def reject_booking(
    code: str,
    data: schemas.BookingDecision,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return _decide_booking(db, code, current_user, False, data.note)

# --- CARRELLI MOBILI (risorse prenotabili a quantita') ---

def _resource_booking_out(b: models.ResourceBooking) -> dict:
    return {
        "id": b.id,
        "code": b.code,
        "resource_id": b.resource_id,
        "resource_name": b.resource.name if b.resource else f"#{b.resource_id}",
        "resource_total": b.resource.quantity if b.resource else 0,
        "user_id": b.user_id,
        "user_name": (b.user.full_name or b.user.email) if b.user else "",
        "user_email": b.user.email if b.user else "",
        "room_id": b.room_id,
        "room_code": b.room.code if b.room else None,
        "date": b.date,
        "slot": b.slot,
        "quantity": b.quantity,
        "whole_cart": b.whole_cart,
        "purpose": b.purpose,
        "created_at": b.created_at,
    }

def _rb_sorted(q):
    return q.order_by(models.ResourceBooking.date.asc(), models.ResourceBooking.slot.asc())

def _get_resource_or_404(db: Session, resource_id: int) -> models.Resource:
    r = db.query(models.Resource).filter(models.Resource.id == resource_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Carrello non trovato.")
    return r

@app.get("/api/v1/resources", response_model=List[schemas.ResourceResponse])
def get_resources(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return db.query(models.Resource).order_by(models.Resource.name.asc()).all()

def _validate_resource(db: Session, data: schemas.ResourceBase, resource_id: Optional[int] = None):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Il nome del carrello e' obbligatorio.")
    if data.quantity < 1 or data.quantity > 200:
        raise HTTPException(status_code=400, detail="Il numero di PC deve essere tra 1 e 200.")
    q = db.query(models.Resource).filter(models.Resource.name == name)
    if resource_id is not None:
        q = q.filter(models.Resource.id != resource_id)
    if q.first():
        raise HTTPException(status_code=400, detail=f"Esiste gia' un carrello chiamato '{name}'.")
    return name

# Nuovo carrello: solo SUPERVISORE
@app.post("/api/v1/resources", response_model=schemas.ResourceResponse)
def create_resource(
    data: schemas.ResourceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE])),
):
    values = data.model_dump()
    values["name"] = _validate_resource(db, data)
    r = models.Resource(**values)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r

# Modifica carrello: solo SUPERVISORE
@app.put("/api/v1/resources/{resource_id}", response_model=schemas.ResourceResponse)
def update_resource(
    resource_id: int,
    data: schemas.ResourceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE])),
):
    r = _get_resource_or_404(db, resource_id)
    name = _validate_resource(db, data, resource_id)
    booked = resource_rules.max_booked_per_slot(db, r.id, date.today())
    if data.quantity < booked:
        raise HTTPException(
            status_code=400,
            detail=f"Ci sono gia' prenotazioni di {booked} PC nella stessa ora: il carrello non puo' scendere sotto {booked}.",
        )
    for key, value in data.model_dump().items():
        setattr(r, key, value)
    r.name = name
    db.commit()
    db.refresh(r)
    return r

# Eliminazione carrello (con le sue prenotazioni): solo SUPERVISORE
@app.delete("/api/v1/resources/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(
    resource_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE])),
):
    r = _get_resource_or_404(db, resource_id)
    db.delete(r)
    db.commit()
    return None

# Prenotazioni di un carrello in un periodo (per la griglia settimanale)
@app.get("/api/v1/resource-bookings", response_model=List[schemas.ResourceBookingResponse])
def get_resource_bookings(
    resource_id: int,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.ResourceBooking).filter(models.ResourceBooking.resource_id == resource_id)
    if date_from is not None:
        q = q.filter(models.ResourceBooking.date >= date_from)
    if date_to is not None:
        q = q.filter(models.ResourceBooking.date <= date_to)
    return [_resource_booking_out(b) for b in _rb_sorted(q).all()]

@app.get("/api/v1/resource-bookings/mine", response_model=List[schemas.ResourceBookingResponse])
def get_my_resource_bookings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.ResourceBooking).filter(
        models.ResourceBooking.user_id == current_user.id, models.ResourceBooking.date >= date.today()
    )
    return [_resource_booking_out(b) for b in _rb_sorted(q).all()]

# Tutte le prossime prenotazioni dei carrelli (Ufficio Tecnico, per preparare e consegnare i carrelli)
@app.get("/api/v1/resource-bookings/prossime", response_model=List[schemas.ResourceBookingResponse])
def get_upcoming_resource_bookings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.STAFF_ROLES)),
):
    q = db.query(models.ResourceBooking).filter(models.ResourceBooking.date >= date.today())
    return [_resource_booking_out(b) for b in _rb_sorted(q).all()]

@app.post("/api/v1/resource-bookings", response_model=List[schemas.ResourceBookingResponse])
def create_resource_booking(
    data: schemas.ResourceBookingCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    resource = _get_resource_or_404(db, data.resource_id)
    if not resource.is_active:
        raise HTTPException(status_code=400, detail=f"{resource.name} non e' disponibile al momento.")

    min_date = date.today() + timedelta(days=booking_rules.MIN_DAYS_AHEAD)
    if data.date < min_date:
        raise HTTPException(
            status_code=400,
            detail=f"I carrelli si prenotano con almeno 2 giorni di anticipo: prima data utile {min_date.strftime('%d/%m/%Y')}.",
        )
    if data.date.weekday() > 4:
        raise HTTPException(status_code=400, detail="Si possono prenotare solo giorni dal lunedi' al venerdi'.")

    slots = sorted(set(data.slots))
    if not slots:
        raise HTTPException(status_code=400, detail="Seleziona almeno un'ora.")
    if any(s < 1 or s > 8 for s in slots):
        raise HTTPException(status_code=400, detail="Le ore valide vanno dalla 1a all'8a.")
    purpose = data.purpose.strip()
    if not purpose:
        raise HTTPException(status_code=400, detail="Indica il motivo della prenotazione.")

    quantity = resource.quantity if data.whole_cart else (data.quantity or 0)
    if quantity < 1 or quantity > resource.quantity:
        raise HTTPException(status_code=400, detail=f"Indica un numero di PC tra 1 e {resource.quantity}.")

    room = None
    if data.room_id is not None:
        room = db.query(models.Room).filter(models.Room.id == data.room_id).first()
        if room is None:
            raise HTTPException(status_code=404, detail="Aula di destinazione non trovata.")

    problems = resource_rules.check_request(db, resource, data.date, slots, quantity, data.whole_cart)
    if problems:
        raise HTTPException(status_code=409, detail=f"{resource.name}: " + "; ".join(problems) + ".")

    code = f"CR-{uuid.uuid4().hex[:6].upper()}"
    created = []
    for s in slots:
        b = models.ResourceBooking(
            code=code,
            resource_id=resource.id,
            user_id=current_user.id,
            room_id=room.id if room else None,
            date=data.date,
            slot=s,
            quantity=quantity,
            whole_cart=data.whole_cart,
            purpose=purpose,
        )
        db.add(b)
        created.append(b)
    db.commit()
    for b in created:
        db.refresh(b)
    return [_resource_booking_out(b) for b in created]

# Annulla una prenotazione (tutte le ore con lo stesso codice): chi l'ha fatta o l'Ufficio Tecnico
@app.delete("/api/v1/resource-bookings/{code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource_booking(
    code: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rows = db.query(models.ResourceBooking).filter(models.ResourceBooking.code == code).all()
    if not rows:
        raise HTTPException(status_code=404, detail="Prenotazione non trovata.")
    if rows[0].user_id != current_user.id and current_user.role not in models.STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Puoi annullare solo le tue prenotazioni.")
    for r in rows:
        db.delete(r)
    db.commit()
    return None


# --- ORARIO DELLE LEZIONI ---

@app.get("/api/v1/orario")
def get_lesson_schedule(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    sched = booking_rules.active_schedule(db)
    if sched is None:
        return {"name": None, "academic_year": None, "uploaded_at": None, "rooms": {}}
    return {
        "name": sched.name,
        "academic_year": sched.academic_year,
        "uploaded_at": sched.uploaded_at,
        "rooms": json.loads(sched.data),
    }

# Carica un nuovo orario (formato di data/orario_lezioni.json) e lo rende attivo
@app.post("/api/v1/orario")
def upload_lesson_schedule(
    data: schemas.ScheduleUpload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.SUPERVISORE])),
):
    if not data.rooms:
        raise HTTPException(status_code=400, detail="L'orario non contiene nessun locale.")
    db.query(models.ScheduleVersion).update({models.ScheduleVersion.active: False})
    version = models.ScheduleVersion(
        name=data.name.strip() or "Orario delle lezioni",
        academic_year=data.academic_year,
        data=json.dumps(data.rooms),
        active=True,
        uploaded_by_id=current_user.id,
    )
    db.add(version)
    db.commit()
    return {"message": f"Orario \"{version.name}\" attivato ({len(data.rooms)} locali)."}

@app.delete("/api/v1/bookings/{booking_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Annulla una singola ora prenotata. Puo' farlo chi l'ha prenotata oppure un SUPERVISORE."""
    b = db.query(models.Booking).filter(models.Booking.id == booking_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Prenotazione non trovata.")
    if b.user_id != current_user.id and current_user.role != models.UserRole.SUPERVISORE:
        raise HTTPException(status_code=403, detail="Puoi annullare solo le tue prenotazioni.")
    db.delete(b)
    db.commit()
    return None
