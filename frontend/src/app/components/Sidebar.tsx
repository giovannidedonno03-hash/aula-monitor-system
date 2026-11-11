"use client";

import { useEffect, useState } from "react";
import { getApiBase, UserRole, isStaff, isSupervisor } from "../lib/constants";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface User {
  id: number;
  email: string;
  role: UserRole;
}

export default function Sidebar() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      fetch(`${getApiBase()}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setUser(data))
        .catch(() => setUser(null));
    }
  }, []);

  const navItems = [
    { label: "Dashboard", href: "/" },
    { label: "Aule e Laboratori", href: "/aule" },
    { label: "Segnalazioni Ticket", href: "/ticket" },
    { label: "Prenotazione Aule", href: "/prenotazioni" },
    // Voci riservate all'Ufficio Tecnico
    ...(isStaff(user?.role)
      ? [
          { label: "Assegnate a me", href: "/ticket?vista=assegnate" },
          { label: "Statistiche", href: "/statistiche" },
        ]
      : []),
  ];

  return (
    <aside className="w-64 border-r border-[var(--border-color)] bg-[var(--bg-card)] min-h-screen p-4 flex flex-col justify-between">
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-sm shadow-md">
            AM
          </div>
          <div>
            <h1 className="text-sm font-bold text-[var(--text-main)] tracking-tight">
              Aula Monitor
            </h1>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono">
              Gestione Scuola
            </p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
                  isActive
                    ? "bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)]"
                }`}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}

          {/* Dashboard TV: riservata all'Ufficio Tecnico */}
          {isStaff(user?.role) && (
            <Link
              href="/tv"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)]"
            >
              <span>Dashboard TV</span>
            </Link>
          )}

          {/* Link Riservato al Supervisore */}
          {isSupervisor(user?.role) && (
            <Link
              href="/utenti"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
                pathname === "/utenti"
                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)]"
              }`}
            >
              <span>Gestione Utenti</span>
            </Link>
          )}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="border-t border-[var(--border-color)] pt-4 px-2 text-[10px] font-mono text-[var(--text-muted)]">
        Sistema v1.0 • Next.js
      </div>
    </aside>
  );
}