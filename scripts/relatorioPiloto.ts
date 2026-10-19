/**
 * Números do piloto a partir de logs/*.jsonl (um arquivo por conversa).
 *
 *   npm run relatorio:piloto                          # tudo, na tela
 *   npm run relatorio:piloto -- --desde 2026-10-20    # a partir de uma data
 *   npm run relatorio:piloto -- --saida relatorio.md  # grava em arquivo
 *
 * Os eventos dos evals (eval-*.jsonl) ficam de fora.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { formatarRelatorio, resumirLogs, type EventoLog } from "../src/operacao/relatorio.js";

const args = process.argv.slice(2);
const valor = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const dir = join(process.cwd(), "logs");
const arquivos = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith(".jsonl") && f !== "api.jsonl" && !f.startsWith("eval-") && !f.startsWith("test-"))
  : [];

const conversas: EventoLog[][] = arquivos.map((f) =>
  readFileSync(join(dir, f), "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((linha) => {
      try {
        return [JSON.parse(linha) as EventoLog];
      } catch {
        return [];
      }
    })
);

const texto = formatarRelatorio(resumirLogs(conversas, valor("--desde")));
const saida = valor("--saida");
if (saida) {
  writeFileSync(saida, texto, "utf-8");
  console.log(`Relatório gravado em ${saida}`);
} else {
  console.log(texto);
}
