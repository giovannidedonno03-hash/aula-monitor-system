"use client";

import { useEffect, useState } from "react";
import UserAvatar from "../components/UserAvatar";
import {
  getApiBase,
  categoryLabel,
  isStaff,
  plessoLabel,
  priorityInfo,
  roleInfo,
  statusInfo,
} from "../lib/constants";

interface Breakdown {
  id: string;
  total: number;
  open: number;
}

interface TechStat {
  id: number;
  name: string;
  email: string;
  picture: string | null;
  role: string;
  open: number;
  resolved: number;
  avg_resolution_hours: number | null;
}

interface Stats {
  total: number;
  open: number;
  resolved: number;
  resolution_rate: number | null;
  unassigned: number;
  avg_take_hours: number | null;
  avg_resolution_hours: number | null;
  by_status: Breakdown[];
  by_priority: Breakdown[];
  by_category: Breakdown[];
  by_plesso: Breakdown[];
  technicians: TechStat[];
  trend: { date: string; opened: number; resolved: number }[];
}

/** Durata leggibile: "45 min", "5,2 h", "2,3 giorni" */
function formatHours(h: number | null): string {
  if (h === null || h === undefined) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h`;
  return `${(h / 24).toLocaleString("it-IT", { maximumFractionDigits: 1 })} giorni`;
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5 space-y-4 ${className}`}>
      <h2 className="text-sm font-semibold text-[var(--text-main)]">{title}</h2>
      {children}
    </section>
  );
}

/** Barre orizzontali: lunghezza = numero di ticket, in un solo colore (grandezza) */
function BarList({ rows, label }: { rows: Breakdown[]; label: (id: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.id} className="text-xs" title={`${label(r.id)}: ${r.total} totali, ${r.open} ancora aperti`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[var(--text-main)]">{label(r.id)}</span>
            <span className="text-[var(--text-muted)] tabular-nums">
              <span className="text-[var(--text-main)] font-semibold">{r.total}</span>
              {r.open > 0 && ` · ${r.open} aperti`}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${(r.total / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function StatistichePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "error">("loading");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setState("denied");
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${getApiBase()}/auth/me`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (u) => {
        if (!u || !isStaff(u.role)) {
          setState("denied");
          return;
        }
        const r = await fetch(`${getApiBase()}/stats`, { headers });
        if (!r.ok) throw new Error();
        setStats(await r.json());
        setState("ok");
      })
      .catch(() => setState("error"));
  }, []);

  if (state === "loading") {
    return <p className="text-xs text-[var(--text-muted)] font-mono animate-pulse">Caricamento statistiche...</p>;
  }
  if (state === "denied") {
    return (
      <div className="p-6 text-center bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-xl text-xs">
        Le statistiche sono riservate all&apos;Ufficio Tecnico (Supervisore e Manager).
      </div>
    );
  }
  if (state === "error" || !stats) {
    return <p className="text-xs text-rose-600 dark:text-rose-400">Errore nel caricamento delle statistiche.</p>;
  }

  const kpis = [
    { label: "Segnalazioni totali", value: String(stats.total), note: `${stats.open} ancora da chiudere` },
    {
      label: "Tasso di risoluzione",
      value: stats.resolution_rate === null ? "—" : `${Math.round(stats.resolution_rate * 100)}%`,
      note: `${stats.resolved} risolte`,
    },
    { label: "Tempo medio di presa in carico", value: formatHours(stats.avg_take_hours), note: "dall'inserimento" },
    { label: "Tempo medio di risoluzione", value: formatHours(stats.avg_resolution_hours), note: "dall'inserimento alla chiusura" },
    { label: "Da assegnare", value: String(stats.unassigned), note: "aperte senza tecnico" },
  ];

  const trendMax = Math.max(1, ...stats.trend.map((d) => Math.max(d.opened, d.resolved)));
  const statusTotal = Math.max(1, stats.total);

  return (
    <div className="space-y-6 w-full">
      <div className="border-b border-[var(--border-color)] pb-4">
        <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">Statistiche</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Andamento delle segnalazioni e carico di lavoro dell&apos;Ufficio Tecnico.
        </p>
      </div>

      {/* Indicatori principali */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4 space-y-1">
            <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
            <p className="text-2xl font-bold text-[var(--text-main)] tabular-nums">{k.value}</p>
            <p className="text-[11px] text-[var(--text-muted)]">{k.note}</p>
          </div>
        ))}
      </div>

      {/* Distribuzione per stato */}
      <Card title="Segnalazioni per stato">
        <div className="flex h-3 w-full rounded-full overflow-hidden gap-0.5 bg-[var(--bg-subtle)]">
          {stats.by_status
            .filter((s) => s.total > 0)
            .map((s) => (
              <div
                key={s.id}
                className={statusInfo(s.id).dot}
                style={{ width: `${(s.total / statusTotal) * 100}%` }}
                title={`${statusInfo(s.id).label}: ${s.total}`}
              />
            ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {stats.by_status.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 text-[var(--text-main)]">
              <span className={`w-2.5 h-2.5 rounded-full ${statusInfo(s.id).dot}`} />
              {statusInfo(s.id).label}
              <span className="font-semibold tabular-nums">{s.total}</span>
            </span>
          ))}
        </div>
      </Card>

      {/* Andamento 14 giorni */}
      <Card title="Andamento ultimi 14 giorni">
        <div className="flex items-center gap-4 text-xs text-[var(--text-main)]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Nuove segnalazioni
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Risolte
          </span>
        </div>
        <div className="flex items-end gap-1.5 h-40 border-b border-[var(--border-color)]">
          {stats.trend.map((d) => {
            const day = new Date(d.date + "T00:00:00");
            const label = day.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
            return (
              <div
                key={d.date}
                className="flex-1 h-full flex items-end justify-center gap-0.5 group"
                title={`${label}: ${d.opened} nuove, ${d.resolved} risolte`}
              >
                <div
                  className="w-1/3 max-w-3 rounded-t bg-blue-500 group-hover:opacity-80"
                  style={{ height: `${(d.opened / trendMax) * 100}%` }}
                />
                <div
                  className="w-1/3 max-w-3 rounded-t bg-emerald-500 group-hover:opacity-80"
                  style={{ height: `${(d.resolved / trendMax) * 100}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-1.5 text-[10px] text-[var(--text-muted)]">
          {stats.trend.map((d, i) => (
            <span key={d.date} className="flex-1 text-center tabular-nums">
              {i % 2 === 0 ? new Date(d.date + "T00:00:00").toLocaleDateString("it-IT", { day: "numeric", month: "numeric" }) : ""}
            </span>
          ))}
        </div>
      </Card>

      {/* Carico per tecnico */}
      <Card title="Carico di lavoro per collaboratore">
        {stats.technicians.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Nessun tecnico dell&apos;Ufficio Tecnico.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-[var(--text-main)]">
              <thead className="text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Collaboratore</th>
                  <th className="py-2 px-3 font-medium text-right">In corso</th>
                  <th className="py-2 px-3 font-medium text-right">Risolti</th>
                  <th className="py-2 pl-3 font-medium text-right">Tempo medio di risoluzione</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {stats.technicians.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <UserAvatar picture={t.picture} name={t.name} email={t.email} size={26} />
                        <span className="font-medium">{t.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${roleInfo(t.role).badge}`}>
                          {roleInfo(t.role).label}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{t.open}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{t.resolved}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums">{formatHours(t.avg_resolution_hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Ripartizioni */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Per categoria">
          <BarList rows={[...stats.by_category].sort((a, b) => b.total - a.total)} label={categoryLabel} />
        </Card>
        <Card title="Per priorità">
          <BarList rows={stats.by_priority} label={(id) => priorityInfo(id).label} />
        </Card>
        <Card title="Per plesso">
          <BarList rows={stats.by_plesso} label={plessoLabel} />
        </Card>
      </div>
    </div>
  );
}
