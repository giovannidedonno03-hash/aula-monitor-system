"""Import dei locali della scuola da CSV.

Formato del CSV (intestazione obbligatoria, come backend/data/aule_grassi.csv):

    codice,tipo,sede,prenotabile,orario_libero,responsabile,assistente_tecnico,dotazioni
    A01,aula,Grassi,si,no,Ufficio tecnico,,PC cattedra · Lim / Monitor Touch

- tipo: aula, aula_priorita, lab, non_assegnabile, corridoio, palestra, noaula
- sede: Grassi (sede principale) oppure Gianelli
- prenotabile / orario_libero: si / no
- dotazioni: elenco separato da " · "
"""

import csv
import io
from dataclasses import dataclass, field
from typing import Iterable, List

from sqlalchemy.orm import Session

import app.models as models

YES = {"si", "sì", "s", "yes", "y", "true", "1", "x"}


def _yes(value) -> bool:
    return str(value or "").strip().lower() in YES


def _text(value):
    value = (value or "").strip()
    return None if value in ("", "—", "-") else value


def _plesso(value) -> models.Plesso:
    return models.Plesso.GIANELLI if "gianelli" in str(value or "").lower() else models.Plesso.SEDE_PRINCIPALE


def _room_type(value) -> models.RoomType:
    key = str(value or "").strip().upper().replace(" ", "_")
    try:
        return models.RoomType(key)
    except ValueError:
        return models.RoomType.AULA


def parse_rooms_csv(content: str) -> List[dict]:
    """Converte il testo CSV in una lista di dizionari pronti per models.Room."""
    reader = csv.DictReader(io.StringIO(content.lstrip("﻿")))
    rooms = []
    for row in reader:
        row = {(k or "").strip().lower(): v for k, v in row.items()}
        code = _text(row.get("codice") or row.get("locale") or row.get("code"))
        if not code:
            continue
        rooms.append(
            {
                "code": code,
                "room_type": _room_type(row.get("tipo")),
                "plesso": _plesso(row.get("sede")),
                "is_bookable": _yes(row.get("prenotabile")),
                "free_schedule": _yes(row.get("orario_libero")),
                "responsible": _text(row.get("responsabile")),
                "technical_assistant": _text(row.get("assistente_tecnico")),
                "equipment": _text(row.get("dotazioni")),
            }
        )
    return rooms


@dataclass
class ImportResult:
    created: List[str] = field(default_factory=list)
    updated: List[str] = field(default_factory=list)
    deleted: List[str] = field(default_factory=list)
    deleted_tickets: int = 0
    deleted_bookings: int = 0


def apply_rooms(db: Session, rooms: Iterable[dict], delete_missing: bool = False, commit: bool = True) -> ImportResult:
    """Crea o aggiorna i locali (riconosciuti dal codice).

    Con delete_missing=True elimina anche i locali che NON sono nell'elenco,
    insieme ai ticket e alle prenotazioni collegati.
    """
    rooms = list(rooms)
    result = ImportResult()
    wanted = {r["code"] for r in rooms}
    existing = {room.code: room for room in db.query(models.Room).all()}

    for data in rooms:
        room = existing.get(data["code"])
        if room is None:
            db.add(models.Room(is_active=True, **data))
            result.created.append(data["code"])
        else:
            for key, value in data.items():
                setattr(room, key, value)
            result.updated.append(data["code"])

    if delete_missing:
        for code, room in existing.items():
            if code in wanted:
                continue
            result.deleted.append(code)
            result.deleted_tickets += len(room.tickets)
            result.deleted_bookings += len(room.bookings)
            db.delete(room)  # ticket e prenotazioni vengono eliminati a cascata

    if commit:
        db.commit()
    return result
