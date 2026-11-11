"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase, Room, UserRole, isSupervisor, plessoLabel, roomTypeLabel, splitEquipment } from "../lib/constants";

interface User {
  id: number;
  role: UserRole;
}

interface Booking {
  id: number;
  code: string;
  room_id: number;
  room_code: string;
  user_id: number;
  user_name: string;
  user_email: string;
  date: string; // YYYY-MM-DD
  slot: number;
  purpose: string;
}

// Orario scolastico (stesse fasce del gestionale IIS Grassi)
const SLOTS = [
  { slot: 1, label: "1ª ora", time: "08:30 - 09:20" },
  { slot: 2, label: "2ª ora", time: "09:20 - 10:10" },
  { slot: 3, label: "3ª ora", time: "10:20 - 11:10" },
  { slot: 4, label: "4ª ora", time: "11:10 - 12:00" },
  { slot: 5, label: "5ª ora", time: "12:10 - 13:00" },
  { slot: 6, label: "6ª ora", time: "13:00 - 13:50" },
  { slot: 7, label: "7ª ora", time: "14:20 - 15:10" },
  { slot: 8, label: "8ª ora", time: "15:10 - 16:00" },
];

const DAY_NAMES = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì"];

// Preavviso minimo: si prenota a partire da 3 giorni dopo oggi
// (es. il lunedì si può prenotare da giovedì in poi). Deve coincidere con il backend.
const MIN_DAYS_AHEAD = 3;

function getMinBookingDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + MIN_DAYS_AHEAD);
  return d;
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

export default function PrenotazioniPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | "">("");
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(getMinBookingDate()));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // chiavi "YYYY-MM-DD|slot"
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingGrid, setLoadingGrid] = useState(false);

  const todayIso = toIso(new Date());
  const minBookIso = toIso(getMinBookingDate());

  const weekDays = useMemo(
    () =>
      DAY_NAMES.map((name, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return { name, iso: toIso(d), label: d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) };
      }),
    [weekStart]
  );

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Utente e aule
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      fetch(`${getApiBase()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setUser(data))
        .finally(() => setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }

    fetch(`${getApiBase()}/rooms`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Room[]) => {
        // Si possono prenotare solo i locali attivi e segnati come "prenotabili"
        const active = data.filter((r) => r.is_active && r.is_bookable);
        setRooms(active);
        if (active.length > 0) setSelectedRoomId(active[0].id);
      })
      .catch(() => setRooms([]));
  }, []);

  const fetchWeekBookings = useCallback(async () => {
    if (!user || selectedRoomId === "") return;
    setLoadingGrid(true);
    try {
      const params = new URLSearchParams({
        room_id: String(selectedRoomId),
        date_from: weekDays[0].iso,
        date_to: weekDays[4].iso,
      });
      const res = await fetch(`${getApiBase()}/bookings?${params}`, { headers: authHeaders() });
      setBookings(res.ok ? await res.json() : []);
    } finally {
      setLoadingGrid(false);
    }
  }, [user, selectedRoomId, weekDays]);

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

  // Cambiando aula o settimana si azzera la selezione
  useEffect(() => {
    setSelected(new Set());
  }, [selectedRoomId, weekStart]);

  const bookingMap = useMemo(() => {
    const m = new Map<string, Booking>();
    bookings.forEach((b) => m.set(`${b.date}|${b.slot}`, b));
    return m;
  }, [bookings]);

  const toggleCell = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const cancelBookingIds = async (ids: number[], message: string) => {
    if (!confirm(message)) return;
    try {
      for (const id of ids) {
        const res = await fetch(`${getApiBase()}/bookings/${id}`, { method: "DELETE", headers: authHeaders() });
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.size === 0 || selectedRoomId === "") return;

    // Una richiesta per ogni giorno selezionato
    const byDate = new Map<string, number[]>();
    selected.forEach((key) => {
      const [date, slot] = key.split("|");
      byDate.set(date, [...(byDate.get(date) || []), Number(slot)]);
    });

    setSubmitting(true);
    const errors: string[] = [];
    for (const [date, slots] of byDate) {
      const res = await fetch(`${getApiBase()}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ room_id: Number(selectedRoomId), date, slots, purpose }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        errors.push(`${formatDate(date)}: ${data.detail || "errore"}`);
      }
    }
    setSubmitting(false);

    if (errors.length > 0) alert("Alcune prenotazioni non sono andate a buon fine:\n\n" + errors.join("\n"));
    setSelected(new Set());
    setPurpose("");
    fetchWeekBookings();
    fetchMyBookings();
  };

  // Le mie prenotazioni raggruppate per richiesta (stesso codice)
  const myGroups = useMemo(() => {
    const groups = new Map<string, Booking[]>();
    myBookings.forEach((b) => groups.set(b.code, [...(groups.get(b.code) || []), b]));
    return Array.from(groups.values());
  }, [myBookings]);

  const shiftWeek = (weeks: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + weeks * 7);
    setWeekStart(d);
  };

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="border-b border-[var(--border-color)] pb-4">
        <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">Prenotazione Aule</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Scegli un'aula, seleziona le ore libere nella griglia settimanale e conferma la prenotazione.
          Le aule si prenotano con almeno 2 giorni di anticipo: oggi puoi prenotare da {formatDate(minBookIso)} in poi.
        </p>
      </div>

      {authChecked && !user ? (
        <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
          Effettua l'accesso con Google (in alto a destra) per prenotare le aule.
        </div>
      ) : !authChecked ? (
        <p className="text-xs text-[var(--text-muted)] font-mono animate-pulse">Caricamento...</p>
      ) : (
        <>
          {/* Selezione aula e settimana */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)]">
            <div>
              <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Aula</label>
              <select
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full px-3 py-1.5 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500 transition"
              >
                {rooms.length === 0 && <option value="">Nessun locale prenotabile</option>}
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} — {roomTypeLabel(r.room_type)}{r.responsible ? ` (${r.responsible})` : ""}
                  </option>
                ))}
              </select>
              {selectedRoom && (
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  {plessoLabel(selectedRoom.plesso)}
                  {selectedRoom.free_schedule ? " • orario libero" : ""}
                  {splitEquipment(selectedRoom.equipment).length > 0 && ` • ${splitEquipment(selectedRoom.equipment).join(", ")}`}
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Settimana</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => shiftWeek(-1)}
                  className="px-3 py-1.5 text-xs border border-[var(--border-color)] bg-[var(--bg-main)] hover:bg-[var(--bg-subtle)] text-[var(--text-main)] rounded-lg transition"
                >
                  ←
                </button>
                <button
                  onClick={() => setWeekStart(getMonday(new Date()))}
                  className="px-3 py-1.5 text-xs border border-[var(--border-color)] bg-[var(--bg-main)] hover:bg-[var(--bg-subtle)] text-[var(--text-main)] rounded-lg transition"
                >
                  Oggi
                </button>
                <button
                  onClick={() => shiftWeek(1)}
                  className="px-3 py-1.5 text-xs border border-[var(--border-color)] bg-[var(--bg-main)] hover:bg-[var(--bg-subtle)] text-[var(--text-main)] rounded-lg transition"
                >
                  →
                </button>
                <span className="text-xs text-[var(--text-main)] font-medium ml-2">
                  {formatDate(weekDays[0].iso)} – {formatDate(weekDays[4].iso)}
                </span>
              </div>
            </div>
          </div>

          {/* Legenda */}
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded border border-[var(--border-color)] bg-[var(--bg-main)]"></span> Libera
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/50"></span> Selezionata
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-blue-500/20 border border-blue-500/40"></span> Prenotata da te
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-rose-500/15 border border-rose-500/30"></span> Occupata
            </span>
          </div>

          {/* Griglia settimanale */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-[var(--text-main)] min-w-[720px]">
              <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <tr>
                  <th className="p-3 text-left w-32 font-medium">Ora</th>
                  {weekDays.map((d) => (
                    <th
                      key={d.iso}
                      className={`p-3 text-center font-medium ${d.iso === todayIso ? "text-blue-600 dark:text-blue-400" : ""}`}
                    >
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
                      <div className="text-[10px] font-mono text-[var(--text-muted)]">{s.time}</div>
                    </td>
                    {weekDays.map((d) => {
                      const key = `${d.iso}|${s.slot}`;
                      const booking = bookingMap.get(key);
                      const isPast = d.iso < todayIso;
                      const isSelected = selected.has(key);
                      const tooSoon = d.iso < minBookIso; // entro i 2 giorni di preavviso

                      if (booking) {
                        const isMine = booking.user_id === user?.id;
                        const canCancel = !isPast && (isMine || isSupervisor(user?.role));
                        return (
                          <td key={key} className="p-1.5">
                            <button
                              type="button"
                              disabled={!canCancel}
                              onClick={() =>
                                cancelBookingIds(
                                  [booking.id],
                                  `Annullare la prenotazione di ${booking.room_code} del ${formatDate(booking.date)}, ${s.label}?`
                                )
                              }
                              title={`${booking.user_name} — ${booking.purpose}${canCancel ? "\n(clicca per annullare)" : ""}`}
                              className={`w-full h-14 rounded-lg border px-2 text-left overflow-hidden transition ${
                                isMine
                                  ? "bg-blue-500/15 border-blue-500/40 hover:bg-blue-500/25"
                                  : "bg-rose-500/10 border-rose-500/30"
                              } ${canCancel ? "cursor-pointer" : "cursor-default"} ${isPast ? "opacity-50" : ""}`}
                            >
                              <span className="block text-[11px] font-semibold truncate">
                                {isMine ? "Tua prenotazione" : booking.user_name}
                              </span>
                              <span className="block text-[10px] text-[var(--text-muted)] truncate">{booking.purpose}</span>
                            </button>
                          </td>
                        );
                      }

                      return (
                        <td key={key} className="p-1.5">
                          <button
                            type="button"
                            disabled={tooSoon || loadingGrid}
                            title={tooSoon && !isPast ? "Le aule si prenotano con almeno 2 giorni di anticipo" : undefined}
                            onClick={() => toggleCell(key)}
                            className={`w-full h-14 rounded-lg border text-[11px] transition ${
                              tooSoon
                                ? "bg-[var(--bg-subtle)] border-transparent opacity-40 cursor-not-allowed"
                                : isSelected
                                ? "bg-emerald-500/25 border-emerald-500/60 text-emerald-700 dark:text-emerald-300 font-semibold"
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

          {/* Conferma prenotazione */}
          <form
            onSubmit={handleSubmit}
            className="bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)] flex flex-col md:flex-row md:items-end gap-3"
          >
            <div className="flex-1">
              <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">
                Motivo della prenotazione ({selected.size} {selected.size === 1 ? "ora selezionata" : "ore selezionate"})
              </label>
              <input
                type="text"
                required
                placeholder="es. Verifica di informatica 4B, Riunione di dipartimento..."
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || selected.size === 0}
              className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Prenotazione in corso..." : "Conferma Prenotazione"}
            </button>
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
                  const ore = group.map((b) => `${b.slot}ª`).join(", ");
                  return (
                    <div
                      key={first.code}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 font-semibold">{first.code}</span>
                          <span className="font-medium text-[var(--text-main)]">{first.room_code}</span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {formatDate(first.date)} • Ore: {ore} • {first.purpose}
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          cancelBookingIds(
                            group.map((b) => b.id),
                            `Annullare la prenotazione ${first.code} (${first.room_code}, ${formatDate(first.date)})?`
                          )
                        }
                        className="px-2.5 py-1 text-[11px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded-md transition whitespace-nowrap"
                      >
                        Annulla
                      </button>
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
