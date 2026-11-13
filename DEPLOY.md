# Mettere il sito online su Webdock

Il sito gira sul server con Docker, come sul PC, ma con la configurazione di produzione
(`docker-compose.prod.yml`): HTTPS automatico tramite Caddy, database chiuso verso
internet, frontend compilato in modalità produzione.

## 0. Prima: carica l'ultima versione su GitHub

Sul PC, nella cartella del progetto:

```bash
git add -A
git commit -m "Configurazione per il server (Docker di produzione, Caddy, guida DEPLOY)"
git push origin main
```

## 1. Crea il server su Webdock

1. Nel pannello Webdock crea un nuovo server.
2. Come immagine scegli **Ubuntu (24.04 o 22.04) senza stack web** (niente LEMP/LAMP):
   le porte 80 e 443 devono restare libere per Caddy.
3. Come profilo basta il più piccolo disponibile con l'account studenti
   (consigliati almeno 2 GB di RAM: la compilazione del frontend ne usa parecchia).
4. Annota dalla pagina del server l'**indirizzo IP** e l'**alias** del tipo
   `nomeserver.vps.webdock.cloud`: sarà l'indirizzo del sito.

## 2. Entra nel server

Dal pannello del server: **Shell Users**. C'è già l'utente `admin`.
- Il modo più semplice è il **Web SSH Terminal** dalla card dell'utente (si apre nel browser).
- In alternativa abilita *Password Authentication* e dal PC: `ssh admin@INDIRIZZO-DEL-SERVER`
  (la password è nella pagina delle informazioni del server).

## 3. Installa Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker run hello-world
```

Se `hello-world` dà un errore sullo "storage driver" (server di tipo LXD), segui la nota
*fuse-overlayfs* della guida Webdock "How to install and run Docker containers on a Webdock
Ubuntu server".

Se il firewall `ufw` è attivo, apri le porte del sito:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## 4. Scarica il progetto e configuralo

```bash
git clone https://github.com/giovannidedonno03-hash/aula-monitor-system.git
cd aula-monitor-system
cp .env.produzione.esempio .env
openssl rand -hex 32      # copia il risultato: è la SECRET_KEY
nano .env
```

Nel file `.env` imposta:
- `DOMINIO` = l'alias del server (es. `nomeserver.vps.webdock.cloud`), senza `https://`
- `POSTGRES_PASSWORD` = una password lunga, solo lettere e numeri
- `SECRET_KEY` = il valore generato con `openssl`

Salva con `Ctrl+O`, `Invio`, esci con `Ctrl+X`.

## 5. Autorizza il dominio su Google

Nella [Google Cloud Console](https://console.cloud.google.com/apis/credentials), apri il
client OAuth usato dal sito e in **Origini JavaScript autorizzate** aggiungi
`https://nomeserver.vps.webdock.cloud` (il tuo DOMINIO, con https://). Senza questo passo
il pulsante "Accedi con Google" non funziona sul server.

Se l'app OAuth è in modalità **Test**, aggiungi tra gli *utenti di test* le email
`@itisgrassi.edu.it` che devono accedere.

## 6. Avvia il sito

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f
```

La prima volta la compilazione richiede qualche minuto. Nei log di `caddy` deve comparire
che il certificato è stato ottenuto (`certificate obtained successfully`). `Ctrl+C` esce dai log
senza fermare il sito.

Carica l'elenco dei locali:

```bash
docker compose -f docker-compose.prod.yml exec backend python import_aule.py --conferma
```

Apri `https://TUO-DOMINIO`: il primo account `@itisgrassi.edu.it` che accede diventa Supervisore.
La Dashboard TV è su `https://TUO-DOMINIO/tv?kiosk=true`.

## Aggiornare il sito dopo nuove modifiche

Dopo un `git push` dal PC, sul server:

```bash
cd aula-monitor-system
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Problemi frequenti

- **Il sito non si apre / errore di certificato**: controlla che l'alias punti all'IP del server
  e che le porte 80 e 443 siano aperte; guarda `docker compose -f docker-compose.prod.yml logs caddy`.
- **"Accesso consentito solo con l'email della scuola"**: stai usando un account non `@itisgrassi.edu.it`.
- **Il login Google non parte**: manca il dominio nelle Origini JavaScript autorizzate (passo 5).
- **La build del frontend si blocca o va in errore di memoria**: il server ha poca RAM;
  prova un profilo più grande oppure aggiungi uno swap file.
