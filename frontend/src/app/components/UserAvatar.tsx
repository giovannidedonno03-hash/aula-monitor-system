"use client";

import { useState } from "react";

interface UserAvatarProps {
  picture?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number; // in pixel
}

// Stessi colori usati da Google per gli avatar con l'iniziale
const COLORS = ["#1a73e8", "#e8710a", "#188038", "#d93025", "#9334e6", "#007b83", "#c5221f", "#b06000"];

function colorFor(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

/**
 * Foto profilo Google. referrerPolicy="no-referrer" e' necessario: senza, Google
 * rifiuta di servire l'immagine a richieste provenienti da localhost/altri siti.
 * Se l'immagine non e' disponibile si mostra l'iniziale colorata, come fa Google.
 */
export default function UserAvatar({ picture, name, email, size = 36 }: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const label = (name || email || "U").trim();
  const style = { width: size, height: size };

  if (picture && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={picture}
        alt={label}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={style}
        className="rounded-full border border-[var(--border-color)] object-cover shadow-sm shrink-0"
      />
    );
  }

  return (
    <div
      style={{ ...style, backgroundColor: colorFor(email || label), fontSize: size * 0.45 }}
      className="rounded-full text-white font-medium flex items-center justify-center shadow-sm shrink-0 select-none"
      title={label}
    >
      {label.charAt(0).toUpperCase()}
    </div>
  );
}
