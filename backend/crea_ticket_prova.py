"""Crea 20 ticket di prova sui locali reali della scuola (backend/data/aule_grassi.csv).

Uso (dalla cartella del progetto, con Docker acceso):

    docker compose exec backend python crea_ticket_prova.py

Requisiti:
- i locali devono essere gia' stati importati (python import_aule.py --conferma);
- deve esistere almeno un utente (basta aver fatto un login con Google).

I ticket hanno stati, priorita', categorie e date diverse (ultime due settimane).
Quelli presi in carico vengono assegnati a uno o due utenti Manager/Supervisore.
Ogni esecuzione aggiunge altri 20 ticket.
"""

import os
import random
import sys
import uuid
from datetime import datetime, timedelta

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import main as _app  # noqa: F401,E402  (esegue le migrazioni del database)
import app.models as models  # noqa: E402
from app.database import SessionLocal  # noqa: E402

S = models.TicketStatus
P = models.TicketPriority
C = models.TicketCategory

# (locale, titolo, descrizione, categoria, priorita', stato, giorni fa)
TICKETS = [
    ("A01", "LIM non si accende", "Il monitor touch della LIM resta nero anche dopo aver controllato l'interruttore e il cavo di alimentazione.", C.INFORMATICO, P.ALTA, S.APERTO, 1),
    ("A04", "PC cattedra lentissimo", "Il PC della cattedra impiega oltre 10 minuti ad avviarsi e si blocca all'apertura del registro elettronico.", C.INFORMATICO, P.MEDIA, S.IN_CARICO, 3),
    ("A08", "Visore Meta Quest 2 non si ricarica", "Uno dei visori VR non si ricarica: il LED resta spento con qualsiasi cavo.", C.INFORMATICO, P.BASSA, S.IN_ESECUZIONE, 6),
    ("A23", "Proiettore sala riunioni sfocato", "Il PC per le proiezioni funziona ma l'immagine proiettata è sfocata e non si riesce a regolare.", C.INFORMATICO, P.MEDIA, S.RISOLTO, 12),
    ("B03", "Tapparella bloccata", "La tapparella della seconda finestra è bloccata a metà e non scende più.", C.ARREDI, P.BASSA, S.APERTO, 2),
    ("B16", "Postazione inclusione senza rete", "Il PC per attività di inclusione non vede la rete: icona con punto esclamativo.", C.INFORMATICO, P.ALTA, S.IN_CARICO, 2),
    ("B18", "Perdita dal rubinetto del bancone", "Il rubinetto del bancone per le esperienze di fisica perde acqua continuamente.", C.IDRAULICO, P.ALTA, S.IN_ESECUZIONE, 4),
    ("Corridoio B01-B06", "Plafoniera spenta", "Due plafoniere del corridoio sono spente, il passaggio è poco illuminato nel pomeriggio.", C.ELETTRICO, P.MEDIA, S.RISOLTO, 10),
    ("C10", "Banchi danneggiati", "Tre banchi hanno il piano scheggiato e una sedia ha una gamba piegata.", C.ARREDI, P.BASSA, S.APERTO, 5),
    ("C22", "Prese elettriche banco 4 non funzionanti", "La ciabatta del banco 4 non dà corrente, gli studenti non possono collegare gli strumenti.", C.ELETTRICO, P.URGENTE, S.IN_CARICO, 1),
    ("I23", "Microfono wireless gracchia", "Durante gli eventi il microfono wireless produce fruscii e si interrompe.", C.INFORMATICO, P.MEDIA, S.APERTO, 0),
    ("I38", "Infiltrazione dal soffitto", "Dopo la pioggia c'è una macchia d'acqua sul soffitto vicino alla finestra, gocciola sul pavimento.", C.EDILE, P.ALTA, S.INOLTRATO_FACTOTUM, 9),
    ("Palestre", "Canestro allentato", "Il tabellone del canestro lato spogliatoi oscilla, va controllato il fissaggio prima di usarlo.", C.SICUREZZA, P.URGENTE, S.IN_ESECUZIONE, 3),
    ("Atrio Palestre", "Maniglione antipanico duro", "Il maniglione antipanico dell'uscita di sicurezza si apre solo con molta forza.", C.SICUREZZA, P.ALTA, S.RISOLTO, 13),
    ("Cortile pista atletica e campo calcetto", "Rete del campo strappata", "La rete di recinzione del campo da calcetto è strappata lato via Veronese.", C.EDILE, P.MEDIA, S.INOLTRATO_FACTOTUM, 11),
    ("R05", "Termosifone freddo", "Il termosifone sotto la finestra resta freddo, in aula fa molto freddo la mattina.", C.IDRAULICO, P.ALTA, S.INOLTRATO_FACTOTUM, 7),
    ("R22A", "Switch di rete spento", "Lo switch del rack è spento: nessuna postazione dell'aula ha la connessione.", C.INFORMATICO, P.URGENTE, S.RISOLTO, 8),
    ("R37", "Oscilloscopio guasto", "Un oscilloscopio non mostra la traccia su nessun canale.", C.ALTRO, P.BASSA, S.APERTO, 4),
    ("G02", "Porta che non si chiude", "La porta dell'aula non si chiude: la serratura è disallineata.", C.ARREDI, P.MEDIA, S.IN_CARICO, 2),
    ("G Corridoio G01-05", "Luce di emergenza guasta", "La lampada di emergenza vicino a G03 lampeggia in rosso (batteria esaurita).", C.SICUREZZA, P.ALTA, S.APERTO, 1),
]


def main():
    db = SessionLocal()
    try:
        rooms = {r.code: r for r in db.query(models.Room).all()}
        users = db.query(models.User).filter(models.User.is_active == True).all()  # noqa: E712
        if not users:
            print("Nessun utente nel database: fai prima un login con Google sul sito.")
            return

        staff = [u for u in users if u.role in models.STAFF_ROLES] or users
        reporters = [u for u in users if u.role not in models.STAFF_ROLES] or users

        missing = [t[0] for t in TICKETS if t[0] not in rooms]
        if missing:
            print("Questi locali non sono nel database (hai eseguito import_aule.py --conferma?):")
            print("  " + ", ".join(missing))
            print("I relativi ticket vengono saltati.")

        now = datetime.utcnow()
        created = 0
        for code, title, description, category, priority, status, days_ago in TICKETS:
            room = rooms.get(code)
            if room is None:
                continue

            created_at = now - timedelta(days=days_ago, hours=random.randint(0, 6), minutes=random.randint(0, 59))
            ticket = models.Ticket(
                code=f"TCK-{uuid.uuid4().hex[:6].upper()}",
                title=title,
                description=description,
                status=status,
                plesso=room.plesso,
                category=category,
                priority=priority,
                room_id=room.id,
                reporter_id=random.choice(reporters).id,
                created_at=created_at,
                updated_at=created_at,
            )

            # Chi se ne occupa e quando, coerente con lo stato
            if status != S.APERTO:
                ticket.taken_at = created_at + timedelta(hours=random.randint(1, 20))
                ticket.updated_at = ticket.taken_at
                # uno o (a volte) due tecnici assegnati
                how_many = min(len(staff), random.choice([1, 1, 1, 2]))
                for tech in random.sample(staff, how_many):
                    ticket.assignments.append(
                        models.TicketAssignee(user_id=tech.id, assigned_at=ticket.taken_at, assigned_by_id=tech.id)
                    )
            if status == S.INOLTRATO_FACTOTUM:
                ticket.factotum_code = f"TO-FACT-{created_at.year}-{random.randint(1000, 9999)}"
                ticket.factotum_notes = "Intervento di competenza della Città metropolitana: richiesta ditta esterna."
                ticket.factotum_date = ticket.taken_at + timedelta(hours=2)
                ticket.updated_at = ticket.factotum_date
            if status == S.RISOLTO:
                ticket.resolved_at = min(ticket.taken_at + timedelta(days=random.randint(1, 3)), now)
                ticket.updated_at = ticket.resolved_at

            db.add(ticket)
            created += 1

        db.commit()
        print(f"Creati {created} ticket di prova.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
