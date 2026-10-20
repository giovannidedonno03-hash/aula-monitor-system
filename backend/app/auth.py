import os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from google.oauth2 import id_token
from google.auth.transport import requests
from sqlalchemy.orm import Session

from app.database import get_db
import app.models as models

SECRET_KEY = os.getenv("SECRET_KEY", "supersecretkey_per_jwt_aula_monitor_2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # Token valido per 24 ore
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/google", auto_error=False)

def verify_google_token(token: str) -> dict:
    """Verifica il token inviato da Google tramite le API ufficiali Google."""
    try:
        id_info = id_token.verify_oauth2_token(
            token, requests.Request(), GOOGLE_CLIENT_ID
        )
        return id_info
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token Google non valido: {str(e)}"
        )

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Genera un JWT cifrato con dati utente e ruolo."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    """Dipendenza per estrarre l'utente corrente dal JWT inviato nell'header Authorization."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticazione richiesta. Effettua il login."
        )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="Token non valido.")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token scaduto o non valido.")

    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Utente non trovato o disattivato.")
    return user

def require_role(allowed_roles: list[models.UserRole]):
    """Dipendenza per la gestione dei Ruoli e Permessi (RBAC)."""
    def role_checker(current_user: models.User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permessi insufficienti. Ruoli autorizzati: {[r.value for r in allowed_roles]}"
            )
        return current_user
    return role_checker