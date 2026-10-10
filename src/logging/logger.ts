import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const logsDir = join(__dir, "../../logs");

mkdirSync(logsDir, { recursive: true });

type LogEvent =
  | { type: "message_received"; role: "user" | "assistant"; content: string }
  | { type: "tool_call"; name: string; input: unknown; output: unknown; duration_ms: number; error?: string }
  | { type: "response_sent"; content: string; input_tokens?: number; output_tokens?: number }
  | { type: "transfer"; motivo: string; prioridade: string }
  | { type: "state_change"; change: string };

function maskCpf(s: string): string {
  return s.replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, (m) => `***.***.***-${m.slice(-2)}`);
}

function maskEmail(s: string): string {
  return s.replace(/([a-zA-Z0-9._%+-]{1})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+)/g, "$1***@$2");
}

function maskPhone(s: string): string {
  return s.replace(/(\d{4})\d{5,7}(\d{4})/g, "$1*****$2");
}

function maskSensitive(obj: unknown): unknown {
  const json = JSON.stringify(obj);
  return JSON.parse(maskPhone(maskEmail(maskCpf(json))));
}

export class Logger {
  private logFile: string;

  constructor(conversaId: string) {
    this.logFile = join(logsDir, `${conversaId}.jsonl`);
  }

  log(event: LogEvent): void {
    const entry = {
      timestamp: new Date().toISOString(),
      ...maskSensitive(event) as object,
    };
    try {
      appendFileSync(this.logFile, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // non-fatal
    }
  }
}
