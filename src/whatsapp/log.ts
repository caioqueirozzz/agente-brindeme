import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { mascararTexto } from "../logging/logger.js";

export type LogPonte = (evento: Record<string, unknown>) => void;

const NO_TERMINAL = new Set([
  "lote_falhou",
  "envio_falhou",
  "evento_pendente",
  "varredura_falhou",
  "erro_ao_receber",
  "midia_nao_baixou",
  "mensagem_nao_convertida",
  "reconexao_falhou",
]);

export function criarLogPonte(dir = "logs"): LogPonte {
  mkdirSync(dir, { recursive: true });
  const arquivo = join(dir, "ponte.jsonl");
  return (evento) => {
    const linha = mascararTexto(JSON.stringify({ timestamp: new Date().toISOString(), ...evento }));
    try {
      appendFileSync(arquivo, `${linha}\n`, "utf-8");
    } catch {
      // log nunca derruba a ponte
    }
    if (NO_TERMINAL.has(String(evento.type))) console.warn(linha);
  };
}
