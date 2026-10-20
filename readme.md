# Aula Monitor System

Piattaforma web full-stack per il monitoraggio delle infrastrutture e la gestione delle segnalazioni di guasto (ticketing system) nelle aule e nei laboratori universitari.

---

## Architettura e Stack Tecnologico

- Frontend: Next.js (App Router), TypeScript, Tailwind CSS
- Backend: FastAPI (Python 3.11), SQLAlchemy, Pydantic
- Database: PostgreSQL 15
- Autenticazione: Google OAuth 2.0 & JWT (JSON Web Tokens)
- Containerizzazione: Docker & Docker Compose

---

## Modello dei Ruoli (RBAC)

Il sistema gestisce 4 livelli di autorizzazione:
1. STUDENTE: Consulta lo stato delle aule e invia segnalazioni di guasto.
2. DOCENTE: Consulta le aule e apre ticket prioritari per la didattica.
3. TECNICO: Prende in carico e aggiorna lo stato dei ticket di guasto.
4. ADMIN: Gestisce gli utenti e promuove i ruoli, aggiunge/rimuove aule ed effettua l'importazione massiva da file CSV.

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

Gli utenti registrati con ruolo ADMIN possono caricare nuove aule in blocco dall'interfaccia web (sezione "Aule e Laboratori") tramite il pulsante "Importa CSV".

Un file di esempio pronto per il test (`aule_esempio.csv`) è presente nella radice di questo repository con la seguente struttura:

```csv
code,building,capacity,has_projector
Aula Magna,Polo A - Piano Terra,250,true
Lab Informatica 1,Polo B - Primo Piano,40,true
Aula 3B,Polo A - Secondo Piano,80,true
```