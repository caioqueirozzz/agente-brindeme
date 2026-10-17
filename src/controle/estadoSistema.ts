import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ARQUIVO_PADRAO = join(__dir, "../../data/estado-sistema.json");

const CACHE_MS = 30_000;

export interface EstadoSistema {
  suspenso: boolean;
  suspensoPor?: string;
  suspensoEm?: string;
  /** Ferramentas desligadas em runtime (complementa FERRAMENTAS_DESLIGADAS do .env). */
  ferramentasDesligadas?: string[];
}

let cache: { estado: EstadoSistema; lido: number } | null = null;

export function lerEstadoSistema(arquivo = ARQUIVO_PADRAO): EstadoSistema {
  const agora = Date.now();
  if (cache && agora - cache.lido < CACHE_MS) return cache.estado;
  try {
    if (!existsSync(arquivo)) {
      cache = { estado: { suspenso: false }, lido: agora };
      return cache.estado;
    }
    const parsed = JSON.parse(readFileSync(arquivo, "utf-8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Record<string, unknown>).suspenso !== "boolean"
    ) {
      throw new Error("formato inválido");
    }
    const estado = parsed as EstadoSistema;
    cache = { estado, lido: agora };
    return estado;
  } catch {
    cache = { estado: { suspenso: false }, lido: agora };
    return cache.estado;
  }
}

export function escreverEstadoSistema(estado: EstadoSistema, arquivo = ARQUIVO_PADRAO): void {
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, JSON.stringify(estado, null, 2), "utf-8");
  cache = { estado, lido: Date.now() };
}

/** Força releitura do disco na próxima chamada. Usado nos testes. */
export function invalidarCache(): void {
  cache = null;
}
