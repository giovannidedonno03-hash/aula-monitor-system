from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime, timedelta
from sqlalchemy import text
from pydantic import BaseModel
import csv
import io
from app.database import engine, Base, get_db
import app.models as models
import app.schemas as schemas
from app.auth import verify_google_token, create_access_token, get_current_user, require_role
from app.room_import import parse_rooms_csv, apply_rooms

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

app = FastAPI(title="Aula Monitor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        # Il primo utente del sistema diventa SUPERVISORE, tutti gli altri UTENTE
        is_first_user = db.query(models.User).count() == 0
        role = models.UserRole.SUPERVISORE if is_first_user else models.UserRole.UTENTE

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

@app.get("/api/v1/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user


# --- ROOMS (AULE) ---

# Lettura: Aperta a tutti
@app.get("/api/v1/rooms", response_model=List[schemas.RoomResponse])
def get_rooms(db: Session = Depends(get_db)):
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
    wanted = list(dict.fromkeys(user_ids))  # senza duplicati, ordine mantenuto
    current = {a.user_id: a for a in ticket.assignments}

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
    comment = models.TicketComment(ticket_id=ticket.id, author_id=current_user.id, content=content)
    db.add(comment)
    ticket.updated_at = datetime.utcnow()
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
def get_dashboard_stats(db: Session = Depends(get_db)):
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
# Leggibile senza login, come la modalita' kiosk del gestionale Grassi,
# cosi' il televisore puo' restare acceso sulla pagina /tv?kiosk=true.
@app.get("/api/v1/tv")
def get_tv_data(db: Session = Depends(get_db)):
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
            {"id": u.id, "name": u.full_name or u.email, "email": u.email, "picture": u.picture}
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

    content = await file.read()
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
# Accessibile a tutti gli utenti autenticati.
# Ogni ora scolastica (slot 1..8) prenotata e' una riga nella tabella bookings;
# le ore della stessa richiesta condividono lo stesso codice BK-XXXXXX.

BOOKING_MIN_DAYS_AHEAD = 3  # oggi + 2 giorni di preavviso

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
        "purpose": b.purpose,
        "created_at": b.created_at,
    }

@app.get("/api/v1/bookings", response_model=List[schemas.BookingResponse])
def get_bookings(
    room_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Booking)
    if room_id is not None:
        q = q.filter(models.Booking.room_id == room_id)
    if date_from is not None:
        q = q.filter(models.Booking.date >= date_from)
    if date_to is not None:
        q = q.filter(models.Booking.date <= date_to)
    bookings = q.order_by(models.Booking.date.asc(), models.Booking.slot.asc()).all()
    return [_booking_to_response(b) for b in bookings]

@app.get("/api/v1/bookings/mine", response_model=List[schemas.BookingResponse])
def get_my_bookings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    bookings = (
        db.query(models.Booking)
        .filter(models.Booking.user_id == current_user.id, models.Booking.date >= date.today())
        .order_by(models.Booking.date.asc(), models.Booking.slot.asc())
        .all()
    )
    return [_booking_to_response(b) for b in bookings]

@app.post("/api/v1/bookings", response_model=List[schemas.BookingResponse])
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
    # (es. il lunedi' si puo' prenotare da giovedi' in poi)
    min_date = date.today() + timedelta(days=BOOKING_MIN_DAYS_AHEAD)
    if booking_in.date < min_date:
        raise HTTPException(
            status_code=400,
            detail=f"Le aule si prenotano con almeno 2 giorni di anticipo: prima data utile {min_date.strftime('%d/%m/%Y')}.",
        )
    if booking_in.date.weekday() > 4:
        raise HTTPException(status_code=400, detail="Si possono prenotare solo giorni dal lunedi' al venerdi'.")

    slots = sorted(set(booking_in.slots))
    if not slots:
        raise HTTPException(status_code=400, detail="Seleziona almeno un'ora.")
    if any(s < 1 or s > 8 for s in slots):
        raise HTTPException(status_code=400, detail="Le ore valide vanno dalla 1a all'8a.")
    if not booking_in.purpose.strip():
        raise HTTPException(status_code=400, detail="Indica il motivo della prenotazione.")

    occupied = (
        db.query(models.Booking.slot)
        .filter(
            models.Booking.room_id == room.id,
            models.Booking.date == booking_in.date,
            models.Booking.slot.in_(slots),
        )
        .all()
    )
    if occupied:
        ore = ", ".join(f"{s}a" for (s,) in sorted(occupied))
        raise HTTPException(status_code=409, detail=f"Ore gia' prenotate per {room.code}: {ore}.")

    code = f"BK-{uuid.uuid4().hex[:6].upper()}"
    created = []
    for s in slots:
        b = models.Booking(
            code=code,
            date=booking_in.date,
            slot=s,
            purpose=booking_in.purpose.strip(),
            room_id=room.id,
            user_id=current_user.id,
        )
        db.add(b)
        created.append(b)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=409, detail="Una delle ore selezionate e' appena stata prenotata da un altro utente.")
    for b in created:
        db.refresh(b)
    return [_booking_to_response(b) for b in created]

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
