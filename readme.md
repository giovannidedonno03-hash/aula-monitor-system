# Aula Monitor System

Piattaforma web full-stack per il monitoraggio delle infrastrutture e la gestione delle segnalazioni di guasto (ticketing system) nelle aule e nei laboratori di una scuola superiore (ITTS C. Grassi), con prenotazione delle aule.

---

## Architettura e Stack Tecnologico

- Frontend: Next.js (App Router), TypeScript, Tailwind CSS
- Backend: FastAPI (Python 3.11), SQLAlchemy, Pydantic
- Database: PostgreSQL 15
- Autenticazione: Google OAuth 2.0 & JWT (JSON Web Tokens)
- Containerizzazione: Docker & Docker Compose

---

## Modello dei Ruoli (RBAC)

Il sistema usa gli stessi ruoli del gestionale dell'Ufficio Tecnico dell'IIS Grassi (gli studenti non hanno accesso):
1. SUPERVISORE: gestisce utenti e ruoli, aule (anche import CSV) e tutte le segnalazioni; può eliminare qualsiasi ticket.
2. MANAGER (Ufficio Tecnico): vede tutte le segnalazioni, le prende in carico e ne cambia lo stato (anche inoltro a FACTOTUM).
3. RESPONSABILE_LAB: docente responsabile di laboratorio.
4. ASSISTENTE_TECNICO: assistente tecnico (AT) di laboratorio.
5. UTENTE: docente / personale; apre segnalazioni e prenota le aule.

L'accesso è consentito solo con l'email della scuola (`@itisgrassi.edu.it`), impostata con la variabile `ALLOWED_EMAIL_DOMAIN` in `docker-compose.yml` (vuota = qualsiasi account Google). Se non esiste ancora un Supervisore con l'email della scuola, chi accede per primo lo diventa; tutti gli altri nuovi utenti sono UTENTE. Responsabile Lab, Assistente Tecnico e Utente vedono solo le proprie segnalazioni.

Stati dei ticket: APERTO → IN CARICO → IN ESECUZIONE → INOLTRATO A FACTOTUM → RISOLTO.
Ogni ticket ha plesso (Sede Principale / Gianelli), categoria e priorità (Bassa, Media, Alta, Urgente).

## Elenco dei locali

L'elenco ufficiale dei locali della scuola (126 locali, sede principale e plesso Gianelli) è in `backend/data/aule_grassi.csv`, con le colonne:

`codice,tipo,sede,prenotabile,orario_libero,responsabile,assistente_tecnico,dotazioni`

Il codice è Lettera piano (A, B, C, I, G, R, P) + numero; i locali G sono nel plesso Gianelli. Solo i locali con `prenotabile = si` compaiono nella pagina Prenotazioni.

Per sostituire tutti i locali del database con quelli del file (i locali che non sono nell'elenco vengono eliminati insieme ai loro ticket e prenotazioni):

```bash
docker compose exec backend python import_aule.py              # anteprima, non modifica nulla
docker compose exec backend python import_aule.py --conferma   # applica
```

Dalla pagina Aule il Supervisore può anche **modificare** un singolo locale (tipo, plesso, prenotabilità, responsabile, assistente tecnico, dotazioni).

Il pulsante "Importa CSV" della pagina Aule accetta lo stesso formato (ad esempio `aule_esempio.csv` nella cartella principale, che contiene lo stesso elenco), ma aggiunge o aggiorna i locali senza eliminarne nessuno.

## Lavoro sui ticket (Ufficio Tecnico)

Cliccando su una segnalazione si apre il dettaglio, dove Supervisore e Manager possono:
- cambiare lo stato (anche inoltro a FACTOTUM);
- **prendere in carico** o **lasciare** il ticket; il Supervisore può assegnarlo a uno o più collaboratori;
- scrivere **commenti interni** (visibili solo all'Ufficio Tecnico) taggando i colleghi con @Cognome.

La **campanella** in alto avvisa quando:
- qualcuno ti tagga con @Cognome in un commento interno;
- un'altra persona ti assegna un ticket;
- cambia lo stato di una segnalazione che hai aperto tu.

Cliccando sulla notifica si apre direttamente il ticket.

La vista **Assegnate a me** (`/ticket?vista=assegnate`) mostra i ticket del tecnico collegato.
La pagina **Statistiche** (`/statistiche`) riporta tasso di risoluzione, tempi medi di presa in carico e risoluzione, carico per collaboratore, ripartizione per stato, categoria, priorità e plesso, e l'andamento degli ultimi 14 giorni.

## Dashboard TV

La pagina `/tv` mostra a schermo intero contatori, colonne per stato, carico dei tecnici e un ticker delle urgenze, con aggiornamento automatico ogni 30 secondi. È visibile a Supervisore e Manager; per un televisore senza login usare `http://localhost:3000/tv?kiosk=true`.

---

## Istruzioni per l'Avvio con Docker

### Prerequisiti
- Docker Desktop installato ed avviato.

### 1. Clonare il repository
```bash
git clone https://github.com/TUO_USERNAME/aula-monitor-system.git
cd aula-monitor-system
```

### 2. Avvio dell'Applicazione con Docker Compose
Eseguire il seguente comando per creare le immagini e avviare i container:

```bash
docker compose up --build
```

L'applicazione sarà accessibile agli indirizzi:
- Frontend Web: http://localhost:3000
- Backend API (Documentazione Swagger): http://localhost:8000/docs

---

## Popolamento Dati Iniziale (Seeding via Python)

Mentre i container Docker sono in esecuzione, aprire un secondo terminale ed eseguire questo comando per popolare il database PostgreSQL con aule e ticket di prova:

```bash
docker exec -it monitor_backend python seed.py
```

---

## Importazione Massiva Aule (CSV)

Gli utenti con ruolo SUPERVISORE possono caricare i locali in blocco dall'interfaccia web (sezione "Aule e Laboratori") tramite il pulsante "Importa CSV".

Il file `aule_esempio.csv` nella radice del repository contiene l'elenco completo dei locali con la seguente struttura:

```csv
codice,tipo,sede,prenotabile,orario_libero,responsabile,assistente_tecnico,dotazioni
A01,aula,Grassi,si,no,Ufficio tecnico,,PC cattedra · Lim / Monitor Touch
A23,non_assegnabile,Grassi,si,si,Ufficio tecnico,,Sedute per riunioni · Pc per proiezioni · Lavagna LIM
G01,aula,Gianelli,no,no,,,
```