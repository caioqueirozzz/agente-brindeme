import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite carrega WASM e o pg tem binários opcionais: ficam fora do bundle
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // O repositório do agente tem outro package-lock na pasta de cima
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
