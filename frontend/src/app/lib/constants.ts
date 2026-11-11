// Valori condivisi tra le pagine: devono coincidere con gli enum del backend (app/models.py)

/**
 * Indirizzo delle API del backend.
 * Il backend gira sullo stesso computer del sito, sulla porta 8000: si usa quindi
 * l'host da cui è stata aperta la pagina. Così il sito funziona sia da
 * http://localhost:3000 sia da un altro dispositivo della rete
 * (es. Smart TV su http://192.168.1.25:3000/tv?kiosk=true).
 * Se NEXT_PUBLIC_API_URL punta a un server vero (non localhost) si usa quello.
 */
export function getApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (env && !/localhost|127\.0\.0\.1/.test(env)) return `${env}/api/v1`;
  if (typeof window === "undefined") return "http://localhost:8000/api/v1";
  return `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
}

// ---------------- RUOLI ----------------
export type UserRole = "SUPERVISORE" | "MANAGER" | "RESPONSABILE_LAB" | "ASSISTENTE_TECNICO" | "UTENTE";

export const ROLES: { id: UserRole; label: string; description: string; badge: string }[] = [
  {
    id: "SUPERVISORE",
    label: "Supervisore",
    description: "Gestisce utenti, aule e tutte le segnalazioni",
    badge: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  },
  {
    id: "MANAGER",
    label: "Manager UT",
    description: "Personale dell'Ufficio Tecnico: lavora le segnalazioni",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  {
    id: "RESPONSABILE_LAB",
    label: "Responsabile Lab",
    description: "Docente responsabile di laboratorio",
    badge: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  },
  {
    id: "ASSISTENTE_TECNICO",
    label: "Assistente Tecnico",
    description: "Assistente tecnico (AT) di laboratorio",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  {
    id: "UTENTE",
    label: "Utente",
    description: "Docente / personale: apre segnalazioni e prenota aule",
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
];

export const roleInfo = (role?: string | null) => ROLES.find((r) => r.id === role) ?? ROLES[ROLES.length - 1];

/** Ufficio Tecnico: può lavorare le segnalazioni e vedere la dashboard TV */
export const isStaff = (role?: string | null) => role === "SUPERVISORE" || role === "MANAGER";
export const isSupervisor = (role?: string | null) => role === "SUPERVISORE";

// ---------------- STATI TICKET ----------------
export type TicketStatus = "APERTO" | "IN_CARICO" | "IN_ESECUZIONE" | "INOLTRATO_FACTOTUM" | "RISOLTO";

export const STATUSES: { id: TicketStatus; label: string; badge: string; dot: string }[] = [
  { id: "APERTO", label: "Aperto", badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20", dot: "bg-blue-500" },
  { id: "IN_CARICO", label: "In Carico", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", dot: "bg-amber-500" },
  { id: "IN_ESECUZIONE", label: "In Esecuzione", badge: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20", dot: "bg-cyan-500" },
  { id: "INOLTRATO_FACTOTUM", label: "Inoltrato a FACTOTUM", badge: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20", dot: "bg-purple-500" },
  { id: "RISOLTO", label: "Risolto", badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500" },
];

export const statusInfo = (s?: string | null) => STATUSES.find((x) => x.id === s) ?? STATUSES[0];

// ---------------- PRIORITÀ ----------------
export type TicketPriority = "BASSA" | "MEDIA" | "ALTA" | "URGENTE";

export const PRIORITIES: { id: TicketPriority; label: string; badge: string }[] = [
  { id: "BASSA", label: "Bassa", badge: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20" },
  { id: "MEDIA", label: "Media", badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  { id: "ALTA", label: "Alta", badge: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
  { id: "URGENTE", label: "Urgente", badge: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30" },
];

export const priorityInfo = (p?: string | null) => PRIORITIES.find((x) => x.id === p) ?? PRIORITIES[1];

// ---------------- CATEGORIE ----------------
export type TicketCategory = "INFORMATICO" | "ELETTRICO" | "IDRAULICO" | "EDILE" | "ARREDI" | "SICUREZZA" | "ALTRO";

export const CATEGORIES: { id: TicketCategory; label: string }[] = [
  { id: "INFORMATICO", label: "Informatico" },
  { id: "ELETTRICO", label: "Elettrico" },
  { id: "IDRAULICO", label: "Idraulico" },
  { id: "EDILE", label: "Edile" },
  { id: "ARREDI", label: "Arredi" },
  { id: "SICUREZZA", label: "Sicurezza" },
  { id: "ALTRO", label: "Altro" },
];

export const categoryLabel = (c?: string | null) => CATEGORIES.find((x) => x.id === c)?.label ?? "Altro";

// ---------------- PLESSI ----------------
export type Plesso = "SEDE_PRINCIPALE" | "GIANELLI";

export const PLESSI: { id: Plesso; label: string }[] = [
  { id: "SEDE_PRINCIPALE", label: "Sede Principale" },
  { id: "GIANELLI", label: "Plesso Gianelli" },
];

export const plessoLabel = (p?: string | null) => PLESSI.find((x) => x.id === p)?.label ?? "Sede Principale";

// ---------------- LOCALI ----------------
export type RoomType = "AULA" | "AULA_PRIORITA" | "LAB" | "NON_ASSEGNABILE" | "CORRIDOIO" | "PALESTRA" | "NOAULA";

export const ROOM_TYPES: { id: RoomType; label: string }[] = [
  { id: "AULA", label: "Aula" },
  { id: "AULA_PRIORITA", label: "Aula con priorità" },
  { id: "LAB", label: "Laboratorio" },
  { id: "NON_ASSEGNABILE", label: "Non assegnabile" },
  { id: "CORRIDOIO", label: "Corridoio / Spazio comune" },
  { id: "PALESTRA", label: "Palestra" },
  { id: "NOAULA", label: "Nessuna aula" },
];

export const roomTypeLabel = (t?: string | null) => ROOM_TYPES.find((x) => x.id === t)?.label ?? "Aula";

export interface Room {
  id: number;
  code: string;
  room_type: RoomType;
  plesso: Plesso;
  is_bookable: boolean;
  free_schedule: boolean;
  responsible: string | null;
  technical_assistant: string | null;
  equipment: string | null; // dotazioni separate da " · "
  is_active: boolean;
}

export const splitEquipment = (e?: string | null) =>
  (e || "")
    .split("·")
    .map((x) => x.trim())
    .filter(Boolean);

// ---------------- TICKET ----------------
export interface Ticket {
  id: number;
  code: string;
  title: string;
  description: string;
  status: TicketStatus;
  plesso: Plesso;
  category: TicketCategory;
  priority: TicketPriority;
  created_at: string;
  updated_at: string | null;
  room_id: number;
  room_code: string | null;
  reporter_id: number;
  reporter_name: string | null;
  assignees: Assignee[];
  assigned_to_name: string | null; // nomi dei tecnici separati da virgola
  comments_count: number;
  taken_at: string | null;
  resolved_at: string | null;
  factotum_code: string | null;
  factotum_notes: string | null;
  factotum_date: string | null;
}

export interface Assignee {
  id: number;
  name: string;
  email: string;
  picture: string | null;
  assigned_at: string | null;
}

export interface StaffUser {
  id: number;
  name: string;
  email: string;
  picture: string | null;
  role: UserRole;
}

export interface TicketComment {
  id: number;
  ticket_id: number;
  author_id: number;
  author_name: string;
  author_email: string;
  author_picture: string | null;
  content: string;
  created_at: string;
}

// Il backend salva le date in UTC senza fuso: aggiungiamo "Z" per mostrarle nell'ora locale
export function parseServerDate(value: string): Date {
  return new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(value) ? value : value + "Z");
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return parseServerDate(value).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
