"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PLESSI,
  Resource,
  ResourceBooking,
  Room,
  SLOTS,
  UserRole,
  getApiBase,
  isStaff,
  isSupervisor,
  plessoLabel,
} from "../lib/constants";

interface User {
  id: number;
  role: UserRole;
}

const DAY_NAMES = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì"];
const MIN_DAYS_AHEAD = 3; // come per le aule: il lunedì si prenota da giovedì in poi

const inputClass =
  "w-full px-3 py-1.5 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500 transition";
const btn =
  "px-3 py-1.5 text-xs border border-[var(--border-color)] bg-[var(--bg-main)] hover:bg-[var(--bg-subtle)] text-[var(--text-main)] rounded-lg transition";

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonday(d: Date): Date {
  const res = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = res.getDay();
  res.setDate(res.getDate() + (dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow));
  return res;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Raggruppa per codice (una richiesta = più ore dello stesso giorno) */
function groupByCode(rows: ResourceBooking[]): ResourceBooking[][] {
  const m = new Map<string, ResourceBooking[]>();
  rows.forEach((b) => m.set(b.code, [...(m.get(b.code) || []), b]));
  return Array.from(m.values());
}

function describeGroup(g: ResourceBooking[]): string {
  const first = g[0];
  const ore = g.map((b) => `${b.slot}ª`).join(", ");
  const pc = first.whole_cart ? `tutto il carrello (${first.quantity} PC)` : `${first.quantity} PC`;
  return `${formatDate(first.date)} • ore ${ore} • ${pc}${first.room_code ? ` • in ${first.room_code}` : ""}`;
}

const EMPTY_FORM = { name: "", quantity: 25, plesso: "SEDE_PRINCIPALE", location: "", description: "", is_active: true };

export default function CarrelliPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [resources, setResources] = useState<Resource[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [resourceId, setResourceId] = useState<number | "">("");
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(addDays(new Date(), MIN_DAYS_AHEAD)));
  const [bookings, setBookings] = useState<ResourceBooking[]>([]);
  const [myBookings, setMyBookings] = useState<ResourceBooking[]>([]);
  const [allUpcoming, setAllUpcoming] = useState<ResourceBooking[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // "YYYY-MM-DD|slot"
  const [quantity, setQuantity] = useState(1);
  const [wholeCart, setWholeCart] = useState(false);
  const [destRoomId, setDestRoomId] = useState<number | "">("");
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcomes, setOutcomes] = useState<{ date: string; ok: boolean; text: string }[]>([]);

  // Gestione carrelli (Supervisore)
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const supervisor = isSupervisor(user?.role);
  const staff = isStaff(user?.role);
  const todayIso = toIso(new Date());
  const minBookIso = toIso(addDays(new Date(), MIN_DAYS_AHEAD));

  const headers = (json = false): Record<string, string> => {
    const token = localStorage.getItem("token");
    const h: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    if (json) h["Content-Type"] = "application/json";
    return h;
  };

  const weekDays = useMemo(
    () =>
      DAY_NAMES.map((name, i) => {
        const d = addDays(weekStart, i);
        return { name, iso: toIso(d), label: d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) };
      }),
    [weekStart]
  );

  const loadResources = useCallback(async () => {
    const res = await fetch(`${getApiBase()}/resources`, { headers: headers() });
    if (!res.ok) return;
    const data: Resource[] = await res.json();
    setResources(data);
    setResourceId((cur) => (cur !== "" && data.some((r) => r.id === cur) ? cur : data.find((r) => r.is_active)?.id ?? ""));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setAuthChecked(true);
      return;
    }
    fetch(`${getApiBase()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .finally(() => setAuthChecked(true));
    loadResources();
    fetch(`${getApiBase()}/rooms`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Room[]) => setRooms(data.filter((r) => r.is_active && (r.room_type === "AULA" || r.room_type === "AULA_PRIORITA" || r.room_type === "LAB" || r.room_type === "NON_ASSEGNABILE"))))
      .catch(() => {});
  }, [loadResources]);

  const resource = resources.find((r) => r.id === resourceId);

  const loadWeek = useCallback(async () => {
    if (!user || resourceId === "") return;
    const params = new URLSearchParams({
      resource_id: String(resourceId),
      date_from: toIso(weekStart),
      date_to: toIso(addDays(weekStart, 4)),
    });
    const res = await fetch(`${getApiBase()}/resource-bookings?${params}`, { headers: headers() });
    setBookings(res.ok ? await res.json() : []);
  }, [user, resourceId, weekStart]);

  const loadMine = useCallback(async () => {
    if (!user) return;
    const res = await fetch(`${getApiBase()}/resource-bookings/mine`, { headers: headers() });
    setMyBookings(res.ok ? await res.json() : []);
    if (isStaff(user.role)) {
      const r2 = await fetch(`${getApiBase()}/resource-bookings/prossime`, { headers: headers() });
      setAllUpcoming(r2.ok ? await r2.json() : []);
    }
  }, [user]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);
  useEffect(() => {
    loadMine();
  }, [loadMine]);
  useEffect(() => {
    setSelected(new Set());
    setWholeCart(false);
  }, [resourceId, weekStart]);

  // PC prenotati per cella
  const usedAt = useCallback(
    (iso: string, slot: number) => bookings.filter((b) => b.date === iso && b.slot === slot),
    [bookings]
  );

  const freeAt = (iso: string, slot: number) =>
    (resource?.quantity ?? 0) - usedAt(iso, slot).reduce((sum, b) => sum + b.quantity, 0);

  // Disponibilità sulle celle selezionate: si può chiedere al massimo il minimo dei PC liberi
  const selectedCells = Array.from(selected).map((k) => k.split("|"));
  const minFree = selectedCells.length ? Math.min(...selectedCells.map(([d, s]) => freeAt(d, Number(s)))) : 0;
  const wholeCartPossible = !!resource && selectedCells.length > 0 && minFree === resource.quantity;

  useEffect(() => {
    if (!wholeCartPossible) setWholeCart(false);
    if (minFree > 0 && quantity > minFree) setQuantity(minFree);
  }, [wholeCartPossible, minFree, quantity]);

  const toggleCell = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resourceId === "" || selected.size === 0) return;
    setSubmitting(true);
    const byDate = new Map<string, number[]>();
    selected.forEach((k) => {
      const [d, s] = k.split("|");
      byDate.set(d, [...(byDate.get(d) || []), Number(s)]);
    });
    const results: { date: string; ok: boolean; text: string }[] = [];
    for (const [date, slots] of byDate) {
      const res = await fetch(`${getApiBase()}/resource-bookings`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({
          resource_id: resourceId,
          date,
          slots,
          quantity: wholeCart ? null : quantity,
          whole_cart: wholeCart,
          room_id: destRoomId === "" ? null : destRoomId,
          purpose,
        }),
      });
      const data = await res.json().catch(() => ({}));
      results.push(
        res.ok
          ? { date, ok: true, text: `Confermata: ${wholeCart ? "tutto il carrello" : `${quantity} PC`}, ore ${slots.sort().map((s) => `${s}ª`).join(", ")}` }
          : { date, ok: false, text: data.detail || "errore" }
      );
    }
    setSubmitting(false);
    setOutcomes(results);
    setSelected(new Set());
    if (results.every((r) => r.ok)) setPurpose("");
    loadWeek();
    loadMine();
  };

  const cancel = async (g: ResourceBooking[]) => {
    if (!confirm(`Annullare la prenotazione ${g[0].code} (${g[0].resource_name}, ${describeGroup(g)})?`)) return;
    const res = await fetch(`${getApiBase()}/resource-bookings/${g[0].code}`, { method: "DELETE", headers: headers() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.detail || "Errore durante l'annullamento.");
    }
    loadWeek();
    loadMine();
  };

  // --- gestione carrelli
  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };
  const openEdit = (r: Resource) => {
    setEditingId(r.id);
    setForm({
      name: r.name,
      quantity: r.quantity,
      plesso: r.plesso,
      location: r.location || "",
      description: r.description || "",
      is_active: r.is_active,
    });
    setShowForm(true);
  };
  const saveResource = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(editingId === null ? `${getApiBase()}/resources` : `${getApiBase()}/resources/${editingId}`, {
      method: editingId === null ? "POST" : "PUT",
      headers: headers(true),
      body: JSON.stringify({
        ...form,
        quantity: Number(form.quantity),
        location: form.location.trim() || null,
        description: form.description.trim() || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return alert(data.detail || "Errore nel salvataggio del carrello.");
    }
    setShowForm(false);
    loadResources();
  };
  const deleteResource = async (r: Resource) => {
    if (!confirm(`Eliminare ${r.name}? Verranno eliminate anche tutte le sue prenotazioni.`)) return;
    const res = await fetch(`${getApiBase()}/resources/${r.id}`, { method: "DELETE", headers: headers() });
    if (!res.ok) alert("Errore nell'eliminazione del carrello.");
    loadResources();
  };

  const myGroups = useMemo(() => groupByCode(myBookings), [myBookings]);
  const allGroups = useMemo(() => groupByCode(allUpcoming), [allUpcoming]);
  const activeResources = resources.filter((r) => r.is_active);

  if (authChecked && !user) {
    return (
      <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
        Effettua l&apos;accesso con Google (in alto a destra) per prenotare i carrelli.
      </div>
    );
  }
  if (!authChecked) return <p className="text-xs text-[var(--text-muted)] font-mono animate-pulse">Caricamento...</p>;

  return (
    <div className="space-y-6 w-full">
      <div className="border-b border-[var(--border-color)] pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">Prenotazione Carrelli PC</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Prenota alcuni PC portatili o un carrello intero per le ore che ti servono. Oggi puoi prenotare da{" "}
            <span className="text-[var(--text-main)] font-medium">{formatDate(minBookIso)}</span> in poi.
          </p>
        </div>
        {supervisor && (
          <button onClick={openNew} className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow-sm self-start">
            + Nuovo carrello
          </button>
        )}
      </div>

      {/* Elenco carrelli (gestione per il Supervisore) */}
      {supervisor && resources.length > 0 && (
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-left text-[var(--text-main)]">
            <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] border-b border-[var(--border-color)]">
              <tr>
                <th className="p-3 font-medium">Carrello</th>
                <th className="p-3 font-medium">PC</th>
                <th className="p-3 font-medium">Plesso</th>
                <th className="p-3 font-medium">Dove si trova</th>
                <th className="p-3 font-medium">Stato</th>
                <th className="p-3 font-medium text-right">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-color)]">
              {resources.map((r) => (
                <tr key={r.id} className={r.is_active ? "" : "opacity-60"}>
                  <td className="p-3">
                    <span className="font-semibold">{r.name}</span>
                    {r.description && <span className="block text-[10px] text-[var(--text-muted)]">{r.description}</span>}
                  </td>
                  <td className="p-3 tabular-nums">{r.quantity}</td>
                  <td className="p-3">{plessoLabel(r.plesso)}</td>
                  <td className="p-3">{r.location || "—"}</td>
                  <td className="p-3">{r.is_active ? "Disponibile" : "Non disponibile"}</td>
                  <td className="p-3 text-right whitespace-nowrap space-x-1.5">
                    <button onClick={() => openEdit(r)} className="px-2 py-1 text-[11px] bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 rounded transition">
                      Modifica
                    </button>
                    <button onClick={() => deleteResource(r)} className="px-2 py-1 text-[11px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded transition">
                      Elimina
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeResources.length === 0 ? (
        <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
          {supervisor ? "Nessun carrello: aggiungine uno con \"+ Nuovo carrello\"." : "Non ci sono carrelli prenotabili al momento."}
        </div>
      ) : (
        <>
          {/* Carrello e settimana */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)]">
            <div>
              <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Carrello</label>
              <select value={resourceId} onChange={(e) => setResourceId(e.target.value === "" ? "" : Number(e.target.value))} className={inputClass}>
                {activeResources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} — {r.quantity} PC
                  </option>
                ))}
              </select>
              {resource && (
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  {plessoLabel(resource.plesso)}
                  {resource.location ? ` • si trova: ${resource.location}` : ""}
                  {resource.description ? ` • ${resource.description}` : ""}
                </p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Settimana</label>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setWeekStart(addDays(weekStart, -7))} className={btn}>←</button>
                <button onClick={() => setWeekStart(getMonday(addDays(new Date(), MIN_DAYS_AHEAD)))} className={btn}>Prima settimana utile</button>
                <button onClick={() => setWeekStart(addDays(weekStart, 7))} className={btn}>→</button>
                <span className="text-xs text-[var(--text-main)] font-medium ml-1">
                  {formatDate(weekDays[0].iso)} – {formatDate(weekDays[4].iso)}
                </span>
              </div>
            </div>
          </div>

          {/* Legenda */}
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-[var(--text-muted)]">
            {[
              ["border border-[var(--border-color)] bg-[var(--bg-main)]", "Tutti i PC liberi"],
              ["bg-amber-500/15 border border-amber-500/40", "Liberi in parte"],
              ["bg-rose-500/15 border border-rose-500/30", "Esaurito"],
              ["bg-emerald-500/30 border border-emerald-500/50", "Selezionata"],
            ].map(([cls, label]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded ${cls}`}></span> {label}
              </span>
            ))}
          </div>

          {/* Griglia: PC liberi per ora */}
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
                      <div className="text-[10px] font-mono text-[var(--text-muted)]">{s.start} - {s.end}</div>
                    </td>
                    {weekDays.map((d) => {
                      const key = `${d.iso}|${s.slot}`;
                      const used = usedAt(d.iso, s.slot);
                      const free = freeAt(d.iso, s.slot);
                      const total = resource?.quantity ?? 0;
                      const tooSoon = d.iso < minBookIso;
                      const isSelected = selected.has(key);
                      const mine = used.some((b) => b.user_id === user?.id);
                      const who = used.map((b) => `${b.user_name}: ${b.whole_cart ? "tutto il carrello" : `${b.quantity} PC`}${b.room_code ? ` (${b.room_code})` : ""}`).join("\n");
                      return (
                        <td key={key} className="p-1.5">
                          <button
                            type="button"
                            disabled={tooSoon || free <= 0}
                            onClick={() => toggleCell(key)}
                            title={tooSoon ? "I carrelli si prenotano con almeno 2 giorni di anticipo" : who || "Nessuna prenotazione"}
                            className={`w-full h-14 rounded-lg border text-[11px] transition ${
                              tooSoon
                                ? "bg-[var(--bg-subtle)] border-transparent opacity-40 cursor-not-allowed"
                                : isSelected
                                ? "bg-emerald-500/25 border-emerald-500/60 text-emerald-700 dark:text-emerald-300 font-semibold"
                                : free <= 0
                                ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 cursor-not-allowed"
                                : free < total
                                ? "bg-amber-500/10 border-amber-500/40 text-[var(--text-main)] hover:border-emerald-500/60"
                                : "bg-[var(--bg-main)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-emerald-500/60 hover:text-[var(--text-main)]"
                            }`}
                          >
                            {tooSoon ? (
                              d.iso < todayIso ? "" : "Non prenotabile"
                            ) : (
                              <>
                                <span className="block font-semibold tabular-nums">{free <= 0 ? "Esaurito" : `${free}/${total} liberi`}</span>
                                {mine && <span className="block text-[10px] text-blue-600 dark:text-blue-400">anche tua</span>}
                              </>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Richiesta */}
          <form onSubmit={submit} className="bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)] space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">
                  Numero di PC {selected.size > 0 && `(max ${minFree})`}
                </label>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, minFree)}
                  disabled={wholeCart || selected.size === 0}
                  value={wholeCart ? resource?.quantity ?? 0 : quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                  className={`${inputClass} disabled:opacity-50`}
                />
              </div>
              <label className={`flex items-center gap-2 text-xs pb-1.5 ${wholeCartPossible ? "text-[var(--text-main)] cursor-pointer" : "text-[var(--text-muted)] opacity-60"}`}>
                <input type="checkbox" disabled={!wholeCartPossible} checked={wholeCart} onChange={(e) => setWholeCart(e.target.checked)} />
                Tutto il carrello{resource ? ` (${resource.quantity} PC)` : ""}
              </label>
              <div className="md:col-span-2">
                <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Aula dove serve (facoltativo)</label>
                <select value={destRoomId} onChange={(e) => setDestRoomId(e.target.value === "" ? "" : Number(e.target.value))} className={inputClass}>
                  <option value="">—</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {selected.size > 0 && !wholeCartPossible && (
              <p className="text-[11px] text-[var(--text-muted)]">Il carrello intero non è prenotabile: in almeno una delle ore scelte ci sono già PC prenotati.</p>
            )}
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">
                  Motivo ({selected.size} {selected.size === 1 ? "ora selezionata" : "ore selezionate"})
                </label>
                <input
                  type="text"
                  required
                  placeholder="es. Esercitazione di informatica 3A"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className={inputClass}
                />
              </div>
              <button
                type="submit"
                disabled={submitting || selected.size === 0 || !purpose.trim() || minFree <= 0}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Invio in corso..." : "Prenota"}
              </button>
            </div>
            {outcomes.length > 0 && (
              <ul className="space-y-1">
                {outcomes.map((o, i) => (
                  <li
                    key={i}
                    className={`text-[11px] px-3 py-2 rounded-lg border ${
                      o.ok
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"
                    }`}
                  >
                    <span className="font-semibold">{formatDate(o.date)}:</span> {o.text}
                  </li>
                ))}
              </ul>
            )}
          </form>
        </>
      )}

      {/* Le mie prenotazioni */}
      <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border-color)] space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-main)] border-b border-[var(--border-color)] pb-3">Le mie prenotazioni di carrelli</h2>
        {myGroups.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] py-2 text-center">Non hai prenotazioni di carrelli in programma.</p>
        ) : (
          myGroups.map((g) => (
            <div key={g[0].code} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] text-xs">
              <div className="min-w-0">
                <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 font-semibold mr-2">{g[0].code}</span>
                <span className="font-medium text-[var(--text-main)]">{g[0].resource_name}</span>
                <p className="text-[11px] text-[var(--text-muted)]">{describeGroup(g)} • {g[0].purpose}</p>
              </div>
              <button onClick={() => cancel(g)} className="px-2.5 py-1 text-[11px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded-md transition whitespace-nowrap">
                Annulla
              </button>
            </div>
          ))
        )}
      </div>

      {/* Ufficio Tecnico: tutte le prossime prenotazioni, per preparare e portare i carrelli */}
      {staff && (
        <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border-color)] space-y-3">
          <h2 className="text-sm font-semibold text-[var(--text-main)] border-b border-[var(--border-color)] pb-3">
            Tutte le prossime prenotazioni dei carrelli
          </h2>
          {allGroups.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] py-2 text-center">Nessuna prenotazione in programma.</p>
          ) : (
            allGroups.map((g) => (
              <div key={g[0].code} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] text-xs">
                <div className="min-w-0">
                  <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 font-semibold mr-2">{g[0].code}</span>
                  <span className="font-medium text-[var(--text-main)]">{g[0].resource_name}</span>
                  <span className="text-[var(--text-muted)]"> — {g[0].user_name}</span>
                  <p className="text-[11px] text-[var(--text-muted)]">{describeGroup(g)} • {g[0].purpose}</p>
                </div>
                <button onClick={() => cancel(g)} className="px-2.5 py-1 text-[11px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded-md transition whitespace-nowrap">
                  Annulla
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modale nuovo / modifica carrello */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] p-6 rounded-xl max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-base font-semibold text-[var(--text-main)]">{editingId === null ? "Nuovo carrello" : `Modifica ${form.name}`}</h3>
            <form onSubmit={saveResource} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-[var(--text-muted)] block mb-1">Nome</label>
                  <input type="text" required placeholder="es. Carrello 1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] block mb-1">Numero di PC</label>
                  <input type="number" required min={1} max={200} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">Plesso</label>
                <select value={form.plesso} onChange={(e) => setForm({ ...form, plesso: e.target.value })} className={inputClass}>
                  {PLESSI.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">Dove si trova</label>
                <input type="text" placeholder="es. Ufficio tecnico, piano terra" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">Descrizione</label>
                <input type="text" placeholder="es. PC Lenovo con Office e Arduino IDE" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text-main)] cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Disponibile per le prenotazioni
              </label>
              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-color)]">
                <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition">
                  Annulla
                </button>
                <button type="submit" className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded transition">
                  Salva
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
