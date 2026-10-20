from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel
import csv
import io
from app.database import engine, Base, get_db
import app.models as models
import app.schemas as schemas
from app.auth import verify_google_token, create_access_token, get_current_user, require_role

models.Base.metadata.create_all(bind=engine)

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
        # Se è il primo utente del sistema, possiamo impostarlo come ADMIN per i test
        # is_first_user = db.query(models.User).count() == 0
        # role = models.UserRole.ADMIN if is_first_user else models.UserRole.DOCENTE 

        # Se è il primo utente del sistema, possiamo impostarlo come STUDENTE per i test
        is_first_user = db.query(models.User).count() == 0
        role = models.UserRole.ADMIN if is_first_user else models.UserRole.STUDENTE

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

# Creazione Aula: Solo ADMIN
@app.post("/api/v1/rooms", response_model=schemas.RoomResponse)
def create_room(
    room: schemas.RoomCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.ADMIN]))
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

# Attiva/Disattiva Aula: Solo ADMIN
@app.patch("/api/v1/rooms/{room_id}/toggle", response_model=schemas.RoomResponse)
def toggle_room_status(
    room_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.ADMIN]))
):
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Aula non trovata.")
    
    room.is_active = not room.is_active
    db.commit()
    db.refresh(room)
    return room

# Eliminazione Aula: Solo ADMIN
@app.delete("/api/v1/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_room(
    room_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.ADMIN]))
):
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Aula non trovata.")
    
    db.delete(room)
    db.commit()
    return None

import uuid

# --- TICKETS ---

# Lettura di tutti i ticket
@app.get("/api/v1/tickets", response_model=List[schemas.TicketResponse])
def get_tickets(db: Session = Depends(get_db)):
    return db.query(models.Ticket).order_by(models.Ticket.created_at.desc()).all()

# Creazione Ticket: Accessibile a STUDENTE, DOCENTE, ADMIN
@app.post("/api/v1/tickets", response_model=schemas.TicketResponse)
def create_ticket(
    ticket_in: schemas.TicketCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([
        models.UserRole.STUDENTE,
        models.UserRole.DOCENTE,
        models.UserRole.ADMIN
    ]))
):
    room = db.query(models.Room).filter(models.Room.id == ticket_in.room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Aula non trovata.")

    ticket_code = f"TCK-{uuid.uuid4().hex[:6].upper()}"
    new_ticket = models.Ticket(
        code=ticket_code,
        title=ticket_in.title,
        description=ticket_in.description,
        status=models.TicketStatus.IN_ATTESA,
        room_id=ticket_in.room_id,
        reporter_id=current_user.id
    )
    db.add(new_ticket)
    db.commit()
    db.refresh(new_ticket)
    return new_ticket

# Cambio Stato Ticket: Riservato a TECNICO e ADMIN
@app.patch("/api/v1/tickets/{ticket_id}/status", response_model=schemas.TicketResponse)
def update_ticket_status(
    ticket_id: int,
    status_update: schemas.TicketStatusUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([
        models.UserRole.TECNICO,
        models.UserRole.ADMIN
    ]))
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato.")

    ticket.status = status_update.status
    db.commit()
    db.refresh(ticket)
    return ticket

    # --- DASHBOARD METRICS ---

@app.get("/api/v1/dashboard/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    total_rooms = db.query(models.Room).count()
    active_rooms = db.query(models.Room).filter(models.Room.is_active == True).count()
    
    total_tickets = db.query(models.Ticket).count()
    pending_tickets = db.query(models.Ticket).filter(models.Ticket.status == models.TicketStatus.IN_ATTESA).count()
    in_progress_tickets = db.query(models.Ticket).filter(models.Ticket.status == models.TicketStatus.IN_LAVORAZIONE).count()
    resolved_tickets = db.query(models.Ticket).filter(models.Ticket.status == models.TicketStatus.RISOLTO).count()

    # Ultimi 5 ticket aperti per il feed recente
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
            "total": total_tickets,
            "pending": pending_tickets,
            "in_progress": in_progress_tickets,
            "resolved": resolved_tickets,
        },
        "recent_tickets": recent_tickets
    }

# --- GESTIONE UTENTI (ADMIN ONLY) ---

class RoleUpdateSchema(BaseModel):
    role: models.UserRole

@app.get("/api/v1/users", response_model=List[schemas.UserResponse])
def get_all_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.ADMIN]))
):
    return db.query(models.User).order_by(models.User.id.asc()).all()

@app.patch("/api/v1/users/{user_id}/role", response_model=schemas.UserResponse)
def update_user_role(
    user_id: int,
    role_data: RoleUpdateSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.ADMIN]))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato.")

    # Impedisce all'admin di declassarsi se è l'unico rimasto
    if user.id == current_user.id and role_data.role != models.UserRole.ADMIN:
        admin_count = db.query(models.User).filter(models.User.role == models.UserRole.ADMIN).count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=400, 
                detail="Impossibile modificare il proprio ruolo: deve rimanere almeno un Admin attivo."
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
    current_user: models.User = Depends(require_role([models.UserRole.ADMIN]))
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Caricare esclusivamente file con estensione .csv")

    content = await file.read()
    try:
        decoded_content = content.decode("utf-8")
        csv_reader = csv.DictReader(io.StringIO(decoded_content))
        
        created_count = 0
        for row in csv_reader:
            code = row.get("code") or row.get("codice")
            if not code:
                continue
                
            # Evita duplicati se l'aula esiste già
            if db.query(models.Room).filter(models.Room.code == code).first():
                continue

            building = row.get("building") or row.get("edificio") or "Polo Didattico"
            capacity = int(row.get("capacity") or row.get("capienza") or 30)
            has_projector_str = str(row.get("has_projector") or row.get("proiettore") or "true").lower()
            has_projector = has_projector_str in ["true", "1", "si", "sì"]

            new_room = models.Room(
                code=code,
                building=building,
                capacity=capacity,
                has_projector=has_projector,
                is_active=True
            )
            db.add(new_room)
            created_count += 1

        db.commit()
        return {"message": f"Importazione completata con successo! Inserite {created_count} nuove aule."}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Errore durante la lettura del CSV: {str(e)}")