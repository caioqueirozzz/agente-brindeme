/**
 * Log de cada chamada à API Brinde.me (entregável da Fase 2: "log de cada
 * chamada com status HTTP e duração").
 *
 * Separado do Logger de conversa porque a vida útil é outra: o cliente HTTP é
 * criado uma vez e atende todas as conversas. Escreve em logs/api.jsonl.
 *
 * Regra de segurança: a URL é gravada sem query string com valores, e nenhum
 * header entra no log — a chave da API nunca pode aparecer.
 */
import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

export interface ApiLogEntry {
  method: string;
  /** Caminho sem host e sem valores de query. */
  path: string;
  status?: number;
  duration_ms: number;
  attempt: number;
  error?: string;
  circuito?: string;
}

/** Remove host e valores de query, preservando só os nomes dos parâmetros. */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const chaves = [...u.searchParams.keys()];
    return chaves.length ? `${u.pathname}?${chaves.sort().join("&")}` : u.pathname;
  } catch {
    return "(url inválida)";
  }
}

export interface ApiLogger {
  log(entry: ApiLogEntry): void;
}

export class FileApiLogger implements ApiLogger {
  private readonly file: string;

  constructor(logsDir = join(__dir, "../../../logs")) {
    mkdirSync(logsDir, { recursive: true });
    this.file = join(logsDir, "api.jsonl");
  }

  log(entry: ApiLogEntry): void {
    try {
      appendFileSync(
        this.file,
        JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n",
        "utf-8"
      );
    } catch {
      // não-fatal
    }
  }
}

/** Para testes e para quem não quiser escrever em disco. */
export class MemoryApiLogger implements ApiLogger {
  public readonly entries: ApiLogEntry[] = [];
  log(entry: ApiLogEntry): void {
    this.entries.push(entry);
  }
}
