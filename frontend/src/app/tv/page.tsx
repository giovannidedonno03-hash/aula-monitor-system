"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import UserAvatar from "../components/UserAvatar";
import { getApiBase, STATUSES, Ticket, categoryLabel, isStaff, parseServerDate, plessoLabel, priorityInfo } from "../lib/constants";

interface Technician {
  id: number;
  name: string;
  email: string;
  picture: string | null;
}

interface TvData {
  tickets: Ticket[];
  technicians: Technician[];
  resolved_total: number;
}

const REFRESH_MS = 30_000; // aggiornamento dati ogni 30 secondi

function timeAgo(value: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - parseServerDate(value).getTime()) / 60000));
  if (minutes < 1) return "adesso";
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h fa`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 giorno fa" : `${days} giorni fa`;
}

/** Contenitore che scorre da solo verso il basso quando il contenuto non entra (TV senza touch). */
function AutoScroll({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pauseUntil = Date.now() + 3000;
    const timer = setInterval(() => {
      if (el.scrollHeight <= el.clientHeight || Date.now() < pauseUntil) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
        // Arrivati in fondo: pausa e si riparte dall'inizio
        pauseUntil = Date.now() + 4000;
        setTimeout(() => el.scrollTo({ top: 0, behavior: "smooth" }), 3000);
      } else {
        el.scrollTop += 1;
      }
    }, 50);
    return () => clearInterval(timer);
  }, []);

  return (
    <div ref={ref} className={`overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

export default function TvDashboardPage() {
  const [data, setData] = useState<TvData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [kiosk, setKiosk] = useState(false);

  // Accesso: modalità kiosk (/tv?kiosk=true, per il televisore) oppure utente dell'Ufficio Tecnico
  useEffect(() => {
    const isKiosk = new URLSearchParams(window.location.search).get("kiosk") === "true";
    setKiosk(isKiosk);
    if (isKiosk) {
      setAccess("allowed");
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) {
      setAccess("denied");
      return;
    }
    fetch(`${getApiBase()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((u) => setAccess(u && isStaff(u.role) ? "allowed" : "denied"))
      .catch(() => setAccess("denied"));
  }, []);

  // Nessuno scorrimento della pagina: la dashboard deve stare tutta nello schermo
  useEffect(() => {
    const html = document.documentElement;
    const prev = [html.style.overflow, document.body.style.overflow];
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev[0];
      document.body.style.overflow = prev[1];
    };
  }, []);

  // Orologio
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Dati con aggiornamento automatico
  useEffect(() => {
    if (access !== "allowed") return;
    const load = async () => {
      try {
        const res = await fetch(`${getApiBase()}/tv`);
        if (!res.ok) throw new Error("Errore nel caricamento dei dati.");
        setData(await res.json());
        setLastUpdate(new Date());
        setError(null);
      } catch (e: any) {
        setError(e.message || "Server non raggiungibile.");
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [access]);

  const tickets = useMemo(() => data?.tickets ?? [], [data]);

  const counts = useMemo(
    () => ({
      aperti: tickets.filter((t) => t.status === "APERTO").length,
      lavorazione: tickets.filter((t) => t.status === "IN_CARICO" || t.status === "IN_ESECUZIONE").length,
      factotum: tickets.filter((t) => t.status === "INOLTRATO_FACTOTUM").length,
    }),
    [tickets]
  );

  // Ticker in basso: segnalazioni urgenti e ad alta priorità ancora da risolvere
  const urgent = useMemo(
    () =>
      tickets
        .filter((t) => t.status !== "RISOLTO" && (t.priority === "URGENTE" || t.priority === "ALTA"))
        .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "URGENTE" ? -1 : 1)),
    [tickets]
  );

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  if (access === "checking") {
    return <div className="p-8 text-sm font-mono text-[var(--text-muted)] animate-pulse">Verifica accesso...</div>;
  }

  if (access === "denied") {
    return (
      <div className="min-h-screen grid place-items-center p-8">
        <div className="max-w-md text-center space-y-3 p-6 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
          <h1 className="text-lg font-semibold text-[var(--text-main)]">Dashboard TV</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Questa pagina è riservata all'Ufficio Tecnico (Supervisore e Manager). Per il televisore usa
            l'indirizzo <span className="font-mono text-[var(--text-main)]">/tv?kiosk=true</span>.
          </p>
          <Link href="/" className="inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline">
            ← Torna al gestionale
          </Link>
        </div>
      </div>
    );
  }

  const metrics = [
    { label: "Segnalazioni Aperte", value: counts.aperti, color: "text-blue-600 dark:text-blue-400", bar: "bg-blue-500" },
    { label: "In Lavorazione", value: counts.lavorazione, color: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
    { label: "Inoltri FACTOTUM", value: counts.factotum, color: "text-purple-600 dark:text-purple-400", bar: "bg-purple-500" },
    // Stessi ticket della colonna "Risolto" (chiusi negli ultimi 7 giorni)
    { label: "Risolti ultimi 7 giorni", value: tickets.filter((t) => t.status === "RISOLTO").length, color: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
  ];

  return (
    <div className="h-screen w-screen max-w-full flex flex-col gap-3 p-4 overflow-hidden">
      <style>{`
        @keyframes tv-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .tv-marquee { animation: tv-marquee 40s linear infinite; }
      `}</style>

      {/* 1. INTESTAZIONE */}
      <header className="flex items-center justify-between gap-4 shrink-0 min-w-0">
        <div className="flex items-center gap-4 min-w-0">
          <div className="h-12 shrink-0 px-3 py-1.5 rounded-xl bg-white border border-[var(--border-color)] flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-grassi.png" alt="ITTS C. Grassi" className="h-full w-auto object-contain" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--text-main)] tracking-tight">Ufficio Tecnico</h1>
            <p className="text-xs text-[var(--text-muted)] font-mono flex items-center gap-2 truncate">
              <span className={`w-2 h-2 rounded-full ${error ? "bg-rose-500" : "bg-emerald-500 animate-pulse"}`}></span>
              {error
                ? `Connessione persa: ${error}`
                : `Aggiornamento automatico ogni 30 s${lastUpdate ? ` • ultimo alle ${lastUpdate.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : ""}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-3xl font-bold font-mono text-[var(--text-main)] tabular-nums">
              {now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            <div className="text-xs text-[var(--text-muted)] capitalize">
              {now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={toggleFullscreen}
              className="px-3 py-1.5 text-xs border border-[var(--border-color)] bg-[var(--bg-card)] hover:bg-[var(--bg-subtle)] text-[var(--text-main)] rounded-lg transition"
            >
              Schermo intero
            </button>
            {!kiosk && (
              <Link
                href="/"
                className="px-3 py-1.5 text-xs text-center border border-[var(--border-color)] bg-[var(--bg-card)] hover:bg-[var(--bg-subtle)] text-[var(--text-main)] rounded-lg transition"
              >
                ← Gestionale
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* 2. CONTATORI */}
      <section className="grid grid-cols-4 gap-3 shrink-0 min-w-0">
        {metrics.map((m) => (
          <div key={m.label} className="relative overflow-hidden min-w-0 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 flex items-baseline gap-3">
            <span className={`absolute left-0 top-0 bottom-0 w-1 ${m.bar}`}></span>
            <div className={`text-3xl font-bold tabular-nums ${m.color}`}>{m.value}</div>
            <div className="text-sm text-[var(--text-muted)] truncate">{m.label}</div>
          </div>
        ))}
      </section>

      {/* 3. COLONNE PER STATO + CARICO TECNICI */}
      <section className="flex-1 min-h-0 min-w-0 grid grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.1fr)] gap-2.5">
        {STATUSES.map((col) => {
          const colTickets = tickets.filter((t) => t.status === col.id);
          return (
            <div key={col.id} className="min-h-0 min-w-0 flex flex-col bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-color)]">
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)] truncate">
                  <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`}></span>
                  {col.label}
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--text-main)]">
                  {colTickets.length}
                </span>
              </div>
              <AutoScroll className="flex-1 min-h-0 p-1.5 space-y-1.5">
                {colTickets.length === 0 ? (
                  <p className="text-xs text-center text-[var(--text-muted)] py-6">Nessuna segnalazione</p>
                ) : (
                  colTickets.map((t) => {
                    const pr = priorityInfo(t.priority);
                    return (
                      <div key={t.id} className="px-2.5 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] space-y-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono text-blue-600 dark:text-blue-400 font-semibold">{t.code}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${pr.badge}`}>{pr.label}</span>
                        </div>
                        <p className="text-[13px] font-semibold text-[var(--text-main)] leading-snug line-clamp-2">{t.title}</p>
                        <p className="text-[11px] text-[var(--text-muted)] truncate">
                          {t.room_code} • {plessoLabel(t.plesso)} • {categoryLabel(t.category)}
                        </p>
                        {t.status === "INOLTRATO_FACTOTUM" && t.factotum_code && (
                          <p className="text-[10px] font-mono text-purple-600 dark:text-purple-400">{t.factotum_code}</p>
                        )}
                        <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
                          <span className="truncate">{t.assigned_to_name || "Da assegnare"}</span>
                          <span className="whitespace-nowrap">{timeAgo(t.created_at, now)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </AutoScroll>
            </div>
          );
        })}

        {/* Carico di lavoro dei tecnici (Manager UT) */}
        <div className="min-h-0 min-w-0 flex flex-col bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl">
          <div className="px-3 py-2 border-b border-[var(--border-color)] text-sm font-semibold text-[var(--text-main)]">
            Carico Tecnici
          </div>
          <AutoScroll className="flex-1 min-h-0 p-1.5 space-y-1.5">
            {(data?.technicians ?? []).length === 0 ? (
              <p className="text-xs text-center text-[var(--text-muted)] py-6">
                Nessun tecnico dell'Ufficio Tecnico.
              </p>
            ) : (
              (data?.technicians ?? []).map((tech) => {
                const tasks = tickets.filter((t) => t.assignees.some((a) => a.id === tech.id) && t.status !== "RISOLTO");
                return (
                  <div key={tech.id} className="px-2.5 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <UserAvatar picture={tech.picture} name={tech.name} email={tech.email} size={28} />
                      <span className="flex-1 text-sm font-semibold text-[var(--text-main)] truncate">{tech.name}</span>
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                          tasks.length > 0
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {tasks.length}
                      </span>
                    </div>
                    {tasks.length === 0 ? (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400">Disponibile</p>
                    ) : (
                      <ul className="space-y-1">
                        {tasks.map((t) => (
                          <li key={t.id} className="text-[11px] text-[var(--text-main)] truncate">
                            <span className="font-mono text-[var(--text-muted)]">{t.code}</span> {t.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </AutoScroll>
        </div>
      </section>

      {/* 4. TICKER URGENZE */}
      <footer className="shrink-0 w-full min-w-0 flex items-stretch rounded-xl overflow-hidden border border-rose-500/30 bg-[var(--bg-card)]">
        <div className="shrink-0 px-4 flex items-center bg-rose-600 text-white text-sm font-bold tracking-wide">⚠ URGENTI</div>
        <div className="flex-1 min-w-0 overflow-hidden py-2">
          {urgent.length === 0 ? (
            <p className="px-4 text-sm text-[var(--text-muted)]">Nessuna segnalazione urgente o ad alta priorità in corso.</p>
          ) : (
            <div className="tv-marquee flex w-max whitespace-nowrap">
              {/* Contenuto duplicato per uno scorrimento continuo */}
              {[0, 1].map((loop) => (
                <div key={loop} className="flex">
                  {urgent.map((t) => (
                    <span key={`${loop}-${t.id}`} className="px-6 text-sm text-[var(--text-main)]">
                      <span className={t.priority === "URGENTE" ? "text-rose-600 dark:text-rose-400 font-bold" : "text-orange-600 dark:text-orange-400 font-bold"}>
                        [{priorityInfo(t.priority).label.toUpperCase()}]
                      </span>{" "}
                      <span className="font-mono text-[var(--text-muted)]">{t.code}</span> {t.title} — {t.room_code}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
