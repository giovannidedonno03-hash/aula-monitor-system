"use client";

import { useEffect, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { getApiBase } from "../lib/constants";

/** Schermata mostrata a chi non ha fatto l'accesso: nessun dato della scuola è visibile. */
export default function LoginScreen() {
  const [allowedDomain, setAllowedDomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${getApiBase()}/auth/config`)
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => setAllowedDomain(cfg?.allowed_domain ?? null))
      .catch(() => {});
  }, []);

  const handleGoogleSuccess = async (credentialResponse: { credential?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: credentialResponse.credential }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Accesso non riuscito.");
      localStorage.setItem("token", data.access_token);
      window.location.reload();
    } catch (err: any) {
      setError(err.message || "Accesso non riuscito.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-8 space-y-6 text-center shadow-sm">
        <div className="mx-auto w-fit h-16 px-3 py-2 rounded-xl bg-white border border-[var(--border-color)] flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-grassi.png" alt="ITTS C. Grassi" className="h-full w-auto object-contain" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-[var(--text-main)]">Gestionale Ufficio Tecnico</h1>
          <p className="text-xs text-[var(--text-muted)]">Segnalazioni, prenotazioni di aule e carrelli PC</p>
        </div>

        <div className="flex flex-col items-center gap-2">
          {loading ? (
            <p className="text-xs font-mono text-[var(--text-muted)] animate-pulse">Accesso in corso...</p>
          ) : (
            // color-scheme: light evita il riquadro bianco intorno al pulsante di Google in tema scuro
            <div style={{ colorScheme: "light" }}>
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError("Accesso con Google non riuscito.")}
                theme="filled_black"
                size="large"
                shape="pill"
                text="signin_with"
              />
            </div>
          )}
          {allowedDomain && <p className="text-[11px] text-[var(--text-muted)]">Accedi con l&apos;email della scuola (@{allowedDomain})</p>}
        </div>

        {error && (
          <p className="text-xs px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400">{error}</p>
        )}
      </div>
    </div>
  );
}
