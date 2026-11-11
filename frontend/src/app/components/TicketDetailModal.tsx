"use client";

import { useEffect, useRef, useState } from "react";
import UserAvatar from "./UserAvatar";
import {
  getApiBase,
  STATUSES,
  StaffUser,
  Ticket,
  TicketComment,
  TicketStatus,
  UserRole,
  categoryLabel,
  formatDateTime,
  isStaff,
  isSupervisor,
  plessoLabel,
  priorityInfo,
  roleInfo,
  statusInfo,
} from "../lib/constants";

interface Props {
  ticket: Ticket;
  user: { id: number; role: UserRole };
  onClose: () => void;
  onChanged: (ticket: Ticket) => void; // ticket aggiornato
  onDeleted: (ticketId: number) => void;
}

const inputClass =
  "w-full px-3 py-1.5 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500 transition";

const sectionTitle = "text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]";

function authHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem("token");
  const h: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Operazione non riuscita.");
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Evidenzia le @menzioni nel testo dei commenti */
function renderWithMentions(text: string) {
  return text.split(/(@[\p{L}'.-]+)/u).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="font-semibold text-blue-600 dark:text-blue-400">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function TicketDetailModal({ ticket, user, onClose, onChanged, onDeleted }: Props) {
  const staff = isStaff(user.role);
  const supervisor = isSupervisor(user.role);
  const canDelete = ticket.reporter_id === user.id || supervisor;
  const isAssignedToMe = ticket.assignees.some((a) => a.id === user.id);

  const [busy, setBusy] = useState(false);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [showFactotumForm, setShowFactotumForm] = useState(false);
  const [factotumCode, setFactotumCode] = useState("");
  const [factotumNotes, setFactotumNotes] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const commentBox = useRef<HTMLTextAreaElement>(null);

  // Tecnici assegnabili e commenti: solo per l'Ufficio Tecnico
  useEffect(() => {
    if (!staff) return;
    fetch(`${getApiBase()}/users/staff`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then(setStaffUsers)
      .catch(() => {});
    fetch(`${getApiBase()}/tickets/${ticket.id}/comments`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then(setComments)
      .catch(() => {});
  }, [staff, ticket.id]);

  // Chiusura con il tasto Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (status: TicketStatus, extra: Record<string, string> = {}) =>
    run(async () => {
      const t = await call<Ticket>(`${getApiBase()}/tickets/${ticket.id}/status`, {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ status, ...extra }),
      });
      onChanged(t);
      setShowFactotumForm(false);
    });

  const handleStatusClick = (status: TicketStatus) => {
    if (status === "INOLTRATO_FACTOTUM") {
      setFactotumCode("");
      setFactotumNotes("");
      setShowFactotumForm(true);
      return;
    }
    changeStatus(status);
  };

  const toggleSelf = () =>
    run(async () => {
      const t = await call<Ticket>(`${getApiBase()}/tickets/${ticket.id}/presa-in-carico`, {
        method: isAssignedToMe ? "DELETE" : "POST",
        headers: authHeaders(),
      });
      onChanged(t);
    });

  const toggleAssignee = (userId: number) =>
    run(async () => {
      const ids = ticket.assignees.map((a) => a.id);
      const next = ids.includes(userId) ? ids.filter((i) => i !== userId) : [...ids, userId];
      const t = await call<Ticket>(`${getApiBase()}/tickets/${ticket.id}/assignees`, {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ user_ids: next }),
      });
      onChanged(t);
    });

  const addComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    run(async () => {
      const c = await call<TicketComment>(`${getApiBase()}/tickets/${ticket.id}/comments`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ content: commentText }),
      });
      setComments((prev) => [...prev, c]);
      setCommentText("");
      onChanged({ ...ticket, comments_count: ticket.comments_count + 1 });
    });
  };

  const deleteComment = (id: number) => {
    if (!confirm("Eliminare questo commento?")) return;
    run(async () => {
      await call<void>(`${getApiBase()}/comments/${id}`, { method: "DELETE", headers: authHeaders() });
      setComments((prev) => prev.filter((c) => c.id !== id));
      onChanged({ ...ticket, comments_count: Math.max(0, ticket.comments_count - 1) });
    });
  };

  const insertMention = (name: string) => {
    // Si usa il cognome (ultima parola) come nel gestionale Grassi
    const tag = `@${name.trim().split(/\s+/).slice(-1)[0]} `;
    setCommentText((prev) => (prev && !prev.endsWith(" ") ? `${prev} ${tag}` : `${prev}${tag}`));
    commentBox.current?.focus();
  };

  const deleteTicket = () =>
    run(async () => {
      await call<void>(`${getApiBase()}/tickets/${ticket.id}`, { method: "DELETE", headers: authHeaders() });
      onDeleted(ticket.id);
    });

  const st = statusInfo(ticket.status);
  const pr = priorityInfo(ticket.priority);
  const roomCode = ticket.room_code || `Aula #${ticket.room_id}`;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Intestazione */}
        <div className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 font-semibold">
                {ticket.code}
              </span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${pr.badge}`}>{pr.label}</span>
              <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${st.badge}`}>{st.label}</span>
            </div>
            <h2 className="text-base font-semibold text-[var(--text-main)] mt-2">{ticket.title}</h2>
            <p className="text-xs text-[var(--text-muted)]">
              <span className="text-[var(--text-main)] font-medium">{roomCode}</span> • {plessoLabel(ticket.plesso)} •{" "}
              {categoryLabel(ticket.category)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            className="w-8 h-8 shrink-0 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-subtle)] transition text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-sm text-[var(--text-main)] leading-relaxed whitespace-pre-wrap">{ticket.description}</p>

          {/* Storico */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] text-[11px]">
            <div>
              <span className="text-[var(--text-muted)]">Inserito il: </span>
              <span className="text-[var(--text-main)] font-medium">{formatDateTime(ticket.created_at)}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Segnalato da: </span>
              <span className="text-[var(--text-main)] font-medium">{ticket.reporter_name || "—"}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Preso in carico il: </span>
              <span className="text-[var(--text-main)] font-medium">{formatDateTime(ticket.taken_at)}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Terminato il: </span>
              <span className="text-[var(--text-main)] font-medium">
                {ticket.status === "RISOLTO" ? formatDateTime(ticket.resolved_at) : "—"}
              </span>
            </div>
          </div>

          {/* Pratica FACTOTUM */}
          {ticket.status === "INOLTRATO_FACTOTUM" && ticket.factotum_code && (
            <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 text-[11px] space-y-0.5">
              <p className="font-semibold text-purple-700 dark:text-purple-300">
                Pratica FACTOTUM: <span className="font-mono">{ticket.factotum_code}</span>
                <span className="font-normal text-[var(--text-muted)]"> • inoltrata il {formatDateTime(ticket.factotum_date)}</span>
              </p>
              {ticket.factotum_notes && <p className="text-[var(--text-main)]">{ticket.factotum_notes}</p>}
            </div>
          )}

          {/* Stato di lavorazione */}
          {staff && (
            <section className="space-y-2">
              <h3 className={sectionTitle}>Stato di lavorazione</h3>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleStatusClick(s.id)}
                    disabled={busy || ticket.status === s.id}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition ${
                      ticket.status === s.id
                        ? `${s.badge} cursor-default`
                        : "bg-[var(--bg-main)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-blue-500/50 disabled:opacity-50"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {showFactotumForm && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    changeStatus("INOLTRATO_FACTOTUM", { factotum_code: factotumCode, factotum_notes: factotumNotes });
                  }}
                  className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 space-y-2"
                >
                  <p className="text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                    Inoltra la segnalazione alla piattaforma FACTOTUM
                  </p>
                  <input
                    type="text"
                    placeholder="Codice pratica FACTOTUM (vuoto = generato automaticamente)"
                    value={factotumCode}
                    onChange={(e) => setFactotumCode(e.target.value)}
                    className={inputClass}
                  />
                  <textarea
                    rows={2}
                    placeholder="Note per l'inoltro (es. serve una ditta esterna per il riscaldamento)..."
                    value={factotumNotes}
                    onChange={(e) => setFactotumNotes(e.target.value)}
                    className={inputClass}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowFactotumForm(false)}
                      className="px-3 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
                    >
                      Annulla
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="px-3 py-1 text-[11px] font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-md transition disabled:opacity-50"
                    >
                      Conferma Inoltro
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          {/* Assegnazione */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className={sectionTitle}>Tecnici assegnati</h3>
              {staff && ticket.status !== "RISOLTO" && (
                <button
                  onClick={toggleSelf}
                  disabled={busy}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition disabled:opacity-50 ${
                    isAssignedToMe
                      ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20"
                      : "bg-blue-600 hover:bg-blue-500 text-white border-blue-600"
                  }`}
                >
                  {isAssignedToMe ? "Lascia presa in carico" : "Prendi in carico"}
                </button>
              )}
            </div>

            {ticket.assignees.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">Nessun tecnico assegnato.</p>
            ) : (
              <ul className="space-y-1.5">
                {ticket.assignees.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-xs">
                    <UserAvatar picture={a.picture} name={a.name} email={a.email} size={24} />
                    <span className="font-medium text-[var(--text-main)]">{a.name}</span>
                    <span className="text-[var(--text-muted)] text-[11px]">• dal {formatDateTime(a.assigned_at)}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Il Supervisore sceglie i tecnici */}
            {supervisor && staffUsers.length > 0 && (
              <div className="p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] space-y-2">
                <p className="text-[11px] text-[var(--text-muted)]">Assegna a uno o più collaboratori dell'Ufficio Tecnico:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {staffUsers.map((u) => {
                    const checked = ticket.assignees.some((a) => a.id === u.id);
                    return (
                      <label
                        key={u.id}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition ${
                          checked
                            ? "bg-blue-500/10 border-blue-500/40 text-[var(--text-main)] font-medium"
                            : "bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-main)] hover:border-blue-500/40"
                        } ${busy ? "opacity-60 pointer-events-none" : ""}`}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleAssignee(u.id)} />
                        <UserAvatar picture={u.picture} name={u.name} email={u.email} size={22} />
                        <span className="truncate flex-1">{u.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${roleInfo(u.role).badge}`}>
                          {u.role === "SUPERVISORE" ? "SUP" : "UT"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Commenti interni */}
          {staff && (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className={sectionTitle}>Commenti interni</h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  Riservato Ufficio Tecnico
                </span>
              </div>

              {comments.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] p-3 rounded-lg border border-dashed border-[var(--border-color)] text-center">
                  Nessun commento. Tagga un collega con @ per coinvolgerlo.
                </p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {comments.map((c) => (
                    <li key={c.id} className="p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] text-xs space-y-1">
                      <div className="flex items-center gap-2">
                        <UserAvatar picture={c.author_picture} name={c.author_name} email={c.author_email} size={20} />
                        <span className="font-semibold text-[var(--text-main)]">{c.author_name}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{formatDateTime(c.created_at)}</span>
                        {(c.author_id === user.id || supervisor) && (
                          <button
                            onClick={() => deleteComment(c.id)}
                            className="ml-auto text-[10px] text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 transition"
                          >
                            Elimina
                          </button>
                        )}
                      </div>
                      <p className="text-[var(--text-main)] leading-relaxed whitespace-pre-wrap break-words pl-7">
                        {renderWithMentions(c.content)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={addComment} className="space-y-2">
                {staffUsers.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-[var(--text-muted)]">Tagga:</span>
                    {staffUsers
                      .filter((u) => u.id !== user.id)
                      .map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => insertMention(u.name)}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition"
                        >
                          @{u.name.trim().split(/\s+/).slice(-1)[0]}
                        </button>
                      ))}
                  </div>
                )}
                <textarea
                  ref={commentBox}
                  rows={2}
                  placeholder="Scrivi un commento interno e tagga con @nome..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className={inputClass}
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={busy || !commentText.trim()}
                    className="px-3 py-1.5 text-[11px] font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-md transition disabled:opacity-50"
                  >
                    Invia commento
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* Eliminazione */}
          {canDelete && (
            <div className="pt-4 border-t border-[var(--border-color)] flex items-center justify-end gap-2">
              {confirmDelete ? (
                <>
                  <span className="text-[11px] text-rose-600 dark:text-rose-400">Eliminare definitivamente la segnalazione?</span>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={deleteTicket}
                    disabled={busy}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-md transition disabled:opacity-50"
                  >
                    Sì, elimina
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-2.5 py-1 text-[11px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded-md transition"
                >
                  Elimina segnalazione
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
