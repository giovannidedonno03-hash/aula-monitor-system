"""Sostituisce i locali del database con l'elenco ufficiale della scuola.

Uso (dalla cartella del progetto, con Docker acceso):

    docker compose exec backend python import_aule.py              -> anteprima, non modifica nulla
    docker compose exec backend python import_aule.py --conferma   -> applica le modifiche

Le aule gia' presenti con lo stesso codice vengono aggiornate (i loro ticket restano).
Le aule che non sono nell'elenco vengono ELIMINATE insieme ai loro ticket e prenotazioni.
Si puo' indicare un altro file CSV come argomento: python import_aule.py altro_file.csv --conferma
"""

import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal  # noqa: E402
from app.room_import import parse_rooms_csv, apply_rooms  # noqa: E402

DEFAULT_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "aule_grassi.csv")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    confirm = "--conferma" in sys.argv
    path = args[0] if args else DEFAULT_CSV

    with open(path, encoding="utf-8") as f:
        rooms = parse_rooms_csv(f.read())
    if not rooms:
        print(f"Nessun locale trovato in {path}. Nulla da fare.")
        return

    # Importa anche models/main per avere tabelle e colonne aggiornate (migrazioni all'avvio)
    import main as _app  # noqa: F401,E402

    db = SessionLocal()
    try:
        result = apply_rooms(db, rooms, delete_missing=True, commit=False)

        print(f"File: {path} ({len(rooms)} locali)")
        print(f"  Nuovi locali da creare:     {len(result.created)}")
        print(f"  Locali esistenti aggiornati: {len(result.updated)}")
        print(f"  Locali vecchi da eliminare:  {len(result.deleted)}")
        if result.deleted:
            print("    -> " + ", ".join(result.deleted))
            print(f"    con {result.deleted_tickets} ticket e {result.deleted_bookings} prenotazioni collegati")

        if confirm:
            db.commit()
            print("\nFatto: modifiche salvate nel database.")
        else:
            db.rollback()
            print("\nAnteprima: nessuna modifica salvata. Riesegui con --conferma per applicarle.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
