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

interface NavItem {
  label: string;
  href: string;
  icon: keyof typeof ICONS;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

// Icone semplici (tratto 1.8, 20x20) disegnate in SVG
const ICONS = {
  home: "M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9.5z",
  ticket: "M4 7a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V7z M10 5v14",
  kanban: "M4 5h4v14H4z M10 5h4v9h-4z M16 5h4v6h-4z",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8z M4 20a8 8 0 0116 0",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M3 20h18",
  calendar: "M4 6a2 2 0 012-2h12a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2V6z M4 10h16 M8 2v4 M16 2v4",
  laptop: "M5 5h14v10H5z M3 19h18 M9 19l1-4 M15 19l-1-4",
  check: "M9 12l2 2 4-4 M12 21a9 9 0 100-18 9 9 0 000 18z",
  building: "M4 21V5a2 2 0 012-2h8a2 2 0 012 2v16 M16 9h2a2 2 0 012 2v10 M8 7h4 M8 11h4 M8 15h4 M3 21h18",
  tv: "M3 6a2 2 0 012-2h14a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z M8 21h8 M12 17v4",
  users: "M9 11a4 4 0 100-8 4 4 0 000 8z M2 20a7 7 0 0114 0 M16 3.5a4 4 0 010 7 M22 20a7 7 0 00-4-6.3",
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
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

  const staff = isStaff(user?.role);
  const manageBookings = staff || user?.role === "RESPONSABILE_LAB" || user?.role === "ASSISTENTE_TECNICO";

  // Voci raggruppate per argomento; ognuno vede solo quelle del proprio ruolo
  const groups: NavGroup[] = [
    { items: [{ label: "Dashboard", href: "/", icon: "home" }] },
    {
      title: "Segnalazioni",
      items: [
        { label: staff ? "Tutti i ticket" : "Le mie segnalazioni", href: "/ticket", icon: "ticket" },
        ...(staff
          ? ([
              { label: "Bacheca Kanban", href: "/kanban", icon: "kanban" },
              { label: "Assegnate a me", href: "/ticket?vista=assegnate", icon: "user" },
              { label: "Statistiche", href: "/statistiche", icon: "chart" },
            ] as NavItem[])
          : []),
      ],
    },
    {
      title: "Prenotazioni",
      items: [
        { label: "Prenota un'aula", href: "/prenotazioni", icon: "calendar" },
        { label: "Prenota un carrello PC", href: "/carrelli", icon: "laptop" },
        ...(manageBookings ? ([{ label: "Gestione prenotazioni", href: "/prenotazioni/gestione", icon: "check" }] as NavItem[]) : []),
      ],
    },
    {
      title: "Amministrazione",
      items: [
        { label: "Aule e Laboratori", href: "/aule", icon: "building" },
        ...(staff ? ([{ label: "Dashboard TV", href: "/tv", icon: "tv" }] as NavItem[]) : []),
        ...(isSupervisor(user?.role) ? ([{ label: "Gestione Utenti", href: "/utenti", icon: "users" }] as NavItem[]) : []),
      ],
    },
  ];

  return (
    <aside className="w-64 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-card)] min-h-screen p-4 flex flex-col justify-between">
      <div className="space-y-6">
        {/* Intestazione */}
        <div className="flex items-center gap-3 px-2">
          <div className="w-9 h-9 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-sm shadow-md">AM</div>
          <div>
            <h1 className="text-sm font-bold text-[var(--text-main)] tracking-tight">Aula Monitor</h1>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono">Gestione Scuola</p>
          </div>
        </div>

        {/* Menu a gruppi */}
        <nav className="space-y-5">
          {groups
            .filter((g) => g.items.length > 0)
            .map((group, gi) => (
              <div key={group.title ?? gi} className="space-y-1">
                {group.title && (
                  <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{group.title}</p>
                )}
                {group.items.map((item) => {
                  // "Assegnate a me" usa la stessa pagina dei ticket: si evidenzia solo "Tutti i ticket"
                  const isActive = !item.href.includes("?") && (pathname === item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition ${
                        isActive
                          ? "bg-blue-600/10 text-blue-600 dark:text-blue-400"
                          : "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)]"
                      }`}
                    >
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
        </nav>
      </div>

      <div className="border-t border-[var(--border-color)] pt-4 px-2 text-[10px] font-mono text-[var(--text-muted)]">
        ITTS C. Grassi • Ufficio Tecnico
      </div>
    </aside>
  );
}
