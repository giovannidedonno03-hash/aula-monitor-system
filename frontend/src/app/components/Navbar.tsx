"use client";

import { useEffect, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useTheme } from "next-themes";
import UserAvatar from "./UserAvatar";
import { getApiBase, UserRole, roleInfo } from "../lib/constants";

interface User {
  id: number;
  email: string;
  full_name: string;
  picture: string;
  role: UserRole;
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Evita mismatch di idratazione: il tema è noto solo lato client
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Passa alla modalità chiara" : "Passa alla modalità scura"}
      aria-label="Cambia tema chiaro/scuro"
      className="w-9 h-9 rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-subtle)] flex items-center justify-center transition"
    >
      {!mounted ? null : isDark ? (
        // Icona sole
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
        </svg>
      ) : (
        // Icona luna
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      fetch(`${getApiBase()}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setUser(data);
          else localStorage.removeItem("token");
        })
        .catch(() => localStorage.removeItem("token"));
    }
  }, []);

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: credentialResponse.credential }),
      });

      if (!res.ok) throw new Error("Autenticazione fallita");

      const data = await res.json();
      localStorage.setItem("token", data.access_token);
      setUser(data.user);
      window.location.reload();
    } catch (err) {
      alert("Errore durante il Login con Google");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setUser(null);
    window.location.reload();
  };

  return (
    <header className="h-16 border-b border-[var(--border-color)] bg-[var(--bg-card)] px-6 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span className="text-xs font-mono text-[var(--text-muted)]">
          ITTS C. GRASSI • CONNESSIONE ATTIVA
        </span>
      </div>

      <div className="flex items-center gap-4">
        <ThemeToggle />

        {user ? (
          <div className="flex items-center gap-3">
            {/* Foto Utente Google (o iniziale colorata se non disponibile) */}
            <UserAvatar picture={user.picture} name={user.full_name} email={user.email} size={36} />

            <div className="text-left hidden sm:block">
              <p className="text-xs font-semibold text-[var(--text-main)]">
                {user.full_name || user.email}
              </p>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                RUOLO: {roleInfo(user.role).label.toUpperCase()}
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="px-2.5 py-1 text-xs bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded hover:bg-rose-500/20 transition ml-2"
            >
              Esci
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {/* Icona Avatar Generica Prima del Login */}
            <div className="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-muted)] shadow-sm">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>

            {loading ? (
              <span className="text-xs text-[var(--text-muted)] font-mono">
                Accesso in corso...
              </span>
            ) : (
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => alert("Login Fallito")}
                type="standard"
                theme="filled_black"
                size="small"
                shape="pill"
              />
            )}
          </div>
        )}

        {/* Logo della scuola (in alto a destra). Sfondo bianco per restare leggibile anche in dark mode */}
        <div className="h-11 px-2 py-1 rounded-lg bg-white border border-[var(--border-color)] flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-grassi.png" alt="ITTS C. Grassi" className="h-full w-auto object-contain" />
        </div>
      </div>
    </header>
  );
}
