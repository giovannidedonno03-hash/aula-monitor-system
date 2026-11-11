"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import TicketDetailModal from "../components/TicketDetailModal";
import UserAvatar from "../components/UserAvatar";
import {
  getApiBase,
  CATEGORIES,
  PLESSI,
  PRIORITIES,
  STATUSES,
  Room,
  Ticket,
  UserRole,
  categoryLabel,
  formatDateTime,
  isStaff,
  plessoLabel,
  priorityInfo,
  statusInfo,
} from "../lib/constants";

interface User {
  id: number;
  role: UserRole;
}

const inputClass =
  "w-full px-3 py-1.5 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500 transition";

// useSearchParams (per la vista "Assegnate a me") richiede un confine Suspense
export default function TicketPage() {
  return (
    <Suspense fallback={<p className="text-xs text-[var(--text-muted)] font-mono animate-pulse">Caricamento ticket...</p>}>
      <TicketPageContent />
    </Suspense>
  );
}

function TicketPageContent() {
  const searchParams = useSearchParams();
  const view = searchParams.get("vista") === "assegnate" ? "assegnate" : "tutte";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openTicketId, setOpenTicketId] = useState<number | null>(null);

  // Stato Filtri
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [plessoFilter, setPlessoFilter] = useState<string>("ALL");
  const [roomFilter, setRoomFilter] = useState<string>("ALL");

  // Modale Creazione Ticket
  const [showModal, setShowModal] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [plesso, setPlesso] = useState<string>("SEDE_PRINCIPALE");
  const [category, setCategory] = useState<string>("INFORMATICO");
  const [priority, setPriority] = useState<string>("MEDIA");
  const [submitting, setSubmitting] = useState(false);

  const staff = isStaff(user?.role);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchData = async () => {
    try {
      const [resTickets, resRooms] = await Promise.all([
        fetch(`${getApiBase()}/tickets`, { headers: authHeaders() }),
        fetch(`${getApiBase()}/rooms`),
      ]);
      if (resTickets.ok) setTickets(await resTickets.json());
      if (resRooms.ok) setRooms(await resRooms.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      fetch(`${getApiBase()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setUser(data))
        .finally(() => setAuthChecked(true));
      fetchData();
    } else {
      setAuthChecked(true);
      setLoading(false);
    }
  }, []);

  const mine = useMemo(
    () => (user ? tickets.filter((t) => t.assignees.some((a) => a.id === user.id)) : []),
    [tickets, user]
  );

  // Logica di Filtraggio in Tempo Reale
  const filteredTickets = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const base = staff && view === "assegnate" ? mine : tickets;
    return base.filter((t) => {
      const matchesSearch =
        t.title.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q);

      return (
        matchesSearch &&
        (statusFilter === "ALL" || t.status === statusFilter) &&
        (priorityFilter === "ALL" || t.priority === priorityFilter) &&
        (categoryFilter === "ALL" || t.category === categoryFilter) &&
        (plessoFilter === "ALL" || t.plesso === plessoFilter) &&
        (roomFilter === "ALL" || t.room_id === Number(roomFilter))
      );
    });
  }, [tickets, mine, staff, view, searchQuery, statusFilter, priorityFilter, categoryFilter, plessoFilter, roomFilter]);

  const openTicket = tickets.find((t) => t.id === openTicketId) || null;

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localStorage.getItem("token")) return alert("Devi essere autenticato.");

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          room_id: Number(selectedRoomId),
          title,
          description,
          plesso,
          category,
          priority,
        }),
      });

      if (!res.ok) throw new Error("Errore durante la creazione del ticket.");

      setTitle("");
      setDescription("");
      setPriority("MEDIA");
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (authChecked && !user) {
    return (
      <div className="space-y-6 w-full">
        <div className="border-b border-[var(--border-color)] pb-4">
          <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">Segnalazioni Ticket</h1>
        </div>
        <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
          Effettua l&apos;accesso con Google (in alto a destra) per vedere e aprire le segnalazioni.
        </div>
      </div>
    );
  }

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
      active
        ? "bg-blue-600/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
        : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-subtle)]"
    }`;

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="border-b border-[var(--border-color)] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">
            {!staff ? "Le Mie Segnalazioni" : view === "assegnate" ? "Assegnate a me" : "Segnalazioni Ticket"}
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {!staff
              ? "Storico e stato delle segnalazioni che hai inviato all'Ufficio Tecnico."
              : view === "assegnate"
              ? "Le segnalazioni di cui ti stai occupando o che il Supervisore ti ha assegnato."
              : "Clicca su una segnalazione per cambiarne lo stato, assegnarla e commentarla."}
          </p>
        </div>

        {user && (
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition shadow-sm self-start sm:self-auto"
          >
            + Nuova Segnalazione
          </button>
        )}
      </div>

      {/* Linguette: tutte / assegnate a me (solo Ufficio Tecnico) */}
      {staff && (
        <div className="flex items-center gap-2">
          <Link href="/ticket" className={tabClass(view === "tutte")}>
            Tutte ({tickets.length})
          </Link>
          <Link href="/ticket?vista=assegnate" className={tabClass(view === "assegnate")}>
            Assegnate a me ({mine.filter((t) => t.status !== "RISOLTO").length} da chiudere)
          </Link>
        </div>
      )}

      {/* Barra di Ricerca e Filtri */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)]">
        <div className="col-span-2 md:col-span-3 xl:col-span-1">
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Cerca Ticket</label>
          <input
            type="text"
            placeholder="Codice, titolo o descrizione..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Stato</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputClass}>
            <option value="ALL">Tutti gli stati</option>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Priorità</label>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className={inputClass}>
            <option value="ALL">Tutte</option>
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Categoria</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={inputClass}>
            <option value="ALL">Tutte</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Plesso</label>
          <select value={plessoFilter} onChange={(e) => setPlessoFilter(e.target.value)} className={inputClass}>
            <option value="ALL">Tutti</option>
            {PLESSI.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Aula</label>
          <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} className={inputClass}>
            <option value="ALL">Tutte le aule</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.code}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Lista Ticket */}
      {loading || !authChecked ? (
        <p className="text-xs text-[var(--text-muted)] font-mono animate-pulse">Caricamento ticket...</p>
      ) : filteredTickets.length === 0 ? (
        <div className="p-8 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
          {staff && view === "assegnate"
            ? "Non hai segnalazioni assegnate. Aprine una e usa \"Prendi in carico\"."
            : "Nessuna segnalazione trovata con i filtri selezionati."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredTickets.map((t) => {
            const st = statusInfo(t.status);
            const pr = priorityInfo(t.priority);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setOpenTicketId(t.id)}
                className="text-left bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)] hover:border-blue-500/50 hover:shadow-sm transition flex flex-col gap-2.5"
              >
                <div className="flex items-start justify-between gap-2 w-full">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 font-semibold">
                      {t.code}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${pr.badge}`}>{pr.label}</span>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold whitespace-nowrap ${st.badge}`}>
                    {st.label}
                  </span>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-main)]">{t.title}</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    <span className="text-[var(--text-main)] font-medium">{t.room_code || `Aula #${t.room_id}`}</span> •{" "}
                    {plessoLabel(t.plesso)} • {categoryLabel(t.category)}
                  </p>
                </div>

                <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">{t.description}</p>

                <div className="mt-auto pt-2.5 border-t border-[var(--border-color)] flex items-center justify-between gap-2 text-[11px] w-full">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {t.assignees.length === 0 ? (
                      <span className="text-[var(--text-muted)]">Da assegnare</span>
                    ) : (
                      <>
                        <div className="flex -space-x-1.5">
                          {t.assignees.slice(0, 3).map((a) => (
                            <UserAvatar key={a.id} picture={a.picture} name={a.name} email={a.email} size={20} />
                          ))}
                        </div>
                        <span className="text-[var(--text-main)] truncate">{t.assigned_to_name}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[var(--text-muted)]">
                    {staff && t.comments_count > 0 && <span title="Commenti interni">💬 {t.comments_count}</span>}
                    <span>{formatDateTime(t.created_at)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

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

      {/* Modale Creazione Ticket */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] p-6 rounded-xl max-w-md w-full space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-[var(--text-main)]">Nuova Segnalazione Guasto</h3>

            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--text-muted)] block mb-1">Plesso</label>
                  <select
                    value={plesso}
                    onChange={(e) => {
                      setPlesso(e.target.value);
                      setSelectedRoomId(""); // l'elenco dei locali cambia con il plesso
                    }}
                    className={inputClass}
                  >
                    {PLESSI.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] block mb-1">Aula / Locale</label>
                  <select
                    required
                    value={selectedRoomId}
                    onChange={(e) => setSelectedRoomId(e.target.value === "" ? "" : Number(e.target.value))}
                    className={inputClass}
                  >
                    <option value="">-- Seleziona --</option>
                    {rooms
                      .filter((r) => r.plesso === plesso)
                      .map((r) => (
                        <option key={r.id} value={r.id}>{r.code}</option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--text-muted)] block mb-1">Categoria</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] block mb-1">Priorità</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
                    {PRIORITIES.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">Titolo Problema</label>
                <input
                  type="text"
                  required
                  placeholder="es. Proiettore spento, Luce rotta, Perdita rubinetto..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">Descrizione Dettagliata</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Descrivi brevemente il guasto riscontrato..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition disabled:opacity-50"
                >
                  {submitting ? "Invio..." : "Invia Segnalazione"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
