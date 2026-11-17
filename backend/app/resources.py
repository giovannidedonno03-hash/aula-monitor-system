"""Prenotazione dei carrelli mobili (risorse a quantita').

- Un carrello ha N PC. Per ogni giorno e ora si possono prenotare alcuni PC
  oppure tutto il carrello, finche' ce ne sono di liberi.
- "Tutto il carrello" e' possibile solo se in quell'ora nessuno ha gia' prenotato dei PC.
- Stesso preavviso dei locali: da oggi + 3 giorni, dal lunedi' al venerdi'.
"""

from datetime import date
from typing import Iterable, List

from sqlalchemy import func
from sqlalchemy.orm import Session

import app.models as models


def used_quantity(db: Session, resource_id: int, day: date, slot: int) -> int:
    """PC gia' prenotati in quel giorno e ora."""
    total = (
        db.query(func.coalesce(func.sum(models.ResourceBooking.quantity), 0))
        .filter(
            models.ResourceBooking.resource_id == resource_id,
            models.ResourceBooking.date == day,
            models.ResourceBooking.slot == slot,
        )
        .scalar()
    )
    return int(total or 0)


def check_request(
    db: Session, resource: models.Resource, day: date, slots: Iterable[int], quantity: int, whole_cart: bool
) -> List[str]:
    """Problemi di disponibilita' per la richiesta (lista vuota = si puo' prenotare)."""
    problems = []
    for s in sorted(set(slots)):
        used = used_quantity(db, resource.id, day, s)
        free = resource.quantity - used
        if whole_cart and used > 0:
            problems.append(f"{s}a ora: {used} PC gia' prenotati, il carrello intero non e' disponibile")
        elif not whole_cart and quantity > free:
            problems.append(f"{s}a ora: liberi solo {max(free, 0)} PC su {resource.quantity}")
    return problems


def max_booked_per_slot(db: Session, resource_id: int, from_day: date) -> int:
    """Il massimo di PC prenotati in una stessa ora, da oggi in poi (per non ridurre troppo un carrello)."""
    rows = (
        db.query(func.sum(models.ResourceBooking.quantity))
        .filter(models.ResourceBooking.resource_id == resource_id, models.ResourceBooking.date >= from_day)
        .group_by(models.ResourceBooking.date, models.ResourceBooking.slot)
        .all()
    )
    return max((int(r[0] or 0) for r in rows), default=0)

