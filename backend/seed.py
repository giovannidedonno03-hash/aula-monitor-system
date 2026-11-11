import sys
import os
import uuid
from datetime import datetime

# Aggiungiamo la cartella corrente al path per importare i moduli dell'app
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal, engine, Base
import app.models as models
from app.room_import import parse_rooms_csv, apply_rooms

DEFAULT_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "aule_grassi.csv")

def seed_database():
    print("Avvio del processo di Seeding del Database...")
    
    # Assicuriamoci che le tabelle esistano
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # 1. Controlla se esistono già aule per evitare duplicati
        if db.query(models.Room).count() > 0:
            print("Il database contiene già dei locali (per sostituirli usa import_aule.py). Seeding annullato per evitare duplicazioni.")
            return

        print("Caricamento dell'elenco ufficiale dei locali (data/aule_grassi.csv)...")
        with open(DEFAULT_CSV, encoding="utf-8") as f:
            result = apply_rooms(db, parse_rooms_csv(f.read()))
        print(f"Creati {len(result.created)} locali con successo.")

        rooms_by_code = {r.code: r for r in db.query(models.Room).all()}
        created_rooms = [rooms_by_code[c] for c in ("A01", "B18", "I23", "G01")]

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
                "status": models.TicketStatus.APERTO,
                "category": models.TicketCategory.INFORMATICO,
                "priority": models.TicketPriority.ALTA,
                "room_id": created_rooms[0].id,
            },
            {
                "title": "Aria condizionata bloccata",
                "description": "Il climatizzatore fa un rumore anomalo e la temperatura rimane troppo alta.",
                "status": models.TicketStatus.IN_CARICO,
                "category": models.TicketCategory.ELETTRICO,
                "priority": models.TicketPriority.MEDIA,
                "room_id": created_rooms[1].id,
            },
            {
                "title": "Presa elettrica cattedra divelta",
                "description": "La presa elettrica sulla cattedra principale necessita di sostituzione urgente.",
                "status": models.TicketStatus.RISOLTO,
                "category": models.TicketCategory.ELETTRICO,
                "priority": models.TicketPriority.URGENTE,
                "room_id": created_rooms[2].id,
            },
            {
                "title": "Microfono wireless scarico/guasto",
                "description": "Il microfono wireless dell'aula non si accende anche dopo aver sostituito le batterie.",
                "status": models.TicketStatus.APERTO,
                "category": models.TicketCategory.INFORMATICO,
                "priority": models.TicketPriority.BASSA,
                "room_id": created_rooms[3].id,
            },
        ]

        for t in tickets_data:
            ticket_code = f"TCK-{uuid.uuid4().hex[:6].upper()}"
            ticket = models.Ticket(
                code=ticket_code,
                title=t["title"],
                description=t["description"],
                status=t["status"],
                category=t["category"],
                priority=t["priority"],
                room_id=t["room_id"],
                plesso=next(r.plesso for r in created_rooms if r.id == t["room_id"]),
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