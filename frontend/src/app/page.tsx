"use client";

import { useEffect, useState } from "react";
import { getApiBase, TicketStatus, statusInfo } from "./lib/constants";
import Link from "next/link";

interface Room {
  id: number;
  code: string;
}

interface Ticket {
  id: number;
  code: string;
  title: string;
  status: TicketStatus;
  created_at: string;
  room_id: number;
}

interface StatsData {
  rooms: {
    total: number;
    active: number;
    inactive: number;
  };
  tickets: {
    total: number;
    pending: number;
    in_progress: number;
    resolved: number;
  };
  recent_tickets: Ticket[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const [resStats, resRooms] = await Promise.all([
          fetch(`${getApiBase()}/dashboard/stats`),
          fetch(`${getApiBase()}/rooms`),
        ]);

        if (!resStats.ok) throw new Error("Errore nel caricamento delle statistiche.");
        if (resRooms.ok) setRooms(await resRooms.json());

        setStats(await resStats.json());
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="p-6 text-xs font-mono text-[var(--text-muted)] animate-pulse">
        Caricamento metriche in corso...
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="p-4 text-xs bg-rose-500/10 border border-rose-500/30 text-rose-500 rounded-lg">
        {error || "Errore di connessione con il server."}
      </div>
    );
  }

  const activeRoomsPercentage = stats.rooms.total > 0
    ? Math.round((stats.rooms.active / stats.rooms.total) * 100)
    : 100;

  return (
    <div className="space-y-6 w-full">
      {/* Header Dashboard */}
      <div className="border-b border-[var(--border-color)] pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">
            Dashboard Panoramica
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Stato in tempo reale delle infrastrutture e segnalazioni attive.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          SISTEMA OPERATIVO ({activeRoomsPercentage}% Aule Attive)
        </div>
      </div>

      {/* Griglia Widget Metriche */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Aule Operative */}
        <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border-color)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">Aule Totali</span>
          </div>
          <div className="flex items-baseline justify-between">
            <p className="text-2xl font-bold text-[var(--text-main)]">{stats.rooms.total}</p>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">
              {stats.rooms.active} Operative
            </span>
          </div>
        </div>

        {/* Card 2: Ticket Aperti */}
        <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border-color)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">Aperti</span>
          </div>
          <div className="flex items-baseline justify-between">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.tickets.pending}</p>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              Richiedono Assegnazione
            </span>
          </div>
        </div>

        {/* Card 3: Ticket In Lavorazione */}
        <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border-color)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">In Lavorazione</span>
          </div>
          <div className="flex items-baseline justify-between">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.tickets.in_progress}</p>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              In Carico ai Tecnici
            </span>
          </div>
        </div>

        {/* Card 4: Ticket Risolti */}
        <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border-color)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">Guasti Risolti</span>
          </div>
          <div className="flex items-baseline justify-between">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.tickets.resolved}</p>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              Interventi Completati
            </span>
          </div>
        </div>
      </div>

      {/* Sezione Inferiore: Ultimi Ticket Aperti + Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tabella / Lista Ultimi Ticket (2 Colonne) */}
        <div className="lg:col-span-2 bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border-color)] space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
            <h2 className="text-sm font-semibold text-[var(--text-main)]">
              Ultimi Ticket Aperti
            </h2>
            <Link
              href="/ticket"
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-300 font-medium transition"
            >
              Vedi Tutti →
            </Link>
          </div>

          {stats.recent_tickets.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] py-4 text-center">
              Nessun ticket registrato di recente.
            </p>
          ) : (
            <div className="space-y-3">
              {stats.recent_tickets.map((t) => {
                const roomCode = rooms.find((r) => r.id === t.room_id)?.code || `Aula #${t.room_id}`;
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)] text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 font-semibold">
                          {t.code}
                        </span>
                        <span className="font-medium text-[var(--text-main)]">
                          {t.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Aula: {roomCode}
                      </p>
                    </div>

                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border whitespace-nowrap ${statusInfo(t.status).badge}`}>
                      {statusInfo(t.status).label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Actions Panel (1 Colonna) */}
        <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border-color)] space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-main)] border-b border-[var(--border-color)] pb-3">
              Azioni Rapide
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Accedi rapidamente ai moduli principali dell'infrastruttura per inviare o verificare segnalazioni.
            </p>
          </div>

          <div className="space-y-2 pt-4">
            <Link
              href="/ticket"
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center justify-between transition shadow-sm"
            >
              <span>Apri un Ticket Guasto</span>
              <span>→</span>
            </Link>

            <Link
              href="/aule"
              className="w-full py-2.5 px-4 bg-[var(--bg-subtle)] hover:opacity-80 text-[var(--text-main)] border border-[var(--border-color)] rounded-lg text-xs font-semibold flex items-center justify-between transition"
            >
              <span>Stato Aule & Laboratori</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}