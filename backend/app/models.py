from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Enum, Text
from sqlalchemy.orm import relationship
import enum
from datetime import datetime
from app.database import Base

class UserRole(str, enum.Enum):
    STUDENTE = "STUDENTE"
    DOCENTE = "DOCENTE"
    TECNICO = "TECNICO"
    ADMIN = "ADMIN"

class TicketStatus(str, enum.Enum):
    IN_ATTESA = "IN_ATTESA"
    IN_LAVORAZIONE = "IN_LAVORAZIONE"
    RISOLTO = "RISOLTO"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    role = Column(Enum(UserRole), default=UserRole.STUDENTE, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tickets = relationship("Ticket", back_populates="reporter")

class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)
    building = Column(String, nullable=False)
    capacity = Column(Integer, nullable=False)
    has_projector = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)

    tickets = relationship("Ticket", back_populates="room", cascade="all, delete-orphan")

class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    status = Column(Enum(TicketStatus), default=TicketStatus.IN_ATTESA, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    room = relationship("Room", back_populates="tickets")
    reporter = relationship("User", back_populates="tickets")