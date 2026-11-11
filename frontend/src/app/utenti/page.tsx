"use client";

import { useEffect, useState } from "react";
import { getApiBase, ROLES, UserRole, isSupervisor, roleInfo } from "../lib/constants";
import UserAvatar from "../components/UserAvatar";

interface UserItem {
  id: number;
  email: string;
  full_name: string | null;
  picture: string | null;
  role: UserRole;
  is_active: boolean;
}

export default function UsersManagementPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [currentUser, setCurrentUser] = useState<UserItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const fetchUsers = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setError("Autenticazione richiesta.");
      setLoading(false);
      return;
    }

    try {
      const [resMe, resUsers] = await Promise.all([
        fetch(`${getApiBase()}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${getApiBase()}/users`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (resMe.ok) setCurrentUser(await resMe.json());

      if (!resUsers.ok) {
        if (resUsers.status === 403) {
          throw new Error("Accesso negato: Sezione riservata agli Amministratori.");
        }
        throw new Error("Errore nel recupero degli utenti.");
      }

      setUsers(await resUsers.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (userId: number, newRole: string) => {
    const token = localStorage.getItem("token");
    if (!token) return;

    setUpdatingId(userId);
    try {
      const res = await fetch(`${getApiBase()}/users/${userId}/role`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Errore durante la modifica del ruolo.");
      }

      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-xs font-mono text-[var(--text-muted)] animate-pulse">
        Caricamento elenco utenti...
      </div>
    );
  }

  if (error || !isSupervisor(currentUser?.role)) {
    return (
      <div className="p-6 text-center bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-xl space-y-2">
        <h2 className="text-base font-semibold">⚠️ Accesso Limitato</h2>
        <p className="text-xs">{error || "Questa pagina è visibile esclusivamente agli utenti con ruolo Supervisore."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      {/* Header Pagina */}
      <div className="border-b border-[var(--border-color)] pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">
            Gestione Utenti & Ruoli
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Visualizza gli utenti registrati nel sistema e modifica i loro permessi d'accesso.
          </p>
        </div>
        <span className="text-xs font-mono px-3 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg">
          {users.length} Utenti Registrati
        </span>
      </div>

      {/* Tabella Utenti */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[var(--text-main)]">
            <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] border-b border-[var(--border-color)] font-medium">
              <tr>
                <th className="p-4">Utente</th>
                <th className="p-4">Email</th>
                <th className="p-4">Ruolo Attuale</th>
                <th className="p-4 text-right">Modifica Ruolo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-color)]">
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                return (
                  <tr key={u.id} className="hover:bg-[var(--bg-subtle)] transition">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <UserAvatar picture={u.picture} name={u.full_name} email={u.email} size={32} />
                        <div>
                          <div className="font-semibold flex items-center gap-2">
                            <span>{u.full_name || "Utente Senza Nome"}</span>
                            {isSelf && (
                              <span className="text-[10px] bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 px-1.5 py-0.2 rounded">
                                Tu
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-[var(--text-muted)]">
                            ID: #{u.id}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="p-4 font-mono text-[var(--text-muted)]">
                      {u.email}
                    </td>

                    <td className="p-4">
                      <span
                        title={roleInfo(u.role).description}
                        className={`text-[10px] font-mono px-2.5 py-1 rounded border font-semibold whitespace-nowrap ${roleInfo(u.role).badge}`}
                      >
                        {roleInfo(u.role).label}
                      </span>
                    </td>

                    <td className="p-4 text-right">
                      <select
                        value={u.role}
                        disabled={updatingId === u.id}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        className="px-3 py-1.5 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-xs font-mono text-[var(--text-main)] cursor-pointer focus:outline-none focus:border-blue-500 transition disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}