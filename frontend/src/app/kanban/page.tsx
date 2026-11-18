"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TicketDetailModal from "../components/TicketDetailModal";
import UserAvatar from "../components/UserAvatar";
import {
  PLESSI,
  PRIORITIES,
  STATUSES,
  Ticket,
  TicketStatus,
  UserRole,
  categoryLabel,
  getApiBase,
  isStaff,
  parseServerDate,
  plessoLabel,
  priorityInfo,
} from "../lib/constants";

interface User {
  id: number;
  role: UserRole;
}

const PRIORITY_ORDER: Record<string, number> = { URGENTE: 0, ALTA: 1, MEDIA: 2, BASSA: 3 };
const PRIORITY_BAR: Record<string, string> = {
  URGENTE: "bg-rose-500",
  ALTA: "bg-orange-500",
  MEDIA: "bg-blue-500",
  BASSA: "bg-slate-400",
};
const RESOLVED_DAYS = 14; // la colonna "Risolto" mostra di default solo gli ultimi 14 giorni

const inputClass =
  "w-full px-3 py-1.5 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500 transition";

function age(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - parseServerDate(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} g`;
}

export default function KanbanPage() {
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [openTicketId, setOpenTicketId] = useState<number | null>(null);

  // Filtri
  const [search, setSearch] = useState("");
  const [plesso, setPlesso] = useState("ALL");
  const [priority, setPriority] = useState("ALL");
  const [onlyMine, setOnlyMine] = useState(false);
  const [allResolved, setAllResolved] = useState(false);

  // Trascinamento
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [overColumn, setOverColumn] = useState<TicketStatus | null>(null);

  // Inoltro a FACTOTUM (richiede il codice pratica)
  const [factotumTicket, setFactotumTicket] = useState<Ticket | null>(null);
  const [factotumCode, setFactotumCode] = useState("");
  const [factotumNotes, setFactotumNotes] = useState("");

  const headers = (json = false): Record<string, string> => {
    const token = localStorage.getItem("token");
    const h: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    if (json) h["Content-Type"] = "application/json";
    return h;
  };

  const loadTickets = useCallback(async () => {
    const res = await fetch(`${getApiBase()}/tickets`, { headers: headers() });
    if (res.ok) setTickets(await res.json());
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setState("denied");
      return;
    }
    fetch(`${getApiBase()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        if (u && isStaff(u.role)) {
          setState("ok");
          loadTickets();
        } else setState("denied");
      })
      .catch(() => setState("denied"));
  }, [loadTickets]);

  // Aggiornamento automatico ogni 30 secondi (se nessuno sta trascinando)
  useEffect(() => {
    if (state !== "ok") return;
    const t = setInterval(() => {
      if (draggingId === null && openTicketId === null && !factotumTicket) loadTickets();
    }, 30_000);
    return () => clearInterval(t);
  }, [state, draggingId, openTicketId, factotumTicket, loadTickets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const resolvedLimit = Date.now() - RESOLVED_DAYS * 24 * 60 * 60 * 1000;
    return tickets.filter(
      (t) =>
        (!q ||
          t.title.toLowerCase().includes(q) ||
          t.code.toLowerCase().includes(q) ||
          (t.room_code || "").toLowerCase().includes(q)) &&
        (plesso === "ALL" || t.plesso === plesso) &&
        (priority === "ALL" || t.priority === priority) &&
        (!onlyMine || t.assignees.some((a) => a.id === user?.id)) &&
        (allResolved ||
          t.status !== "RISOLTO" ||
          parseServerDate(t.resolved_at || t.updated_at || t.created_at).getTime() >= resolvedLimit)
    );
  }, [tickets, search, plesso, priority, onlyMine, allResolved, user]);

  const columns = useMemo(
    () =>
      STATUSES.map((s) => ({
        ...s,
        tickets: filtered
          .filter((t) => t.status === s.id)
          .sort(
            (a, b) =>
              (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
              parseServerDate(a.created_at).getTime() - parseServerDate(b.created_at).getTime()
          ),
      })),
    [filtered]
  );

  const changeStatus = async (ticket: Ticket, status: TicketStatus, extra: Record<string, string> = {}) => {
    // Aggiornamento immediato a schermo, poi conferma dal server
    setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, status } : t)));
    try {
      const res = await fetch(`${getApiBase()}/tickets/${ticket.id}/status`, {
        method: "PATCH",
        headers: headers(true),
        body: JSON.stringify({ status, ...extra }),
      });
      if (!res.ok) throw new Error();
      const updated: Ticket = await res.json();
      setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch {
      alert("Non è stato possibile cambiare lo stato del ticket.");
      loadTickets();
    }
  };

  const handleDrop = (status: TicketStatus) => {
    const ticket = tickets.find((t) => t.id === draggingId);
    setDraggingId(null);
    setOverColumn(null);
    if (!ticket || ticket.status === status) return;
    if (status === "INOLTRATO_FACTOTUM") {
      setFactotumCode("");
      setFactotumNotes("");
      setFactotumTicket(ticket);
      return;
    }
    if (status === "APERTO" && ticket.assignees.length > 0) {
      if (!confirm(`Riaprire ${ticket.code}? Verranno tolti i tecnici assegnati e le date di presa in carico.`)) return;
    }
    changeStatus(ticket, status);
  };

  const openTicket = tickets.find((t) => t.id === openTicketId) || null;

  if (state === "loading") return <p className="text-xs text-[var(--text-muted)] font-mono animate-pulse">Caricamento...</p>;
  if (state === "denied")
    return (
      <div className="p-6 text-center bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-xl text-xs">
        La bacheca Kanban è riservata all&apos;Ufficio Tecnico (Supervisore e Manager).
      </div>
    );

  return (
    <div className="space-y-4 w-full">
      <div className="border-b border-[var(--border-color)] pb-4">
        <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">Bacheca Kanban</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Trascina un cartellino in un&apos;altra colonna per cambiarne lo stato. Cliccalo per assegnarlo ai tecnici, commentarlo o
          vederne i dettagli.
        </p>
      </div>

      {/* Filtri */}
      <div className="flex flex-wrap items-end gap-3 bg-[var(--bg-card)] p-3 rounded-xl border border-[var(--border-color)]">
        <div className="w-56">
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Cerca</label>
          <input type="text" placeholder="Codice, titolo, aula..." value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} />
        </div>
        <div className="w-40">
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Plesso</label>
          <select value={plesso} onChange={(e) => setPlesso(e.target.value)} className={inputClass}>
            <option value="ALL">Tutti</option>
            {PLESSI.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="w-36">
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Priorità</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
            <option value="ALL">Tutte</option>
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--text-main)] pb-1.5 cursor-pointer">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          Solo assegnati a me
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--text-main)] pb-1.5 cursor-pointer">
          <input type="checkbox" checked={allResolved} onChange={(e) => setAllResolved(e.target.checked)} />
          Mostra tutti i risolti (non solo ultimi {RESOLVED_DAYS} giorni)
        </label>
      </div>

      {/* Colonne */}
      {/* Le colonne si dividono tutta la larghezza; sugli schermi stretti si scorre di lato */}
      <div className="flex gap-3 overflow-x-auto pb-2 w-full">
        {columns.map((col) => (
          <div
            key={col.id}
            onDragOver={(e) => {
              e.preventDefault();
              if (overColumn !== col.id) setOverColumn(col.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverColumn(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(col.id);
            }}
            className={`flex-1 min-w-[230px] h-[calc(100vh-300px)] min-h-[360px] flex flex-col rounded-xl border transition ${
              overColumn === col.id && draggingId !== null
                ? "border-blue-500 bg-blue-500/5"
                : "border-[var(--border-color)] bg-[var(--bg-card)]"
            }`}
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)]">
              <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`}></span>
                {col.label}
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--text-main)]">{col.tickets.length}</span>
            </div>

            <div className="p-2 space-y-2 overflow-y-auto flex-1 min-h-0">
              {col.tickets.length === 0 ? (
                <p className="text-[11px] text-center text-[var(--text-muted)] py-6">
                  {draggingId !== null ? "Rilascia qui" : "Nessun ticket"}
                </p>
              ) : (
                col.tickets.map((t) => {
                  const pr = priorityInfo(t.priority);
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(t.id));
                        setDraggingId(t.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setOverColumn(null);
                      }}
                      onClick={() => setOpenTicketId(t.id)}
                      className={`relative overflow-hidden pl-3 pr-2.5 py-2.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] hover:border-blue-500/50 cursor-grab active:cursor-grabbing transition space-y-1.5 ${
                        draggingId === t.id ? "opacity-40" : ""
                      }`}
                    >
                      <span className={`absolute left-0 top-0 bottom-0 w-1 ${PRIORITY_BAR[t.priority] ?? "bg-slate-400"}`}></span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 font-semibold">{t.code}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${pr.badge}`}>{pr.label}</span>
                      </div>
                      <p className="text-[13px] font-semibold text-[var(--text-main)] leading-snug line-clamp-2">{t.title}</p>
                      <p className="text-[11px] text-[var(--text-muted)] truncate">
                        {t.room_code} • {plessoLabel(t.plesso)} • {categoryLabel(t.category)}
                      </p>
                      {t.status === "INOLTRATO_FACTOTUM" && t.factotum_code && (
                        <p className="text-[10px] font-mono text-purple-600 dark:text-purple-400">{t.factotum_code}</p>
                      )}
                      <div className="flex items-center justify-between gap-2 pt-1 text-[10px] text-[var(--text-muted)]">
                        {t.assignees.length === 0 ? (
                          <span>Da assegnare</span>
                        ) : (
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="flex -space-x-1.5">
                              {t.assignees.slice(0, 3).map((a) => (
                                <UserAvatar key={a.id} picture={a.picture} name={a.name} email={a.email} size={18} />
                              ))}
                            </span>
                            <span className="truncate">{t.assigned_to_name}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-2 shrink-0">
                          {t.awaiting_reporter && <span title="In attesa di risposta di chi ha segnalato">⏳</span>}
                          {t.messages_count > 0 && <span title="Messaggi con chi ha segnalato">✉ {t.messages_count}</span>}
                    {t.attachments_count > 0 && <span title="Foto allegate">📷 {t.attachments_count}</span>}
                          {t.comments_count > 0 && <span title="Commenti interni">💬 {t.comments_count}</span>}
                          <span title="Da quanto è stato inserito">{age(t.created_at)}</span>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-[var(--text-muted)]">
        Da telefono o tablet il trascinamento non è disponibile: apri il ticket e cambia lo stato dai pulsanti.
      </p>

      {/* Dettaglio ticket */}
      {openTicket && user && (
        <TicketDetailModal
          ticket={openTicket}
          user={user}
          onClose={() => setOpenTicketId(null)}
          onChanged={(updated) => setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))}
          onDeleted={(id) => {
            setOpenTicketId(null);
            setTickets((prev) => prev.filter((t) => t.id !== id));
          }}
        />
      )}

      {/* Codice pratica per l'inoltro a FACTOTUM */}
      {factotumTicket && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              changeStatus(factotumTicket, "INOLTRATO_FACTOTUM", { factotum_code: factotumCode, factotum_notes: factotumNotes });
              setFactotumTicket(null);
            }}
            className="bg-[var(--bg-card)] border border-[var(--border-color)] p-6 rounded-xl max-w-md w-full space-y-3 shadow-xl"
          >
            <h3 className="text-base font-semibold text-[var(--text-main)]">Inoltra {factotumTicket.code} a FACTOTUM</h3>
            <p className="text-xs text-[var(--text-muted)]">{factotumTicket.title}</p>
            <input
              type="text"
              placeholder="Codice pratica FACTOTUM (vuoto = generato automaticamente)"
              value={factotumCode}
              onChange={(e) => setFactotumCode(e.target.value)}
              className={inputClass}
            />
            <textarea
              rows={2}
              placeholder="Note per l'inoltro..."
              value={factotumNotes}
              onChange={(e) => setFactotumNotes(e.target.value)}
              className={inputClass}
            />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setFactotumTicket(null)} className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition">
                Annulla
              </button>
              <button type="submit" className="px-4 py-1.5 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition">
                Conferma inoltro
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
