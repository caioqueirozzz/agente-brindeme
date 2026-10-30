import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const logsDir = join(__dir, "../../logs");

mkdirSync(logsDir, { recursive: true });

type LogEvent =
  | { type: "message_received"; role: "user" | "assistant"; content: string }
  | { type: "tool_call"; name: string; input: unknown; output: unknown; duration_ms: number; error?: string }
  | {
      type: "response_sent";
      content: string;
      input_tokens?: number;
      output_tokens?: number;
      /** Ids dos itens da base de conhecimento consultados neste turno (auditoria, Fase 3). */
      kb_itens?: string[];
    }
  | { type: "kb_consulta"; pergunta: string; itens: string[]; resultado: "encontrado" | "lacuna" }
  | { type: "transfer"; motivo: string; prioridade: string }
  | { type: "state_change"; change: string }
  | { type: "alerta"; gravidade: "critica" | "alta"; motivo: string; ferramenta?: string };

function maskCpf(s: string): string {
  return s.replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, (m) => `***.***.***-${m.slice(-2)}`);
}

function maskEmail(s: string): string {
  return s.replace(/([a-zA-Z0-9._%+-]{1})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+)/g, "$1***@$2");
}

function maskPhone(s: string): string {
  return (
    s
      // Formatado, como o cliente digita: (83) 99999-0000, 83 99999-0000, 99999-0000, 3333-4444.
      .replace(
        /(?<!\d)(?:(?:\(\d{2}\)\s?|\d{2}\s)?9?\d{4}-\d{4}|\(\d{2}\)\s?9?\d{4}\s?\d{4})(?!\d)/g,
        "*****-****"
      )
      // Só dígitos, com DDI (5583999990000): mantém 4 no início e no fim.
      .replace(/(\d{4})\d{5,7}(\d{4})/g, "$1*****$2")
      // Só dígitos, nacional (83999990000, 8333334444): 10 ou 11 dígitos isolados.
      .replace(/(?<!\d)(\d{2})\d{6,7}(\d{2})(?!\d)/g, "$1*****$2")
  );
}

/** Mascara CPF, e-mail e telefone num texto solto (pergunta de cliente, por exemplo). */
export function mascararTexto(s: string): string {
  return maskPhone(maskEmail(maskCpf(s)));
}

function maskSensitive(obj: unknown): unknown {
  const json = JSON.stringify(obj);
  return JSON.parse(maskPhone(maskEmail(maskCpf(json))));
}

export class Logger {
  private logFile: string;

  constructor(
    conversaId: string,
    private readonly contexto: Record<string, string> = {}
  ) {
    this.logFile = join(logsDir, `${conversaId}.jsonl`);
  }

  log(event: LogEvent): void {
    const entry = {
      timestamp: new Date().toISOString(),
      ...this.contexto,
      ...maskSensitive(event) as object,
    };
    try {
      appendFileSync(this.logFile, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // non-fatal
    }
  }
}
