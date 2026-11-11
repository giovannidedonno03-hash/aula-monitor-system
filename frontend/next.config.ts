import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // In sviluppo Next.js accetta richieste solo da localhost: qui si autorizzano
  // gli altri dispositivi della rete locale (Smart TV, telefoni, altri PC).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  // Nasconde il pallino "N" di Next.js in basso a sinistra (si vedeva sulla Dashboard TV).
  // Gli errori di compilazione vengono comunque mostrati.
  devIndicators: false,
};

export default nextConfig;
