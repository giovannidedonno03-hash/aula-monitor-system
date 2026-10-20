import sys
import os
import uuid
from datetime import datetime

# Aggiungiamo la cartella corrente al path per importare i moduli dell'app
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal, engine, Base
import app.models as models

def seed_database():
    print("Avvio del processo di Seeding del Database...")
    
    # Assicuriamoci che le tabelle esistano
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # 1. Controlla se esistono già aule per evitare duplicati
        if db.query(models.Room).count() > 0:
            print("Il database contiene già delle aule. Seeding annullato per evitare duplicazioni.")
            return

        print("Creazione Aule di prova...")
        rooms_data = [
            {"code": "Aula Magna", "building": "Polo A - Piano Terra", "capacity": 250, "has_projector": True, "is_active": True},
            {"code": "Lab Informatica 1", "building": "Polo B - Primo Piano", "capacity": 40, "has_projector": True, "is_active": True},
            {"code": "Aula 3B", "building": "Polo A - Secondo Piano", "capacity": 80, "has_projector": True, "is_active": True},
            {"code": "Aula Tutorato 12", "building": "Polo C - Piano Terra", "capacity": 30, "has_projector": False, "is_active": True},
            {"code": "Lab Elettronica", "building": "Polo B - Secondo Piano", "capacity": 35, "has_projector": True, "is_active": False},
        ]

        created_rooms = []
        for r in rooms_data:
            room = models.Room(**r)
            db.add(room)
            created_rooms.append(room)

        db.commit()
        for r in created_rooms:
            db.refresh(r)

        print(f"Create {len(created_rooms)} aule con successo.")

        # 2. Recupera il primo utente disponibile (es. il tuo utente Admin) per associarlo ai ticket
        reporter = db.query(models.User).first()
        if not reporter:
            print("Nessun utente trovato nel database. Effettua prima almeno un login con Google per creare l'utente iniziale!")
            return

        print("Creazione Ticket di prova...")
        tickets_data = [
            {
                "title": "Proiettore HDMI non funzionante",
                "description": "Il cavo HDMI a muro risulta danneggiato e il proiettore non riceve segnale dal laptop.",
                "status": models.TicketStatus.IN_ATTESA,
                "room_id": created_rooms[0].id,
            },
            {
                "title": "Aria condizionata bloccata",
                "description": "Il climatizzatore fa un rumore anomalo e la temperatura rimane troppo alta.",
                "status": models.TicketStatus.IN_LAVORAZIONE,
                "room_id": created_rooms[1].id,
            },
            {
                "title": "Presa elettrica cattedra divelta",
                "description": "La presa elettrica sulla cattedra principale necessita di sostituzione urgente.",
                "status": models.TicketStatus.RISOLTO,
                "room_id": created_rooms[2].id,
            },
            {
                "title": "Microfono wireless scarico/guasto",
                "description": "Il microfono a gelato dell'aula non si accende anche dopo aver sostituito le batterie.",
                "status": models.TicketStatus.IN_ATTESA,
                "room_id": created_rooms[0].id,
            },
        ]

        for t in tickets_data:
            ticket_code = f"TCK-{uuid.uuid4().hex[:6].upper()}"
            ticket = models.Ticket(
                code=ticket_code,
                title=t["title"],
                description=t["description"],
                status=t["status"],
                room_id=t["room_id"],
                reporter_id=reporter.id,
                created_at=datetime.utcnow()
            )
            db.add(ticket)

        db.commit()
        print("Ticket di prova creati con successo.")

        print("Seeding completato con successo!")

    except Exception as e:
        print(f"Errore durante il seeding: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()