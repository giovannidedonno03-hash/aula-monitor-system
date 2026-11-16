"""Regole delle prenotazioni dei locali (come il gestionale dell'Ufficio Tecnico IIS Grassi).

- Preavviso minimo: si prenota da oggi + 3 giorni (es. il lunedi' da giovedi' in poi).
- Approvazione automatica, salvo questi casi che restano "In attesa":
  * data oltre 30 giorni da oggi;
  * regola anti-abuso: piu' di 10 giorni prenotati dallo stesso utente nello stesso locale
    nei prossimi 30 giorni;
  * orario libero fuori dalla fascia 08:00 - 17:30 (serve il personale per apertura e pulizie).
- Le ore occupate da lezioni (orario delle lezioni attivo) non si possono prenotare.
- Approva o rifiuta: l'Ufficio Tecnico (Supervisore, Manager) oppure il responsabile del locale
  (utente la cui email e' quella impostata come "email responsabile" del locale).
"""

import json
import os
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

import app.models as models

MIN_DAYS_AHEAD = 3          # oggi + 2 giorni di preavviso
AUTO_APPROVE_DAYS = 30      # oltre: serve approvazione
ANTI_ABUSE_MAX_DAYS = 10    # oltre: serve approvazione
FREE_TIME_MIN = "08:00"     # orario libero senza approvazione
FREE_TIME_MAX = "17:30"

# Orario scolastico (stesse fasce del gestionale IIS Grassi)
SLOT_TIMES = {
    1: ("08:30", "09:20"),
    2: ("09:20", "10:10"),
    3: ("10:20", "11:10"),
    4: ("11:10", "12:00"),
    5: ("12:10", "13:00"),
    6: ("13:00", "13:50"),
    7: ("14:20", "15:10"),
    8: ("15:10", "16:00"),
}

# Richieste extra possibili per gli eventi a orario libero (es. Auditorium)
EXTRA_LABELS = {
    "microfoni": "Microfoni",
    "proiezione": "Sistema di proiezione",
    "gobbo": "Gobbo per relatori",
    "pc_votazioni": "PC per votazioni",
    "supporto_tecnico": "Supporto tecnico durante l'evento",
}

DEFAULT_SCHEDULE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "orario_lezioni.json")


# --------------------------------------------------------------- orario lezioni

def ensure_default_schedule(db: Session) -> None:
    """Al primo avvio carica l'orario delle lezioni da data/orario_lezioni.json."""
    if db.query(models.ScheduleVersion).count() > 0 or not os.path.exists(DEFAULT_SCHEDULE_FILE):
        return
    with open(DEFAULT_SCHEDULE_FILE, encoding="utf-8") as f:
        raw = json.load(f)
    db.add(
        models.ScheduleVersion(
            name=raw.get("name") or "Orario delle lezioni",
            academic_year=raw.get("academic_year"),
            data=json.dumps(raw.get("rooms", {})),
            active=True,
        )
    )
    db.commit()


def active_schedule(db: Session) -> Optional[models.ScheduleVersion]:
    return (
        db.query(models.ScheduleVersion)
        .filter(models.ScheduleVersion.active == True)  # noqa: E712
        .order_by(models.ScheduleVersion.uploaded_at.desc())
        .first()
    )


def lesson_slots(db: Session, room_code: str, day: date) -> set:
    """Ore (1..8) in cui il locale ha lezione in quel giorno della settimana."""
    sched = active_schedule(db)
    if sched is None:
        return set()
    rooms = json.loads(sched.data)
    days = rooms.get(room_code) or {}
    slots = days.get(str(day.isoweekday())) or {}
    return {int(s) for s, busy in slots.items() if busy}


# --------------------------------------------------------------- utilita'

def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def valid_time(value: Optional[str]) -> bool:
    try:
        h, m = (value or "").split(":")
        return 0 <= int(h) <= 23 and 0 <= int(m) <= 59 and len(m) == 2
    except ValueError:
        return False


def overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    return _minutes(a_start) < _minutes(b_end) and _minutes(b_start) < _minutes(a_end)


def booking_interval(b: models.Booking) -> Tuple[str, str]:
    if b.slot:
        return SLOT_TIMES[b.slot]
    return b.start_time, b.end_time


def active_bookings(db: Session, room_id: int, day: date) -> List[models.Booking]:
    return (
        db.query(models.Booking)
        .filter(
            models.Booking.room_id == room_id,
            models.Booking.date == day,
            models.Booking.status.in_(models.ACTIVE_BOOKING_STATUSES),
        )
        .all()
    )


def find_conflicts(
    db: Session, room: models.Room, day: date, slots: List[int], start: Optional[str], end: Optional[str]
) -> List[str]:
    """Descrizione dei conflitti con lezioni o altre prenotazioni (lista vuota = libero)."""
    problems = []
    lessons = lesson_slots(db, room.code, day)
    existing = active_bookings(db, room.id, day)

    if slots:
        busy_lessons = sorted(set(slots) & lessons)
        if busy_lessons:
            problems.append("lezione alla " + ", ".join(f"{s}a ora" for s in busy_lessons))
        for b in existing:
            b_start, b_end = booking_interval(b)
            for s in slots:
                s_start, s_end = SLOT_TIMES[s]
                if (b.slot == s) or (not b.slot and overlaps(s_start, s_end, b_start, b_end)):
                    problems.append(f"{s}a ora gia' prenotata ({b.code})")
    else:
        for s in sorted(lessons):
            s_start, s_end = SLOT_TIMES[s]
            if overlaps(start, end, s_start, s_end):
                problems.append(f"lezione alla {s}a ora ({s_start}-{s_end})")
        for b in existing:
            b_start, b_end = booking_interval(b)
            if overlaps(start, end, b_start, b_end):
                problems.append(f"gia' prenotato {b_start}-{b_end} ({b.code})")
    return list(dict.fromkeys(problems))


def approval_reasons(
    db: Session, room: models.Room, user: models.User, day: date, start: Optional[str], end: Optional[str]
) -> List[str]:
    """Motivi per cui la richiesta resta "In attesa" (lista vuota = approvata subito)."""
    reasons = []
    today = date.today()
    if day > today + timedelta(days=AUTO_APPROVE_DAYS):
        reasons.append(f"Prenotazione con oltre {AUTO_APPROVE_DAYS} giorni di anticipo")

    window_end = today + timedelta(days=AUTO_APPROVE_DAYS)
    booked_days = {
        d
        for (d,) in db.query(models.Booking.date)
        .filter(
            models.Booking.room_id == room.id,
            models.Booking.user_id == user.id,
            models.Booking.status.in_(models.ACTIVE_BOOKING_STATUSES),
            models.Booking.date >= today,
            models.Booking.date <= window_end,
        )
        .all()
    }
    if today <= day <= window_end:
        booked_days.add(day)
    if len(booked_days) > ANTI_ABUSE_MAX_DAYS:
        reasons.append(
            f"Regola anti-abuso: piu' di {ANTI_ABUSE_MAX_DAYS} giorni prenotati in {room.code} nei prossimi {AUTO_APPROVE_DAYS} giorni"
        )

    if start and end and (_minutes(start) < _minutes(FREE_TIME_MIN) or _minutes(end) > _minutes(FREE_TIME_MAX)):
        reasons.append(f"Orario fuori dalla fascia {FREE_TIME_MIN}-{FREE_TIME_MAX} (serve il personale per apertura e pulizie)")
    return reasons


# --------------------------------------------------------------- permessi

def _same_email(a: Optional[str], b: Optional[str]) -> bool:
    return bool(a) and bool(b) and a.strip().lower() == b.strip().lower()


def can_approve(user: models.User, room: models.Room) -> bool:
    return user.role in models.STAFF_ROLES or _same_email(user.email, room.responsible_email)


def is_room_assistant(user: models.User, room: models.Room) -> bool:
    return _same_email(user.email, room.technical_assistant_email)


def approvers_for(db: Session, room: models.Room) -> List[models.User]:
    """Chi deve ricevere la notifica di una richiesta da approvare: il responsabile del locale
    se ha un account, altrimenti l'Ufficio Tecnico."""
    if room.responsible_email:
        u = db.query(models.User).filter(models.User.email.ilike(room.responsible_email.strip())).first()
        if u is not None and u.is_active:
            return [u]
    return (
        db.query(models.User)
        .filter(models.User.is_active == True, models.User.role.in_(models.STAFF_ROLES))  # noqa: E712
        .all()
    )


def user_by_email(db: Session, email: Optional[str]) -> Optional[models.User]:
    if not email:
        return None
    return db.query(models.User).filter(models.User.email.ilike(email.strip())).first()


def describe_when(rows: List[models.Booking]) -> str:
    """Es. "giovedi' 19/11/2026, ore 1a, 2a" oppure "venerdi' 20/11/2026, 18:00-21:00"."""
    giorni = ["lunedi'", "martedi'", "mercoledi'", "giovedi'", "venerdi'", "sabato", "domenica"]
    first = rows[0]
    when = f"{giorni[first.date.weekday()]} {first.date.strftime('%d/%m/%Y')}"
    slots = sorted(r.slot for r in rows if r.slot)
    if slots:
        return when + ", ore " + ", ".join(f"{s}a" for s in slots)
    return f"{when}, {first.start_time}-{first.end_time}"
