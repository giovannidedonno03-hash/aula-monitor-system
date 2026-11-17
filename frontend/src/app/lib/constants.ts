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
  responsible_email: string | null;
  technical_assistant: string | null;
  technical_assistant_email: string | null;
  equipment: string | null; // dotazioni separate da " · "
  is_active: boolean;
}

export const splitEquipment = (e?: string | null) =>
  (e || "")
    .split("·")
    .map((x) => x.trim())
    .filter(Boolean);

// ---------------- PRENOTAZIONI ----------------
// Orario scolastico (stesse fasce del gestionale IIS Grassi e del backend)
export const SLOTS = [
  { slot: 1, label: "1ª ora", start: "08:30", end: "09:20" },
  { slot: 2, label: "2ª ora", start: "09:20", end: "10:10" },
  { slot: 3, label: "3ª ora", start: "10:20", end: "11:10" },
  { slot: 4, label: "4ª ora", start: "11:10", end: "12:00" },
  { slot: 5, label: "5ª ora", start: "12:10", end: "13:00" },
  { slot: 6, label: "6ª ora", start: "13:00", end: "13:50" },
  { slot: 7, label: "7ª ora", start: "14:20", end: "15:10" },
  { slot: 8, label: "8ª ora", start: "15:10", end: "16:00" },
];

export type BookingStatus = "APPROVATA" | "IN_ATTESA" | "RIFIUTATA";

export const BOOKING_STATUSES: Record<BookingStatus, { label: string; badge: string }> = {
  APPROVATA: { label: "Approvata", badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  IN_ATTESA: { label: "In attesa", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  RIFIUTATA: { label: "Rifiutata", badge: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30" },
};

export const bookingStatusInfo = (s?: string | null) => BOOKING_STATUSES[(s as BookingStatus) || "APPROVATA"] ?? BOOKING_STATUSES.APPROVATA;

// Richieste extra per gli eventi a orario libero (es. Auditorium)
export const BOOKING_EXTRAS: { id: string; label: string }[] = [
  { id: "microfoni", label: "Microfoni" },
  { id: "proiezione", label: "Sistema di proiezione" },
  { id: "gobbo", label: "Gobbo per relatori" },
  { id: "pc_votazioni", label: "PC per votazioni" },
  { id: "supporto_tecnico", label: "Supporto tecnico durante l'evento" },
];

export const extrasLabels = (extras?: Record<string, unknown> | null) =>
  BOOKING_EXTRAS.filter((e) => extras && extras[e.id]).map((e) => e.label);

export interface Booking {
  id: number;
  code: string;
  room_id: number;
  room_code: string;
  user_id: number;
  user_name: string;
  user_email: string;
  date: string; // YYYY-MM-DD
  slot: number | null; // vuoto se a orario libero
  start_time: string | null;
  end_time: string | null;
  extras: Record<string, boolean> | null;
  purpose: string;
  status: BookingStatus;
  status_reason: string | null;
  reject_reason: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
}

/** Raggruppa le righe con lo stesso codice (una richiesta = più ore) */
export function groupBookings(rows: Booking[]): Booking[][] {
  const groups = new Map<string, Booking[]>();
  rows.forEach((b) => groups.set(b.code, [...(groups.get(b.code) || []), b]));
  return Array.from(groups.values());
}

/** Es. "gio 19/11/2026 • ore 1ª, 2ª" oppure "lun 23/11/2026 • 18:00-21:00" */
export function describeBooking(group: Booking[]): string {
  const first = group[0];
  const [y, m, d] = first.date.split("-").map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString("it-IT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const slots = group.map((b) => b.slot).filter((s): s is number => !!s).sort((a, b) => a - b);
  return slots.length > 0
    ? `${day} • ore ${slots.map((s) => `${s}ª`).join(", ")}`
    : `${day} • ${first.start_time}-${first.end_time}`;
}

// ---------------- CARRELLI MOBILI ----------------
export interface Resource {
  id: number;
  name: string;
  quantity: number; // numero di PC nel carrello
  plesso: Plesso;
  location: string | null;
  description: string | null;
  is_active: boolean;
}

export interface ResourceBooking {
  id: number;
  code: string;
  resource_id: number;
  resource_name: string;
  resource_total: number;
  user_id: number;
  user_name: string;
  user_email: string;
  room_id: number | null;
  room_code: string | null;
  date: string; // YYYY-MM-DD
  slot: number;
  quantity: number;
  whole_cart: boolean;
  purpose: string;
  created_at: string;
}

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

export interface AppNotification {
  id: number;
  type: "MENZIONE" | "ASSEGNAZIONE" | "STATO" | "PRENOTAZIONE";
  title: string;
  message: string;
  ticket_id: number | null;
  link: string | null; // pagina da aprire (es. /prenotazioni/gestione)
  is_read: boolean;
  created_at: string;
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
