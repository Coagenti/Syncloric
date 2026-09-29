import type { NextConfig } from "next";

// Monolite full-stack: output `standalone` per l'immagine Docker minimal
// (docs/ARCHITECTURE.md § 2, docker/Dockerfile).
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;