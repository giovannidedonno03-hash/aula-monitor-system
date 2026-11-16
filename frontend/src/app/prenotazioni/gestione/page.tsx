"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Booking,
  bookingStatusInfo,
  describeBooking,
  extrasLabels,
  formatDateTime,
  getApiBase,
  groupBookings,
} from "../../lib/constants";

interface Management {
  is_staff: boolean;
  can_approve: boolean;
  responsible_rooms: string[];
  assistant_rooms: string[];
  pending: Booking[];
  upcoming: Booking[];
}

const inputClass =
  "w-full px-3 py-1.5 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500 transition";

function authHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem("token");
  const h: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (json) h["Content-Type"] = "application/json";
  return h;
}

/** Scheda di una richiesta di prenotazione (righe con lo stesso codice) */
function BookingCard({ group, children }: { group: Booking[]; children?: React.ReactNode }) {
  const first = group[0];
  const st = bookingStatusInfo(first.status);
  const extra = extrasLabels(first.extras);
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] space-y-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 font-semibold">{first.code}</span>
            <span className="text-sm font-semibold text-[var(--text-main)]">{first.room_code}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${st.badge}`}>{st.label}</span>
          </div>
          <p className="text-[var(--text-main)]">{describeBooking(group)}</p>
          <p className="text-[var(--text-muted)]">
            <span className="text-[var(--text-main)] font-medium">{first.purpose}</span> — richiesta da {first.user_name} (
            {first.user_email}) il {formatDateTime(first.created_at)}
          </p>
          {extra.length > 0 && <p className="text-[var(--text-muted)]">Extra richiesti: {extra.join(", ")}</p>}
          {first.status === "IN_ATTESA" && first.status_reason && (
            <p className="text-amber-600 dark:text-amber-400">Da approvare perché: {first.status_reason}</p>
          )}
          {first.status === "APPROVATA" && first.status_reason && (
            <p className="text-[var(--text-muted)]">{first.status_reason}</p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Pulsanti Approva / Rifiuta con nota o motivazione */
function DecisionBox({ code, onDone }: { code: string; onDone: () => void }) {
  const [mode, setMode] = useState<"none" | "approva" | "rifiuta">("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (mode === "rifiuta" && !note.trim()) return alert("Scrivi il motivo del rifiuto.");
    setBusy(true);
    try {
      const res = await fetch(`${getApiBase()}/bookings/${code}/${mode}`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Operazione non riuscita.");
      }
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (mode === "none") {
    return (
      <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-color)]">
        <button
          onClick={() => setMode("rifiuta")}
          className="px-3 py-1.5 text-[11px] font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded-md transition"
        >
          Rifiuta...
        </button>
        <button
          onClick={() => setMode("approva")}
          className="px-3 py-1.5 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition"
        >
          Approva
        </button>
      </div>
    );
  }

  return (
    <div className="pt-2 border-t border-[var(--border-color)] space-y-2">
      <textarea
        rows={2}
        autoFocus
        placeholder={mode === "rifiuta" ? "Motivo del rifiuto (obbligatorio), es. laboratorio in manutenzione" : "Nota per chi ha prenotato (facoltativa)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className={inputClass}
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => {
            setMode("none");
            setNote("");
          }}
          className="px-3 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
        >
          Annulla
        </button>
        <button
          onClick={send}
          disabled={busy}
          className={`px-3 py-1 text-[11px] font-semibold text-white rounded-md transition disabled:opacity-50 ${
            mode === "rifiuta" ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500"
          }`}
        >
          {mode === "rifiuta" ? "Conferma rifiuto" : "Conferma approvazione"}
        </button>
      </div>
    </div>
  );
}

export default function GestionePrenotazioniPage() {
  const [data, setData] = useState<Management | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "login" | "error">("loading");
  const [tab, setTab] = useState<"da_approvare" | "prossime">("da_approvare");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!localStorage.getItem("token")) {
      setState("login");
      return;
    }
    try {
      const res = await fetch(`${getApiBase()}/bookings/gestione`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const d: Management = await res.json();
      setData(d);
      setState("ok");
      if (!d.can_approve) setTab("prossime");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pendingGroups = useMemo(() => groupBookings(data?.pending ?? []), [data]);
  const upcomingGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupBookings(data?.upcoming ?? []).filter(
      (g) =>
        !q ||
        g[0].room_code.toLowerCase().includes(q) ||
        g[0].user_name.toLowerCase().includes(q) ||
        g[0].purpose.toLowerCase().includes(q)
    );
  }, [data, search]);

  if (state === "loading") return <p className="text-xs text-[var(--text-muted)] font-mono animate-pulse">Caricamento...</p>;
  if (state === "login")
    return (
      <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
        Effettua l&apos;accesso con Google (in alto a destra).
      </div>
    );
  if (state === "error" || !data) return <p className="text-xs text-rose-600 dark:text-rose-400">Errore nel caricamento delle prenotazioni.</p>;

  const nothingToManage = !data.is_staff && !data.can_approve && data.assistant_rooms.length === 0;

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
      active
        ? "bg-blue-600/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
        : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-subtle)]"
    }`;

  return (
    <div className="space-y-6 w-full">
      <div className="border-b border-[var(--border-color)] pb-4">
        <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">Gestione Prenotazioni</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          {data.is_staff
            ? "Ufficio Tecnico: approvi o rifiuti le richieste in attesa di tutti i locali e vedi tutte le prossime prenotazioni."
            : "Le richieste da approvare e le prossime prenotazioni dei locali di cui sei responsabile o assistente tecnico."}
        </p>
        {(data.responsible_rooms.length > 0 || data.assistant_rooms.length > 0) && (
          <p className="text-[11px] text-[var(--text-muted)] mt-2">
            {data.responsible_rooms.length > 0 && <>Responsabile di: <span className="text-[var(--text-main)] font-medium">{data.responsible_rooms.join(", ")}</span>. </>}
            {data.assistant_rooms.length > 0 && <>Assistente tecnico di: <span className="text-[var(--text-main)] font-medium">{data.assistant_rooms.join(", ")}</span>.</>}
          </p>
        )}
      </div>

      {nothingToManage ? (
        <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl space-y-1">
          <p>Non risulti responsabile né assistente tecnico di nessun locale.</p>
          <p>
            Il Supervisore può indicare la tua email nella scheda del locale (pagina{" "}
            <Link href="/aule" className="text-blue-600 dark:text-blue-400 hover:underline">
              Aule e Laboratori
            </Link>
            , pulsante Modifica).
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            {data.can_approve && (
              <button onClick={() => setTab("da_approvare")} className={tabClass(tab === "da_approvare")}>
                Da approvare ({pendingGroups.length})
              </button>
            )}
            <button onClick={() => setTab("prossime")} className={tabClass(tab === "prossime")}>
              Prossime prenotazioni ({groupBookings(data.upcoming).length})
            </button>
          </div>

          {tab === "da_approvare" && data.can_approve && (
            <div className="space-y-3">
              {pendingGroups.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
                  Nessuna richiesta in attesa di approvazione.
                </div>
              ) : (
                pendingGroups.map((g) => (
                  <BookingCard key={g[0].code} group={g}>
                    <DecisionBox code={g[0].code} onDone={load} />
                  </BookingCard>
                ))
              )}
            </div>
          )}

          {tab === "prossime" && (
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Cerca per locale, persona o motivo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${inputClass} max-w-sm`}
              />
              {upcomingGroups.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
                  Nessuna prenotazione in programma.
                </div>
              ) : (
                upcomingGroups.map((g) => <BookingCard key={g[0].code} group={g} />)
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
