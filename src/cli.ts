import "dotenv/config";
import * as readline from "readline";
import { createInitialState } from "./agent/state.js";
import { runTurn } from "./agent/runTurn.js";
import { AnthropicProvider } from "./llm/anthropic.js";
import { MockBrindeMeClient } from "./integrations/brindeme/mockClient.js";
import { createBrindeMeClient } from "./integrations/brindeme/factory.js";
import { Logger } from "./logging/logger.js";
import { config } from "./config.js";
import type { FaultType } from "./integrations/brindeme/types.js";
import { FileProductIndexStore } from "./catalogo/indice.js";
import { garantirIndice } from "./catalogo/garantirIndice.js";
import { carregarBase } from "./knowledge/base.js";

const GRAY = "\x1b[90m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function parseArgs(): { telefone: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--telefone");
  if (idx !== -1 && args[idx + 1]) {
    return { telefone: args[idx + 1] };
  }
  return { telefone: "5583999990000" };
}

/** Estado da base de conhecimento e do índice de catálogo, antes de abrir a conversa. */
async function avisarConhecimentoECatalogo(client: ReturnType<typeof createBrindeMeClient>) {
  const { base, problemas } = carregarBase({ incluirRascunhos: config.conhecimento.incluirRascunhos });
  const e = base.estatisticas();
  console.log(
    `${GRAY}Base de conhecimento: ${e.servidos} item(ns) servido(s) de ${e.total} · ${e.aprovados} aprovado(s), ${e.rascunhos} em rascunho${RESET}`
  );
  if (config.conhecimento.incluirRascunhos) {
    console.log(`${YELLOW}! KB_INCLUIR_RASCUNHOS=true — respostas usam texto NÃO aprovado. Só para desenvolvimento.${RESET}`);
  } else if (e.aprovados === 0) {
    console.log(`${YELLOW}! nenhum item aprovado: dúvidas gerais viram lacuna e transferem. Veja: npm run kb:validar${RESET}`);
  }
  for (const p of problemas) console.log(`${YELLOW}! ${p.arquivo}${p.item ? ` · ${p.item}` : ""}: ${p.mensagem}${RESET}`);

  try {
    const s = await garantirIndice(client, new FileProductIndexStore(), {
      autoSincronizar: config.brindeMe.mode === "mock",
    });
    if (s.situacao === "vazio") {
      console.log(`${YELLOW}! índice de catálogo vazio — buscar_produtos vai falhar. Rode: npm run sync:catalogo${RESET}`);
    } else if (s.situacao === "antigo") {
      console.log(`${YELLOW}! índice de catálogo com ${Math.round(s.idadeHoras)}h (${s.produtos} produtos) — o job de sincronização está rodando?${RESET}`);
    } else if (s.situacao === "sincronizado") {
      console.log(`${GRAY}Índice de catálogo montado a partir dos mocks: ${s.produtos} produto(s)${RESET}`);
    } else {
      console.log(`${GRAY}Índice de catálogo: ${s.produtos} produto(s), sincronizado há ${s.idadeHoras < 1 ? "menos de 1" : Math.round(s.idadeHoras)}h${RESET}`);
    }
  } catch (err) {
    console.log(`${YELLOW}! não foi possível preparar o índice de catálogo: ${err instanceof Error ? err.message : err}${RESET}`);
  }
  console.log();
}

async function main() {
  const { telefone } = parseArgs();
  const client = createBrindeMeClient();
  const llm = new AnthropicProvider();
  let state = createInitialState(telefone);
  let logger = new Logger(state.conversaId);

  console.log(`${BOLD}${CYAN}=== Agente de Atendimento — Terminal ===${RESET}`);
  console.log(`${GRAY}Telefone: ${telefone} · API: ${config.brindeMe.mode}${RESET}`);
  console.log(`${GRAY}Comandos: /arte <arquivo>, /estado, /falha <tipo> [n], /humano, /retomar [nota], /reset, /sair${RESET}`);
  console.log(`${GRAY}────────────────────────────────────────${RESET}\n`);

  await avisarConhecimentoECatalogo(client);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => rl.question(`${BOLD}Você:${RESET} `, handleInput);

  async function handleInput(input: string) {
    const trimmed = input.trim();
    if (!trimmed) { prompt(); return; }

    // CLI commands
    if (trimmed === "/sair") {
      console.log(`${GRAY}Encerrando...${RESET}`);
      rl.close();
      process.exit(0);
    }

    if (trimmed === "/reset") {
      state = createInitialState(telefone);
      logger = new Logger(state.conversaId);
      console.log(`${GRAY}[Nova conversa iniciada: ${state.conversaId}]${RESET}\n`);
      prompt();
      return;
    }

    if (trimmed === "/estado") {
      console.log(`${GRAY}${JSON.stringify(state, null, 2)}${RESET}\n`);
      prompt();
      return;
    }

    if (trimmed.startsWith("/arte ")) {
      const arquivo = trimmed.slice(6).trim();
      const userMsg = `[IMAGEM enviada: ${arquivo}]`;
      await processMessage(userMsg);
      return;
    }

    if (trimmed.startsWith("/falha ")) {
      const parts = trimmed.split(/\s+/);
      const tipo = parts[1] as FaultType;
      const n = parseInt(parts[2] ?? "1", 10);
      const validTypes: FaultType[] = ["timeout", "500", "404", "412", "422"];
      if (!validTypes.includes(tipo)) {
        console.log(`${GRAY}Tipos válidos: ${validTypes.join(", ")}${RESET}\n`);
      } else if (client instanceof MockBrindeMeClient) {
        client.injectFault({ type: tipo, remaining: n });
        console.log(`${GRAY}[Falha "${tipo}" injetada por ${n} chamada(s)]${RESET}\n`);
      } else {
        console.log(`${GRAY}[/falha só funciona com BRINDEME_MODE=mock]${RESET}\n`);
      }
      prompt();
      return;
    }

    if (trimmed === "/humano") {
      state.modo = "humano";
      console.log(`${YELLOW}[Atendente assumiu a conversa. Use /retomar para devolver à IA.]${RESET}\n`);
      prompt();
      return;
    }

    if (trimmed.startsWith("/retomar")) {
      const nota = trimmed.slice(8).trim();
      state.modo = "ia";
      const notaMsg = nota
        ? `[Atendente retornou o atendimento com nota: "${nota}"]`
        : "[Atendente retornou o atendimento para a IA]";
      console.log(`${GRAY}${notaMsg}${RESET}\n`);
      await processMessage(notaMsg);
      return;
    }

    await processMessage(trimmed);
  }

  async function processMessage(userMsg: string) {
    try {
      const result = await runTurn(userMsg, state, llm, client, logger);

      if (result.toolsCalled.length > 0) {
        console.log(`${GRAY}[Ferramentas: ${result.toolsCalled.map((t) => `${t.name}(${t.inputSummary.slice(0, 60)})`).join(" → ")}]${RESET}`);
      }

      if (result.response === null) {
        console.log(`${YELLOW}[IA pausada — mensagem encaminhada ao atendente]${RESET}\n`);
      } else {
        console.log(`\n${BOLD}${config.assistantName ?? "Agente"}:${RESET} ${result.response}\n`);
      }

      if (result.transferred) {
        console.log(`${YELLOW}[Conversa transferida para atendente humano]${RESET}\n`);
      }
    } catch (err) {
      console.error(`${YELLOW}[Erro ao processar mensagem: ${err}]${RESET}\n`);
    }

    prompt();
  }

  prompt();
}

main().catch(console.error);
