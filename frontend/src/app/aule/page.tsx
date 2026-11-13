"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getApiBase,
  PLESSI,
  ROOM_TYPES,
  Room,
  UserRole,
  isSupervisor,
  plessoLabel,
  roomTypeLabel,
  splitEquipment,
} from "../lib/constants";

interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
}

const inputClass =
  "w-full px-3 py-1.5 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500 transition";

const EMPTY_FORM = {
  code: "",
  room_type: "AULA",
  plesso: "SEDE_PRINCIPALE",
  is_bookable: false,
  free_schedule: false,
  responsible: "",
  technical_assistant: "",
  equipment: "",
};

export default function AulePage() {
  const [aule, setAule] = useState<Room[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filtri
  const [search, setSearch] = useState("");
  const [plessoFilter, setPlessoFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [onlyBookable, setOnlyBookable] = useState(false);

  // Finestra modale di creazione
  const [showModal, setShowModal] = useState<boolean>(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null); // null = nuovo locale
  const [submitting, setSubmitting] = useState(false);

  const supervisor = isSupervisor(user?.role);

  const fetchAule = () => {
    fetch(`${getApiBase()}/rooms`)
      .then((res) => {
        if (!res.ok) throw new Error("Errore nel caricamento delle aule.");
        return res.json();
      })
      .then((data) => {
        setAule(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAule();

    const token = localStorage.getItem("token");
    if (token) {
      fetch(`${getApiBase()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setUser(data))
        .catch(() => {});
    }
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return aule.filter(
      (a) =>
        (!q ||
          a.code.toLowerCase().includes(q) ||
          (a.responsible || "").toLowerCase().includes(q) ||
          (a.equipment || "").toLowerCase().includes(q)) &&
        (plessoFilter === "ALL" || a.plesso === plessoFilter) &&
        (typeFilter === "ALL" || a.room_type === typeFilter) &&
        (!onlyBookable || a.is_bookable)
    );
  }, [aule, search, plessoFilter, typeFilter, onlyBookable]);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Caricamento CSV (Supervisore)
  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${getApiBase()}/rooms/upload-csv`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Errore durante l'upload del file.");
      alert(data.message);
      fetchAule();
    } catch (err: any) {
      alert(err.message);
    } finally {
      e.target.value = "";
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (a: Room) => {
    setEditingId(a.id);
    setForm({
      code: a.code,
      room_type: a.room_type,
      plesso: a.plesso,
      is_bookable: a.is_bookable,
      free_schedule: a.free_schedule,
      responsible: a.responsible || "",
      technical_assistant: a.technical_assistant || "",
      equipment: a.equipment || "",
    });
    setShowModal(true);
  };

  // Creazione o modifica di un locale (Supervisore)
  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(editingId === null ? `${getApiBase()}/rooms` : `${getApiBase()}/rooms/${editingId}`, {
        method: editingId === null ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ...form,
          responsible: form.responsible.trim() || null,
          technical_assistant: form.technical_assistant.trim() || null,
          equipment: form.equipment.trim() || null,
          free_schedule: form.is_bookable && form.free_schedule,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Errore nel salvataggio del locale.");
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowModal(false);
      fetchAule();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (roomId: number) => {
    try {
      const res = await fetch(`${getApiBase()}/rooms/${roomId}/toggle`, { method: "PATCH", headers: authHeaders() });
      if (!res.ok) throw new Error("Errore nell'aggiornamento dello stato.");
      fetchAule();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteRoom = async (roomId: number, roomCode: string) => {
    if (!confirm(`Eliminare il locale ${roomCode}? Verranno eliminati anche i suoi ticket e le prenotazioni.`)) return;
    try {
      const res = await fetch(`${getApiBase()}/rooms/${roomId}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("Errore nell'eliminazione del locale.");
      fetchAule();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const countByPlesso = (p: string) => aule.filter((a) => a.plesso === p).length;

  return (
    <div className="space-y-6 w-full">
      {/* Intestazione */}
      <div className="border-b border-[var(--border-color)] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-main)] tracking-tight">Aule e Laboratori</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {aule.length} locali • {countByPlesso("SEDE_PRINCIPALE")} in Sede Principale, {countByPlesso("GIANELLI")} nel plesso
            Gianelli • {aule.filter((a) => a.is_bookable).length} prenotabili. Il codice indica piano/ala (A, B, C, I, G, R, P) e numero.
          </p>
        </div>

        {supervisor && (
          <div className="flex items-center gap-2">
            <label className="px-3 py-2 text-xs font-semibold bg-[var(--bg-subtle)] hover:opacity-80 border border-[var(--border-color)] text-[var(--text-main)] rounded-lg cursor-pointer transition shadow-sm">
              Importa CSV
              <input type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
            </label>
            <button
              onClick={openCreate}
              className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow-sm"
            >
              + Nuovo Locale
            </button>
          </div>
        )}
      </div>

      {/* Filtri */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)]">
        <div className="col-span-2 md:col-span-1">
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Cerca</label>
          <input
            type="text"
            placeholder="Codice, responsabile, dotazione..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Plesso</label>
          <select value={plessoFilter} onChange={(e) => setPlessoFilter(e.target.value)} className={inputClass}>
            <option value="ALL">Tutti</option>
            {PLESSI.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-mono text-[var(--text-muted)] block mb-1">Tipo</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={inputClass}>
            <option value="ALL">Tutti</option>
            {ROOM_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <label className="flex items-end gap-2 pb-1.5 text-xs text-[var(--text-main)] cursor-pointer">
          <input type="checkbox" checked={onlyBookable} onChange={(e) => setOnlyBookable(e.target.checked)} />
          Solo prenotabili
        </label>
      </div>

      {loading && <div className="p-4 text-xs text-[var(--text-muted)] font-mono">Caricamento locali...</div>}

      {error && (
        <div className="p-4 text-xs bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded">{error}</div>
      )}

      {!loading && !error && aule.length === 0 && (
        <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg">
          Nessun locale registrato nel sistema.
        </div>
      )}

      {/* Tabella locali */}
      {!loading && aule.length > 0 && (
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[var(--text-main)]">
              <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <tr>
                  <th className="p-3 font-medium">Locale</th>
                  <th className="p-3 font-medium">Tipo</th>
                  <th className="p-3 font-medium">Plesso</th>
                  <th className="p-3 font-medium">Prenotabile</th>
                  <th className="p-3 font-medium">Ne risponde</th>
                  <th className="p-3 font-medium">Assistente tecnico</th>
                  <th className="p-3 font-medium">Dotazioni</th>
                  <th className="p-3 font-medium">Stato</th>
                  {supervisor && <th className="p-3 font-medium text-right">Azioni</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={supervisor ? 9 : 8} className="p-6 text-center text-[var(--text-muted)]">
                      Nessun locale corrisponde ai filtri.
                    </td>
                  </tr>
                ) : (
                  filtered.map((a) => (
                    <tr key={a.id} className={`hover:bg-[var(--bg-subtle)] transition ${a.is_active ? "" : "opacity-60"}`}>
                      <td className="p-3 font-semibold font-mono whitespace-nowrap">{a.code}</td>
                      <td className="p-3 whitespace-nowrap">{roomTypeLabel(a.room_type)}</td>
                      <td className="p-3 whitespace-nowrap text-[var(--text-muted)]">{plessoLabel(a.plesso)}</td>
                      <td className="p-3 whitespace-nowrap">
                        {a.is_bookable ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            Sì{a.free_schedule ? " · orario libero" : ""}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">{a.responsible || <span className="text-[var(--text-muted)]">—</span>}</td>
                      <td className="p-3 whitespace-nowrap">
                        {a.technical_assistant || <span className="text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="p-3 min-w-[220px]">
                        {splitEquipment(a.equipment).length === 0 ? (
                          <span className="text-[var(--text-muted)]">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {splitEquipment(a.equipment).map((d) => (
                              <span
                                key={d}
                                className="px-1.5 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-color)] text-[10px]"
                              >
                                {d}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono border rounded ${
                            a.is_active
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                              : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30"
                          }`}
                        >
                          {a.is_active ? "OPERATIVO" : "DISATTIVATO"}
                        </span>
                      </td>
                      {supervisor && (
                        <td className="p-3 text-right whitespace-nowrap space-x-1.5">
                          <button
                            onClick={() => openEdit(a)}
                            className="px-2 py-1 text-[11px] bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 rounded transition"
                          >
                            Modifica
                          </button>
                          <button
                            onClick={() => handleToggleStatus(a.id)}
                            className="px-2 py-1 text-[11px] bg-[var(--bg-subtle)] hover:opacity-80 text-[var(--text-main)] rounded border border-[var(--border-color)] transition"
                          >
                            {a.is_active ? "Disattiva" : "Attiva"}
                          </button>
                          <button
                            onClick={() => handleDeleteRoom(a.id, a.code)}
                            className="px-2 py-1 text-[11px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded transition"
                          >
                            Elimina
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Finestra modale di creazione (solo Supervisore) */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] p-6 rounded-xl max-w-md w-full space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-[var(--text-main)]">
              {editingId === null ? "Aggiungi Nuovo Locale" : `Modifica locale ${form.code}`}
            </h3>

            <form onSubmit={handleSaveRoom} className="space-y-3">
              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">Codice (lettera piano + numero, es. B11)</label>
                <input
                  type="text"
                  required
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--text-muted)] block mb-1">Tipo</label>
                  <select value={form.room_type} onChange={(e) => setForm({ ...form, room_type: e.target.value })} className={inputClass}>
                    {ROOM_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] block mb-1">Plesso</label>
                  <select value={form.plesso} onChange={(e) => setForm({ ...form, plesso: e.target.value })} className={inputClass}>
                    {PLESSI.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-5 text-xs text-[var(--text-main)]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_bookable}
                    onChange={(e) => setForm({ ...form, is_bookable: e.target.checked })}
                  />
                  Prenotabile
                </label>
                <label className={`flex items-center gap-2 ${form.is_bookable ? "cursor-pointer" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    disabled={!form.is_bookable}
                    checked={form.is_bookable && form.free_schedule}
                    onChange={(e) => setForm({ ...form, free_schedule: e.target.checked })}
                  />
                  Orario libero
                </label>
              </div>

              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">Ne risponde</label>
                <input
                  type="text"
                  placeholder="es. Ufficio tecnico, Cognome Nome"
                  value={form.responsible}
                  onChange={(e) => setForm({ ...form, responsible: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">Assistente tecnico</label>
                <input
                  type="text"
                  value={form.technical_assistant}
                  onChange={(e) => setForm({ ...form, technical_assistant: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1">Dotazioni (separate da · )</label>
                <input
                  type="text"
                  placeholder="es. PC cattedra · Lim / Monitor Touch"
                  value={form.equipment}
                  onChange={(e) => setForm({ ...form, equipment: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingId(null);
                  }}
                  className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded transition disabled:opacity-50"
                >
                  {submitting ? "Salvataggio..." : editingId === null ? "Salva Locale" : "Salva Modifiche"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
