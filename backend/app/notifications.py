"""Creazione delle notifiche (campanella in alto nel sito).

Si creano notifiche quando:
- qualcuno ti tagga con @Cognome in un commento interno (MENZIONE);
- ti viene assegnato un ticket da un'altra persona (ASSEGNAZIONE);
- cambia lo stato di una segnalazione che hai aperto tu (STATO).
Chi compie l'azione non riceve mai la notifica di se stesso.
"""

import re
from typing import Iterable, Optional

from sqlalchemy.orm import Session

import app.models as models

STATUS_LABELS = {
    models.TicketStatus.APERTO: "Aperto",
    models.TicketStatus.IN_CARICO: "In Carico",
    models.TicketStatus.IN_ESECUZIONE: "In Esecuzione",
    models.TicketStatus.INOLTRATO_FACTOTUM: "Inoltrato a FACTOTUM",
    models.TicketStatus.RISOLTO: "Risolto",
}

MENTION_RE = re.compile(r"@([^\W\d_][\w'.-]*)", re.UNICODE)


def _name(user: models.User) -> str:
    return user.full_name or user.email


def notify(
    db: Session,
    user_ids: Iterable[int],
    type_: models.NotificationType,
    title: str,
    message: str,
    ticket: Optional[models.Ticket] = None,
    actor: Optional[models.User] = None,
) -> None:
    """Aggiunge una notifica per ciascun destinatario (senza commit)."""
    for uid in dict.fromkeys(user_ids):
        if uid is None or (actor is not None and uid == actor.id):
            continue
        db.add(
            models.Notification(
                user_id=uid,
                type=type_,
                title=title,
                message=message,
                ticket_id=ticket.id if ticket is not None else None,
            )
        )


def notify_status_change(db: Session, ticket: models.Ticket, old_status, actor: models.User) -> None:
    """Avvisa chi ha aperto la segnalazione che lo stato e' cambiato."""
    if ticket.status == old_status:
        return
    label = STATUS_LABELS.get(ticket.status, str(ticket.status))
    message = f"La tua segnalazione \"{ticket.title}\" ora è: {label}."
    if ticket.status == models.TicketStatus.INOLTRATO_FACTOTUM and ticket.factotum_code:
        message += f" Pratica {ticket.factotum_code}."
    notify(
        db,
        [ticket.reporter_id],
        models.NotificationType.STATO,
        f"{ticket.code}: {label}",
        message,
        ticket,
        actor,
    )


def notify_assigned(db: Session, ticket: models.Ticket, user_ids: Iterable[int], actor: models.User) -> None:
    """Avvisa i tecnici appena aggiunti al ticket."""
    notify(
        db,
        user_ids,
        models.NotificationType.ASSEGNAZIONE,
        f"Ti è stato assegnato {ticket.code}",
        f"{_name(actor)} ti ha assegnato la segnalazione \"{ticket.title}\".",
        ticket,
        actor,
    )


def find_mentioned(db: Session, text: str) -> list:
    """Utenti dell'Ufficio Tecnico taggati nel testo con @Cognome (o @Nome)."""
    tags = {m.group(1).strip(".'-").lower() for m in MENTION_RE.finditer(text)}
    if not tags:
        return []
    staff = (
        db.query(models.User)
        .filter(models.User.is_active == True, models.User.role.in_(models.STAFF_ROLES))  # noqa: E712
        .all()
    )
    found = []
    for u in staff:
        words = {w.lower() for w in re.split(r"\s+", u.full_name or "") if w}
        words.add(u.email.split("@")[0].lower())
        if tags & words:
            found.append(u)
    return found


def notify_mentions(db: Session, ticket: models.Ticket, text: str, actor: models.User) -> None:
    mentioned = find_mentioned(db, text)
    preview = text if len(text) <= 120 else text[:117] + "..."
    notify(
        db,
        [u.id for u in mentioned],
        models.NotificationType.MENZIONE,
        f"{_name(actor)} ti ha menzionato in {ticket.code}",
        preview,
        ticket,
        actor,
    )
