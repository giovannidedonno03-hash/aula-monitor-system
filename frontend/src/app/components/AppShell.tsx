"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";

/**
 * Struttura comune delle pagine (menu laterale + barra superiore).
 * La Dashboard TV (/tv) viene mostrata a schermo intero, senza menu.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname?.startsWith("/tv")) {
    // Dashboard TV: esattamente grande quanto lo schermo, senza barre di scorrimento
    return <div className="w-screen h-screen overflow-hidden">{children}</div>;
  }

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
