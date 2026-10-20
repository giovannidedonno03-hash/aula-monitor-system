FROM python:3.11-slim

WORKDIR /app

# Disabilita il buffering di Python per vedere i log in tempo reale
ENV PYTHONUNBUFFERED=1

# Installazione dipendenze
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia del codice sorgente
COPY . .

# Comando per avviare il server FastAPI con Uvicorn e live-reload per lo sviluppo
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]