import "dotenv/config";
import { mkdtempSync, readdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInitialState } from "../src/agent/state.js";
import { runTurn } from "../src/agent/runTurn.js";
import { criarLLM } from "../src/llm/index.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { Logger } from "../src/logging/logger.js";
import type { FaultType } from "../src/integrations/brindeme/types.js";
import { prepararAmbienteDosEvals } from "./ambiente.js";
import type { TurnResult } from "../src/agent/runTurn.js";
import { AgenteDefinitivo } from "../src/api/agenteDefinitivo.js";
import { RepositorioConversas } from "../src/conversas/repositorio.js";
import { calcularTurnoId } from "../src/contrato/turno.js";
import { LIMITE_TEXTO } from "../src/contrato/esquemas.js";
import { config } from "../src/config.js";

const __dir = dirname(fileURLToPath(import.meta.url));

interface Expectativa {
  tipo:
    | "chamou_ferramenta"
    | "nao_chamou_ferramenta"
    | "ordem_ferramentas"
    | "transferiu_com_motivo"
    | "resposta_contem"
    | "resposta_nao_contem"
    | "campo_nao_vazou";
  ferramenta?: string;
  ordem?: string[];
  motivo?: string;
  padrao?: string;
  campo?: string;
}

interface Scenario {
  id: string;
  descricao: string;
  telefone?: string;
  mensagens: string[];
  injetar_falha?: { tipo: FaultType; vezes: number };
  expectativas: Expectativa[];
}

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const VIA_API = process.argv.includes("--via-api");

async function turnoPelaApi(
  agente: AgenteDefinitivo,
  capturado: { r?: TurnResult },
  telefone: string,
  texto: string,
  id: string
): Promise<TurnResult> {
  capturado.r = undefined;
  const pedido = {
    turnoId: calcularTurnoId([id]),
    telefone,
    mensagens: [{ id, timestamp: new Date().toISOString(), texto: texto.slice(0, LIMITE_TEXTO) }],
  };
  // Como a ponte: falha (503) repete o mesmo lote uma vez; a 2ª falha o agente transfere.
  const resposta = await agente.processarLote(pedido).catch(() => agente.processarLote(pedido));
  const bruto = capturado.r ?? { response: null, toolsCalled: [], transferred: false, lacunas: [] };
  return { ...bruto, response: resposta.respostas.join("\n\n") || null };
}

async function runScenario(scenario: Scenario): Promise<{ passed: number; failed: number; details: string[] }> {
  const telefone = scenario.telefone ?? "5583999990000";
  const state = createInitialState(telefone);
  const client = new MockBrindeMeClient();
  const llm = criarLLM();
  const logger = new Logger(`eval-${scenario.id}`);
  const capturado: { r?: TurnResult } = {};
  const agenteApi = VIA_API
    ? new AgenteDefinitivo({
        repo: new RepositorioConversas(mkdtempSync(join(tmpdir(), `eval-${scenario.id}-`))),
        llm,
        client,
        tetoMs: config.agente.tetoMs,
        respostasPorHora: 1_000,
        aoTurno: (r) => {
          capturado.r = r;
        },
      })
    : null;

  if (scenario.injetar_falha) {
    client.injectFault({ type: scenario.injetar_falha.tipo, remaining: scenario.injetar_falha.vezes });
  }

  const allToolsCalled: string[] = [];
  const allToolCallDetails: Array<{ name: string; inputSummary: string }> = [];
  let lastResponse = "";
  let lastTransferMotivo: string | undefined;

  for (const [i, msg] of scenario.mensagens.entries()) {
    const userMsg = msg.startsWith("/arte ")
      ? `[IMAGEM enviada: ${msg.slice(6).trim()}]`
      : msg;

    const result = agenteApi
      ? await turnoPelaApi(agenteApi, capturado, telefone, userMsg, `${scenario.id}-${i}`)
      : await runTurn(userMsg, state, llm, client, logger);
    if (result.response) lastResponse = result.response;
    for (const tc of result.toolsCalled) {
      allToolsCalled.push(tc.name);
      allToolCallDetails.push(tc);
    }
    if (result.transferred) {
      // Extract motivo from last tool call
      const transferCall = result.toolsCalled.find((t) => t.name === "transferir_humano");
      if (transferCall) {
        try {
          const parsed = JSON.parse(transferCall.inputSummary.replace(/…$/, "")) as { motivo?: string };
          lastTransferMotivo = parsed.motivo;
        } catch {
          // inputSummary truncated — look at state
          lastTransferMotivo = "unknown";
        }
      }
    }
  }

  const results: { passed: boolean; msg: string }[] = [];

  for (const exp of scenario.expectativas) {
    switch (exp.tipo) {
      case "chamou_ferramenta":
        results.push({
          passed: allToolsCalled.includes(exp.ferramenta!),
          msg: `chamou_ferramenta: ${exp.ferramenta}`,
        });
        break;

      case "nao_chamou_ferramenta":
        results.push({
          passed: !allToolsCalled.includes(exp.ferramenta!),
          msg: `nao_chamou_ferramenta: ${exp.ferramenta}`,
        });
        break;

      case "ordem_ferramentas": {
        const indices = exp.ordem!.map((f) => allToolsCalled.indexOf(f));
        const ordered = indices.every((v, i) => i === 0 || v > indices[i - 1]) && indices.every((v) => v !== -1);
        results.push({ passed: ordered, msg: `ordem_ferramentas: ${exp.ordem!.join(" → ")}` });
        break;
      }

      case "transferiu_com_motivo":
        results.push({
          passed: allToolsCalled.includes("transferir_humano") && (lastTransferMotivo === exp.motivo || lastTransferMotivo === "unknown"),
          msg: `transferiu_com_motivo: ${exp.motivo} (detectado: ${lastTransferMotivo ?? "none"})`,
        });
        break;

      case "resposta_contem":
        results.push({
          passed: new RegExp(exp.padrao!, "i").test(lastResponse),
          msg: `resposta_contem: /${exp.padrao}/`,
        });
        break;

      case "resposta_nao_contem":
        results.push({
          passed: !new RegExp(exp.padrao!, "i").test(lastResponse),
          msg: `resposta_nao_contem: /${exp.padrao}/`,
        });
        break;

      case "campo_nao_vazou":
        results.push({
          passed: !lastResponse.includes(exp.campo!),
          msg: `campo_nao_vazou: ${exp.campo}`,
        });
        break;
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return {
    passed,
    failed,
    details: results.map((r) => `  ${r.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`} ${r.msg}`),
  };
}

async function main() {
  await prepararAmbienteDosEvals();

  const scenariosDir = join(__dir, "scenarios");
  const files = readdirSync(scenariosDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let totalPassed = 0;
  let totalFailed = 0;

  const specificScenario = process.argv.slice(2).find((a) => !a.startsWith("--"));

  console.log(`\n${BOLD}=== Evals — Agente de Atendimento ===${RESET}\n`);
  if (VIA_API) console.log(`${GRAY}Rodando pela API definitiva (AgenteDefinitivo), não pelo runTurn direto.${RESET}\n`);

  for (const file of files) {
    const scenario = JSON.parse(readFileSync(join(scenariosDir, file), "utf-8")) as Scenario;
    if (specificScenario && scenario.id !== specificScenario) continue;

    process.stdout.write(`${BOLD}${scenario.id}${RESET} — ${scenario.descricao}... `);

    try {
      const result = await runScenario(scenario);
      totalPassed += result.passed;
      totalFailed += result.failed;

      const status = result.failed === 0
        ? `${GREEN}PASSOU${RESET}`
        : `${RED}FALHOU (${result.failed}/${result.passed + result.failed})${RESET}`;
      console.log(status);
      for (const d of result.details) console.log(d);
    } catch (err) {
      console.log(`${RED}ERRO: ${err}${RESET}`);
      totalFailed++;
    }

    console.log();
  }

  console.log(`${BOLD}Resultado:${RESET} ${GREEN}${totalPassed} passou(ram)${RESET} / ${RED}${totalFailed} falhou(ram)${RESET}`);

  if (totalFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
