"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import LoginScreen from "./LoginScreen";
import { getApiBase } from "../lib/constants";

/**
 * Struttura comune delle pagine (menu laterale + barra superiore).
 * - Chi non ha fatto l'accesso vede solo la schermata di login: nessuna pagina né dato della scuola.
 * - La Dashboard TV (/tv) viene mostrata a schermo intero, senza menu, e gestisce da sola
 *   l'accesso (login dell'Ufficio Tecnico oppure chiave kiosk per il televisore).
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isTv = pathname?.startsWith("/tv");
  const [auth, setAuth] = useState<"checking" | "in" | "out">("checking");

  useEffect(() => {
    if (isTv) return;
    const token = localStorage.getItem("token");
    if (!token) {
      setAuth("out");
      return;
    }
    fetch(`${getApiBase()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.ok) setAuth("in");
        else if (res.status === 401 || res.status === 403) {
          // Sessione scaduta o account non più ammesso
          localStorage.removeItem("token");
          setAuth("out");
        } else setAuth("in"); // errore temporaneo del server: le pagine mostreranno il loro messaggio
      })
      .catch(() => setAuth("in"));
  }, [isTv]);

  if (isTv) {
    // Dashboard TV: esattamente grande quanto lo schermo, senza barre di scorrimento
    return <div className="w-screen h-screen overflow-hidden">{children}</div>;
  }

  if (auth === "checking") {
    return <div className="flex-1 min-h-screen flex items-center justify-center text-xs font-mono text-[var(--text-muted)] animate-pulse">Caricamento...</div>;
  }

  if (auth === "out") return <LoginScreen />;

  return (
    <>
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        <Navbar />
        <main className="p-8 flex-1">{children}</main>
      </div>
    </>
  );
}
