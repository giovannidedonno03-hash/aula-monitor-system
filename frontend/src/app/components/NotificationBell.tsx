"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNotification, getApiBase, parseServerDate } from "../lib/constants";

const REFRESH_MS = 30_000; // controlla nuove notifiche ogni 30 secondi

const TYPE_STYLE: Record<string, { icon: string; color: string }> = {
  MENZIONE: { icon: "@", color: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  ASSEGNAZIONE: { icon: "→", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  STATO: { icon: "●", color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
};

function timeAgo(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - parseServerDate(value).getTime()) / 60000));
  if (minutes < 1) return "adesso";
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h fa`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "ieri" : `${days} giorni fa`;
}

/** Campanella con le notifiche dell'utente collegato (menzioni, assegnazioni, cambi di stato). */
export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  const headers = (): Record<string, string> => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/notifications`, { headers: headers() });
      if (!res.ok) return;
      const data = await res.json();
      setUnread(data.unread);
      setItems(data.items);
    } catch {
      // server non raggiungibile: si riprova al prossimo giro
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Chiusura cliccando fuori dal pannello
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const openNotification = async (n: AppNotification) => {
    if (!n.is_read) {
      await fetch(`${getApiBase()}/notifications/${n.id}/letta`, { method: "POST", headers: headers() }).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
    if (n.ticket_id) router.push(`/ticket?apri=${n.ticket_id}`);
  };

  const markAllRead = async () => {
    await fetch(`${getApiBase()}/notifications/lette`, { method: "POST", headers: headers() }).catch(() => {});
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnread(0);
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        aria-label={unread > 0 ? `Notifiche: ${unread} da leggere` : "Notifiche"}
        title="Notifiche"
        className="relative w-9 h-9 rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-subtle)] flex items-center justify-center transition"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
            <span className="text-sm font-semibold text-[var(--text-main)]">Notifiche</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline">
                Segna tutte come lette
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">Nessuna notifica.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto divide-y divide-[var(--border-color)]">
              {items.map((n) => {
                const style = TYPE_STYLE[n.type] ?? TYPE_STYLE.STATO;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-[var(--bg-subtle)] transition ${
                        n.is_read ? "opacity-70" : ""
                      }`}
                    >
                      <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${style.color}`}>
                        {style.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className={`text-xs text-[var(--text-main)] ${n.is_read ? "" : "font-semibold"}`}>{n.title}</span>
                          {!n.is_read && <span className="w-2 h-2 mt-1 shrink-0 rounded-full bg-blue-500" aria-label="Da leggere" />}
                        </span>
                        <span className="block text-[11px] text-[var(--text-muted)] line-clamp-2 mt-0.5">{n.message}</span>
                        <span className="block text-[10px] text-[var(--text-muted)] mt-1">{timeAgo(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
