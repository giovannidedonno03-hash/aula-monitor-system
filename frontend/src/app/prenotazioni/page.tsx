"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BOOKING_EXTRAS,
  Booking,
  Room,
  SLOTS,
  UserRole,
  bookingStatusInfo,
  describeBooking,
  extrasLabels,
  getApiBase,
  groupBookings,
  isSupervisor,
  plessoLabel,
  roomTypeLabel,
  splitEquipment,
} from "../lib/constants";

interface User {
  id: number;
  role: UserRole;
}

/** Orario delle lezioni: aula -> giorno (1-5) -> ora (1-8) -> c'è lezione */
type LessonSchedule = Record<string, Record<string, Record<string, boolean>>>;

const DAY_NAMES = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì"];

// Regole (devono coincidere con il backend, app/bookings.py)
const MIN_DAYS_AHEAD = 3; // il lunedì si prenota da giovedì in poi
const AUTO_APPROVE_DAYS = 30; // oltre: serve approvazione

const inputClass =
  "w-full px-3 py-1.5 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500 transition";

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

// Date in formato YYYY-MM-DD calcolate in ora locale (niente slittamenti UTC)
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonday(d: Date): Date {
  const res = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = res.getDay(); // 0 = domenica
  // Sabato e domenica mostrano già la settimana successiva
  const diff = dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow;
  res.setDate(res.getDate() + diff);
  return res;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("it-IT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);

interface SubmitOutcome {
  date: string;
  ok: boolean;
  status?: string;
  text: string;
}

export default function PrenotazioniPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | "">("");
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(addDays(new Date(), MIN_DAYS_AHEAD)));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [lessons, setLessons] = useState<LessonSchedule>({});
  const [scheduleName, setScheduleName] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // chiavi "YYYY-MM-DD|slot"
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [outcomes, setOutcomes] = useState<SubmitOutcome[]>([]);

  // Orario libero (solo locali che lo permettono, es. sala riunioni / Auditorium)
  const [mode, setMode] = useState<"ore" | "libero">("ore");
  const [freeDate, setFreeDate] = useState("");
  const [freeStart, setFreeStart] = useState("15:00");
  const [freeEnd, setFreeEnd] = useState("17:00");
  const [extras, setExtras] = useState<Record<string, boolean>>({});

  const todayIso = toIso(new Date());
  const minBookIso = toIso(addDays(new Date(), MIN_DAYS_AHEAD));
  const autoApproveLimitIso = toIso(addDays(new Date(), AUTO_APPROVE_DAYS));

  const weekDays = useMemo(
    () =>
      DAY_NAMES.map((name, i) => {
        const d = addDays(weekStart, i);
        return { name, dow: i + 1, iso: toIso(d), label: d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) };
      }),
    [weekStart]
  );

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Utente, locali prenotabili e orario delle lezioni
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      const headers = { Authorization: `Bearer ${token}` };
      fetch(`${getApiBase()}/auth/me`, { headers })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setUser(data))
        .finally(() => setAuthChecked(true));
      fetch(`${getApiBase()}/orario`, { headers })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          setLessons(data.rooms || {});
          setScheduleName(data.name);
        })
        .catch(() => {});
    } else {
      setAuthChecked(true);
    }

    fetch(`${getApiBase()}/rooms`, { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Room[]) => {
        // Si possono prenotare solo i locali attivi e segnati come "prenotabili"
        const active = data.filter((r) => r.is_active && r.is_bookable);
        setRooms(active);
        if (active.length > 0) setSelectedRoomId(active[0].id);
      })
      .catch(() => setRooms([]));
  }, []);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);

  const fetchWeekBookings = useCallback(async () => {
    if (!user || selectedRoomId === "") return;
    setLoadingGrid(true);
    try {
      const params = new URLSearchParams({
        room_id: String(selectedRoomId),
        date_from: toIso(weekStart),
        date_to: toIso(addDays(weekStart, 4)),
      });
      const res = await fetch(`${getApiBase()}/bookings?${params}`, { headers: authHeaders() });
      setBookings(res.ok ? await res.json() : []);
    } finally {
      setLoadingGrid(false);
    }
  }, [user, selectedRoomId, weekStart]);

  const fetchMyBookings = useCallback(async () => {
    if (!user) return;
    const res = await fetch(`${getApiBase()}/bookings/mine`, { headers: authHeaders() });
    setMyBookings(res.ok ? await res.json() : []);
  }, [user]);

  useEffect(() => {
    fetchWeekBookings();
  }, [fetchWeekBookings]);

  useEffect(() => {
    fetchMyBookings();
  }, [fetchMyBookings]);

  // Cambiando locale o settimana si azzera la selezione; i locali senza orario libero usano solo le ore
  useEffect(() => {
    setSelected(new Set());
  }, [selectedRoomId, weekStart]);
  useEffect(() => {
    if (selectedRoom && !selectedRoom.free_schedule) setMode("ore");
  }, [selectedRoom]);

  /** Prenotazione che occupa un'ora: per ora scolastica o per orario libero sovrapposto */
  const bookingAt = useCallback(
    (iso: string, slot: number): Booking | undefined => {
      const s = SLOTS[slot - 1];
      return bookings.find(
        (b) =>
          b.date === iso &&
          (b.slot === slot || (!b.slot && b.start_time && b.end_time && overlaps(s.start, s.end, b.start_time, b.end_time)))
      );
    },
    [bookings]
  );

  const hasLesson = (dow: number, slot: number) =>
    !!selectedRoom && !!lessons[selectedRoom.code]?.[String(dow)]?.[String(slot)];

  const toggleCell = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const cancelGroup = async (group: Booking[]) => {
    const what = `${group[0].room_code}, ${describeBooking(group)}`;
    if (!confirm(`Annullare la prenotazione ${group[0].code} (${what})?`)) return;
    try {
      for (const b of group) {
        const res = await fetch(`${getApiBase()}/bookings/${b.id}`, { method: "DELETE", headers: authHeaders() });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || "Errore durante l'annullamento.");
        }
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      fetchWeekBookings();
      fetchMyBookings();
    }
  };

  const sendRequest = async (date: string, body: Record<string, unknown>): Promise<SubmitOutcome> => {
    const res = await fetch(`${getApiBase()}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ room_id: Number(selectedRoomId), date, purpose, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { date, ok: false, text: data.detail || "errore" };
    return data.status === "IN_ATTESA"
      ? { date, ok: true, status: "IN_ATTESA", text: `In attesa di approvazione: ${(data.reasons || []).join("; ")}` }
      : { date, ok: true, status: "APPROVATA", text: "Confermata" };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRoomId === "") return;
    setSubmitting(true);
    const results: SubmitOutcome[] = [];

    if (mode === "ore") {
      // Una richiesta per ogni giorno selezionato
      const byDate = new Map<string, number[]>();
      selected.forEach((key) => {
        const [date, slot] = key.split("|");
        byDate.set(date, [...(byDate.get(date) || []), Number(slot)]);
      });
      for (const [date, slots] of byDate) results.push(await sendRequest(date, { slots }));
      setSelected(new Set());
    } else {
      results.push(await sendRequest(freeDate, { slots: [], start_time: freeStart, end_time: freeEnd, extras }));
      if (results[0].ok) setExtras({});
    }

    setSubmitting(false);
    setOutcomes(results);
    if (results.every((r) => r.ok)) setPurpose("");
    fetchWeekBookings();
    fetchMyBookings();
  };

  const shiftWeek = (weeks: number) => setWeekStart(addDays(weekStart, weeks * 7));

  // Eventi a orario libero della settimana mostrata
  const freeEvents = useMemo(() => groupBookings(bookings.filter((b) => !b.slot)), [bookings]);
  const myGroups = useMemo(() => groupBookings(myBookings), [myBookings]);

  const canSubmit =
    !submitting &&
    !!purpose.trim() &&
    (mode === "ore" ? selected.size > 0 : !!freeDate && !!freeStart && !!freeEnd && freeStart < freeEnd);

  const btn =
    "px-3 py-1.5 text-xs border border-[var(--border-color)] bg-[var(--bg-main)] hover:bg-[var(--bg-subtle)] text-[var(--text-main)] rounded-lg transition";

  return (
    <div className="space-y-6 w-full">
      {/* Intestazione e regole */}
      <div className="border-b border-[var(--border-color)] pb-4 space-y-2">
        <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">Prenotazione Aule</h1>
        <p className="text-xs text-[var(--text-muted)]">
          Scegli un locale, seleziona le ore libere nella griglia settimanale e conferma. Oggi puoi prenotare da{" "}
          <span className="text-[var(--text-main)] font-medium">{formatDate(minBookIso)}</span> in poi.
        </p>
        <ul className="text-[11px] text-[var(--text-muted)] list-disc pl-4 space-y-0.5">
          <li>Le prenotazioni entro 30 giorni vengono confermate subito.</li>
          <li>
            Restano <span className="text-amber-600 dark:text-amber-400 font-medium">in attesa</span> di approvazione del
            responsabile del locale o dell&apos;Ufficio Tecnico: le date oltre i 30 giorni, chi supera 10 giorni nello stesso
            locale in un mese e gli eventi fuori dalla fascia 08:00-17:30.
          </li>
          <li>Le ore in cui il locale ha lezione non si possono prenotare{scheduleName ? ` (${scheduleName})` : ""}.</li>
        </ul>
      </div>

      {authChecked && !user ? (
        <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
          Effettua l&apos;accesso con Google (in alto a destra) per prenotare le aule.
        </div>
      ) : !authChecked ? (
        <p className="text-xs text-[var(--text-muted)] font-mono animate-pulse">Caricamento...</p>
      ) : (
        <>
          {/* Locale e settimana */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)]">
            <div>
              <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Locale</label>
              <select
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value === "" ? "" : Number(e.target.value))}
                className={inputClass}
              >
                {rooms.length === 0 && <option value="">Nessun locale prenotabile</option>}
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} — {roomTypeLabel(r.room_type)}
                    {r.responsible ? ` (${r.responsible})` : ""}
                  </option>
                ))}
              </select>
              {selectedRoom && (
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  {plessoLabel(selectedRoom.plesso)}
                  {selectedRoom.free_schedule ? " • anche a orario libero" : ""}
                  {splitEquipment(selectedRoom.equipment).length > 0 &&
                    ` • ${splitEquipment(selectedRoom.equipment).join(", ")}`}
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Settimana</label>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => shiftWeek(-1)} className={btn}>
                  ←
                </button>
                <button onClick={() => setWeekStart(getMonday(addDays(new Date(), MIN_DAYS_AHEAD)))} className={btn}>
                  Prima settimana utile
                </button>
                <button onClick={() => shiftWeek(1)} className={btn}>
                  →
                </button>
                <span className="text-xs text-[var(--text-main)] font-medium ml-1">
                  {formatDate(weekDays[0].iso)} – {formatDate(weekDays[4].iso)}
                </span>
              </div>
            </div>
          </div>

          {/* Modalità: ore scolastiche oppure orario libero */}
          {selectedRoom?.free_schedule && (
            <div className="flex items-center gap-2">
              {(["ore", "libero"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                    mode === m
                      ? "bg-blue-600/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-subtle)]"
                  }`}
                >
                  {m === "ore" ? "Ore scolastiche" : "Orario libero / evento"}
                </button>
              ))}
            </div>
          )}

          {/* Legenda */}
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-[var(--text-muted)]">
            {[
              ["border border-[var(--border-color)] bg-[var(--bg-main)]", "Libera"],
              ["bg-emerald-500/30 border border-emerald-500/50", "Selezionata"],
              ["bg-blue-500/20 border border-blue-500/40", "Prenotata da te"],
              ["bg-rose-500/15 border border-rose-500/30", "Occupata"],
              ["bg-amber-500/15 border border-amber-500/40", "In attesa di approvazione"],
              ["bg-[var(--bg-subtle)] border border-[var(--border-color)]", "Lezione"],
            ].map(([cls, label]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded ${cls}`}></span> {label}
              </span>
            ))}
          </div>

          {/* Griglia settimanale */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-[var(--text-main)] min-w-[720px]">
              <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <tr>
                  <th className="p-3 text-left w-32 font-medium">Ora</th>
                  {weekDays.map((d) => (
                    <th key={d.iso} className={`p-3 text-center font-medium ${d.iso === todayIso ? "text-blue-600 dark:text-blue-400" : ""}`}>
                      {d.name}
                      <span className="block text-[10px] font-mono">{d.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {SLOTS.map((s) => (
                  <tr key={s.slot}>
                    <td className="p-3">
                      <div className="font-semibold">{s.label}</div>
                      <div className="text-[10px] font-mono text-[var(--text-muted)]">
                        {s.start} - {s.end}
                      </div>
                    </td>
                    {weekDays.map((d) => {
                      const key = `${d.iso}|${s.slot}`;
                      const booking = bookingAt(d.iso, s.slot);
                      const isPast = d.iso < todayIso;
                      const tooSoon = d.iso < minBookIso; // entro i 2 giorni di preavviso
                      const isSelected = selected.has(key);

                      if (booking) {
                        const isMine = booking.user_id === user?.id;
                        const pending = booking.status === "IN_ATTESA";
                        const group = bookings.filter((b) => b.code === booking.code);
                        const canCancel = !isPast && (isMine || isSupervisor(user?.role));
                        return (
                          <td key={key} className="p-1.5">
                            <button
                              type="button"
                              disabled={!canCancel}
                              onClick={() => cancelGroup(group)}
                              title={`${booking.user_name} — ${booking.purpose}${pending ? " (in attesa di approvazione)" : ""}${canCancel ? "\n(clicca per annullare)" : ""}`}
                              className={`w-full h-14 rounded-lg border px-2 text-left overflow-hidden transition ${
                                pending
                                  ? "bg-amber-500/15 border-amber-500/40"
                                  : isMine
                                  ? "bg-blue-500/15 border-blue-500/40 hover:bg-blue-500/25"
                                  : "bg-rose-500/10 border-rose-500/30"
                              } ${canCancel ? "cursor-pointer" : "cursor-default"} ${isPast ? "opacity-50" : ""}`}
                            >
                              <span className="block text-[11px] font-semibold truncate">
                                {isMine ? "Tua prenotazione" : booking.user_name}
                              </span>
                              <span className="block text-[10px] text-[var(--text-muted)] truncate">
                                {pending ? "In attesa • " : ""}
                                {booking.slot ? booking.purpose : `${booking.start_time}-${booking.end_time} ${booking.purpose}`}
                              </span>
                            </button>
                          </td>
                        );
                      }

                      if (hasLesson(d.dow, s.slot)) {
                        return (
                          <td key={key} className="p-1.5">
                            <div
                              title="Ora di lezione: non prenotabile"
                              className="w-full h-14 rounded-lg border border-[var(--border-color)] bg-[var(--bg-subtle)] flex items-center justify-center text-[11px] text-[var(--text-muted)]"
                            >
                              Lezione
                            </div>
                          </td>
                        );
                      }

                      const disabled = tooSoon || loadingGrid || mode === "libero";
                      return (
                        <td key={key} className="p-1.5">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => toggleCell(key)}
                            title={
                              tooSoon && !isPast
                                ? "Le aule si prenotano con almeno 2 giorni di anticipo"
                                : d.iso > autoApproveLimitIso
                                ? "Oltre 30 giorni: la prenotazione dovrà essere approvata"
                                : undefined
                            }
                            className={`w-full h-14 rounded-lg border text-[11px] transition ${
                              tooSoon
                                ? "bg-[var(--bg-subtle)] border-transparent opacity-40 cursor-not-allowed"
                                : isSelected
                                ? "bg-emerald-500/25 border-emerald-500/60 text-emerald-700 dark:text-emerald-300 font-semibold"
                                : mode === "libero"
                                ? "bg-[var(--bg-main)] border-[var(--border-color)] text-[var(--text-muted)] cursor-default"
                                : "bg-[var(--bg-main)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-emerald-500/60 hover:text-[var(--text-main)]"
                            }`}
                          >
                            {isPast ? "" : tooSoon ? "Non prenotabile" : isSelected ? "✓ Selezionata" : "Libera"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Eventi a orario libero della settimana */}
          {freeEvents.length > 0 && (
            <div className="bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)] space-y-2">
              <h2 className="text-xs font-semibold text-[var(--text-main)]">Eventi a orario libero in questa settimana</h2>
              <ul className="space-y-1 text-[11px] text-[var(--text-main)]">
                {freeEvents.map((g) => (
                  <li key={g[0].code}>
                    {describeBooking(g)} — {g[0].purpose}{" "}
                    <span className="text-[var(--text-muted)]">({g[0].user_name})</span>
                    {g[0].status === "IN_ATTESA" && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">in attesa</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Conferma */}
          <form onSubmit={handleSubmit} className="bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)] space-y-3">
            {mode === "libero" && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Data (lun-ven)</label>
                    <input type="date" required min={minBookIso} value={freeDate} onChange={(e) => setFreeDate(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Dalle</label>
                    <input type="time" required value={freeStart} onChange={(e) => setFreeStart(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Alle</label>
                    <input type="time" required value={freeEnd} onChange={(e) => setFreeEnd(e.target.value)} className={inputClass} />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-mono text-[var(--text-muted)] mb-1.5">Richieste extra per l&apos;evento</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {BOOKING_EXTRAS.map((x) => (
                      <label key={x.id} className="flex items-center gap-2 text-xs text-[var(--text-main)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!extras[x.id]}
                          onChange={(e) => setExtras((prev) => ({ ...prev, [x.id]: e.target.checked }))}
                        />
                        {x.label}
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Fuori dalla fascia 08:00-17:30 la richiesta resta in attesa di approvazione dell&apos;Ufficio Tecnico (servono
                  apertura e pulizie).
                </p>
              </div>
            )}

            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">
                  {mode === "ore"
                    ? `Motivo della prenotazione (${selected.size} ${selected.size === 1 ? "ora selezionata" : "ore selezionate"})`
                    : "Titolo / motivo dell'evento"}
                </label>
                <input
                  type="text"
                  required
                  placeholder="es. Verifica di informatica 4B, Riunione di dipartimento..."
                  maxLength={500}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className={inputClass}
                />
              </div>
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Invio in corso..." : "Invia prenotazione"}
              </button>
            </div>

            {/* Esito dell'ultima richiesta */}
            {outcomes.length > 0 && (
              <ul className="space-y-1 pt-1">
                {outcomes.map((o, i) => (
                  <li
                    key={i}
                    className={`text-[11px] px-3 py-2 rounded-lg border ${
                      !o.ok
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"
                        : o.status === "IN_ATTESA"
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    <span className="font-semibold">{o.date ? formatDate(o.date) : ""}:</span> {o.text}
                  </li>
                ))}
              </ul>
            )}
          </form>

          {/* Le mie prenotazioni */}
          <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border-color)] space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-main)] border-b border-[var(--border-color)] pb-3">
              Le mie prossime prenotazioni
            </h2>
            {myGroups.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-2 text-center">Non hai prenotazioni in programma.</p>
            ) : (
              <div className="space-y-2">
                {myGroups.map((group) => {
                  const first = group[0];
                  const st = bookingStatusInfo(first.status);
                  const extra = extrasLabels(first.extras);
                  return (
                    <div
                      key={first.code}
                      className="flex items-start justify-between gap-3 p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] text-xs"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 font-semibold">{first.code}</span>
                          <span className="font-medium text-[var(--text-main)]">{first.room_code}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${st.badge}`}>{st.label}</span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {describeBooking(group)} • {first.purpose}
                        </p>
                        {extra.length > 0 && <p className="text-[11px] text-[var(--text-muted)]">Extra: {extra.join(", ")}</p>}
                        {first.status === "IN_ATTESA" && first.status_reason && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400">{first.status_reason}</p>
                        )}
                        {first.status === "RIFIUTATA" && (
                          <p className="text-[11px] text-rose-600 dark:text-rose-400">
                            Rifiutata{first.decided_by_name ? ` da ${first.decided_by_name}` : ""}: {first.reject_reason}
                          </p>
                        )}
                      </div>
                      {first.status !== "RIFIUTATA" && (
                        <button
                          onClick={() => cancelGroup(group)}
                          className="px-2.5 py-1 text-[11px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded-md transition whitespace-nowrap"
                        >
                          Annulla
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
