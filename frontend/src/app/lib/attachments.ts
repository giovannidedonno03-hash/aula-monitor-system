import { getApiBase, TicketAttachment } from "./constants";

export const MAX_PHOTOS_PER_TICKET = 10;
const MAX_SIDE = 1600; // lato massimo della foto dopo la compressione (px)

function token(): Record<string, string> {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Riduce la foto (al massimo 1600 px di lato, JPEG qualita' 82%) prima di inviarla:
 * le foto del telefono passano da 3-8 MB a poche centinaia di KB.
 * Se il browser non riesce a leggerla, si invia l'originale e decide il server.
 */
export async function compressImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Comprime e carica una foto sul ticket */
export async function uploadTicketPhoto(ticketId: number, file: File): Promise<TicketAttachment> {
  const blob = await compressImage(file);
  const name = blob === file ? file.name : file.name.replace(/\.[^.]+$/, "") + ".jpg";
  const form = new FormData();
  form.append("file", blob, name);
  const res = await fetch(`${getApiBase()}/tickets/${ticketId}/attachments`, {
    method: "POST",
    headers: token(),
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.detail === "string" ? data.detail : `Impossibile caricare ${file.name}.`);
  }
  return res.json();
}

/**
 * Le foto sono protette dal login: non basta un <img src>, bisogna scaricarle con il token
 * e mostrarle tramite un indirizzo locale (blob:). Ricordarsi di liberarlo con URL.revokeObjectURL.
 */
export async function loadPhotoUrl(ticketId: number, attachmentId: number): Promise<string> {
  const res = await fetch(`${getApiBase()}/tickets/${ticketId}/attachments/${attachmentId}`, { headers: token() });
  if (!res.ok) throw new Error("Foto non disponibile.");
  return URL.createObjectURL(await res.blob());
}
