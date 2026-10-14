import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { LLMProvider, LLMMessage } from "../llm/types.js";
import type { ConversationState } from "./state.js";
import { addMessage } from "./state.js";
import { tools, toolMap } from "../tools/index.js";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { Logger } from "../logging/logger.js";
import {
  translateApiError,
  isFalhaApi,
  exigeTransferenciaImediata,
} from "../integrations/brindeme/errors.js";
import { config } from "../config.js";

const __dir = dirname(fileURLToPath(import.meta.url));

/** Falhas de API seguidas antes de instruir transferência (decisão técnica #6 do README). */
const FALHAS_PARA_TRANSFERIR = 2;

function loadSystemPrompt(state: ConversationState): string {
  const template = readFileSync(join(__dir, "prompt/system.md"), "utf-8");
  const stateForPrompt = {
    modo: state.modo,
    cliente: state.cliente,
    necessidade: state.necessidade,
    artes_registradas: state.artes.length,
    orcamentos_criados: state.orcamentos,
    produtos_discutidos: state.produtosDiscutidos,
    orcamento_pendente_expirado: state.orcamentoPendente
      ? new Date() > new Date(state.orcamentoPendente.expiraEm)
      : undefined,
  };

  return template
    .replace("{{ASSISTANT_NAME}}", config.assistantName)
    .replace(/\{\{STORE_NAME\}\}/g, config.storeName)
    .replace("{{ESTADO}}", JSON.stringify(stateForPrompt, null, 2));
}

export interface TurnResult {
  response: string | null;
  toolsCalled: Array<{ name: string; inputSummary: string }>;
  transferred: boolean;
}

export async function runTurn(
  userMessage: string,
  state: ConversationState,
  llm: LLMProvider,
  client: BrindeMeClient,
  logger: Logger
): Promise<TurnResult> {
  logger.log({ type: "message_received", role: "user", content: userMessage });
  addMessage(state, "user", userMessage);

  if (state.modo === "humano") {
    logger.log({ type: "state_change", change: "message_in_human_mode_ignored" });
    return { response: null, toolsCalled: [], transferred: false };
  }

  const systemPrompt = loadSystemPrompt(state);

  const llmTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  // Build messages array from history (last 20 turns)
  const historyMessages: LLMMessage[] = state.historico
    .slice(-40)
    .slice(0, -1) // exclude the message we just added (re-added below)
    .map((m) => ({ role: m.role, content: m.content }));

  const messages: LLMMessage[] = [
    ...historyMessages,
    { role: "user", content: userMessage },
  ];

  const toolsCalled: Array<{ name: string; inputSummary: string }> = [];
  let transferred = false;
  /** Itens da base de conhecimento usados neste turno (auditoria da Fase 3). */
  const kbItens = new Set<string>();

  // Agentic loop
  let continueLoop = true;
  while (continueLoop) {
    const response = await llm.chat({
      system: systemPrompt,
      messages,
      tools: llmTools,
      model: config.llmModel,
    });

    if (response.stop_reason === "tool_use") {
      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      const toolResults: LLMMessage["content"] = [];
      if (!Array.isArray(toolResults)) throw new Error("unreachable");

      for (const block of assistantContent) {
        if (block.type !== "tool_use") continue;

        const toolName = block.name!;
        const toolInput = block.input;
        const toolId = block.id!;
        const toolDef = toolMap.get(toolName);

        const inputSummary = JSON.stringify(toolInput).slice(0, 120);
        toolsCalled.push({ name: toolName, inputSummary });

        const start = Date.now();
        let output: unknown;
        let error: string | undefined;

        if (!toolDef) {
          output = { erro: "ferramenta_nao_encontrada" };
          error = "unknown_tool";
        } else {
          try {
            output = await toolDef.handler(toolInput, state, client);
          } catch (err) {
            output = { erro: translateApiError(err) };
            error = String(err);
          }
        }

        // Contagem centralizada de falhas de infraestrutura. Antes cada tool
        // engolia o erro internamente e o contador nunca subia, então a regra
        // "2 falhas seguidas → transferir" só funcionava em criar_orcamento.
        if (isFalhaApi(output)) {
          state.falhasConsecutivas += 1;
          const erro = (output as { erro?: { erro?: string; alerta?: boolean } }).erro;

          // 401/403 e 412 não esperam a segunda falha (tabela de falhas da Fase 2).
          const imediato = exigeTransferenciaImediata(output);
          if (imediato || state.falhasConsecutivas >= FALHAS_PARA_TRANSFERIR) {
            output = {
              ...(output as object),
              instrucao: "transferir",
              motivo_sugerido: "falha_sistema",
            };
          }
          if (erro?.alerta) {
            logger.log({
              type: "alerta",
              gravidade: "critica",
              motivo: erro.erro ?? "falha_api",
              ferramenta: toolName,
            });
          }
        } else {
          state.falhasConsecutivas = 0;
        }

        logger.log({
          type: "tool_call",
          name: toolName,
          input: toolInput,
          output,
          duration_ms: Date.now() - start,
          error,
        });

        if (toolName === "consultar_conhecimento") {
          const o = output as { resultado?: string; itens?: Array<{ id: string }> };
          const ids = o.itens?.map((i) => i.id) ?? [];
          for (const id of ids) kbItens.add(id);
          logger.log({
            type: "kb_consulta",
            pergunta: String((toolInput as { pergunta?: unknown })?.pergunta ?? ""),
            itens: ids,
            resultado: o.resultado === "encontrado" ? "encontrado" : "lacuna",
          });
        }

        if (toolName === "transferir_humano") {
          transferred = true;
        }

        (toolResults as Array<{ type: string; tool_use_id: string; content: string }>).push({
          type: "tool_result",
          tool_use_id: toolId,
          content: JSON.stringify(output),
        });
      }

      messages.push({ role: "user", content: toolResults });
    } else {
      // end_turn or max_tokens
      const textBlocks = response.content.filter((b) => b.type === "text");
      const text = textBlocks.map((b) => b.text ?? "").join("\n").trim();

      logger.log({
        type: "response_sent",
        content: text,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        ...(kbItens.size > 0 ? { kb_itens: [...kbItens] } : {}),
      });

      addMessage(state, "assistant", text);
      continueLoop = false;

      return { response: text, toolsCalled, transferred };
    }
  }

  return { response: null, toolsCalled, transferred };
}
