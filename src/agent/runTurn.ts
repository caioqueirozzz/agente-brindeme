import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { LLMProvider, LLMMessage } from "../llm/types.js";
import type { ConversationState, Mensagem } from "./state.js";
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
import type { ResumoTransferencia } from "../tools/transferirHumano.js";

const __dir = dirname(fileURLToPath(import.meta.url));

/** Falhas de API seguidas antes de instruir transferência (decisão técnica #6 do README). */
const FALHAS_PARA_TRANSFERIR = 2;

/** Modelo que não para de chamar ferramenta trava o turno para sempre; passou disto, o turno falha. */
export const MAX_RODADAS_DE_FERRAMENTA = 10;

/** Mensagens do histórico mandadas ao modelo (contando a nova). */
const JANELA_HISTORICO = 40;
const ABERTURA_DO_TRECHO = "[início do trecho da conversa]";

/**
 * Ferramenta → status de sucesso que muda a loja ou o estado e precisa ser salvo na hora.
 * Ferramenta com efeito termina mesmo com o turno cancelado: abandonada no meio, a loja ficaria sem saber.
 */
const EFEITOS: Record<string, string> = {
  criar_orcamento: "criado",
  registrar_arte: "arte_registrada",
  transferir_humano: "transferido",
};

/** A API do modelo recusa mensagem vazia, dois papéis iguais seguidos e conversa que começa pela resposta. */
export function montarJanela(historico: Mensagem[], userMessage: string): LLMMessage[] {
  const janela: Array<{ role: Mensagem["role"]; content: string }> = [];
  for (const m of [...historico.slice(-JANELA_HISTORICO, -1), { role: "user" as const, content: userMessage }]) {
    if (!m.content.trim()) continue;
    const anterior = janela.at(-1);
    if (anterior?.role === m.role) anterior.content += `\n\n${m.content}`;
    else janela.push({ role: m.role, content: m.content });
  }
  if (janela[0]?.role === "assistant") janela.unshift({ role: "user", content: ABERTURA_DO_TRECHO });
  return janela;
}

/** Provedor ou ferramenta que ignora o sinal não segura o turno depois do cancelamento. */
function esperarOuCancelar<T>(promessa: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promessa;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aoCancelar = () => reject(signal.reason);
    signal.addEventListener("abort", aoCancelar, { once: true });
    promessa.then(
      (v) => {
        signal.removeEventListener("abort", aoCancelar);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", aoCancelar);
        reject(e);
      }
    );
  });
}

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
  /** Resumo devolvido por transferir_humano quando a transferência aconteceu. */
  transferencia?: ResumoTransferencia;
  /** Perguntas que a base de conhecimento não cobriu neste turno. */
  lacunas: string[];
}

export interface OpcoesTurno {
  /** Conferido antes de cada chamada ao modelo e de cada ferramenta. */
  signal?: AbortSignal;
  /** Chamado logo depois de uma ferramenta com efeito (orçamento criado, arte registrada, transferência). */
  aoEfeito?: () => void;
  /** Chamado na transferência, antes de aoEfeito: quem chamou fica sabendo mesmo que o turno falhe depois. */
  aoTransferir?: (resumo: ResumoTransferencia, lacunas: string[]) => void;
}

export async function runTurn(
  userMessage: string,
  state: ConversationState,
  llm: LLMProvider,
  client: BrindeMeClient,
  logger: Logger,
  opcoes: OpcoesTurno = {}
): Promise<TurnResult> {
  logger.log({ type: "message_received", role: "user", content: userMessage });
  addMessage(state, "user", userMessage);

  if (state.modo === "humano") {
    logger.log({ type: "state_change", change: "message_in_human_mode_ignored" });
    return { response: null, toolsCalled: [], transferred: false, lacunas: [] };
  }

  const systemPrompt = loadSystemPrompt(state);

  const llmTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  const messages = montarJanela(state.historico, userMessage);

  const toolsCalled: Array<{ name: string; inputSummary: string }> = [];
  let transferred = false;
  let transferencia: ResumoTransferencia | undefined;
  const lacunas: string[] = [];
  /** Itens da base de conhecimento usados neste turno (auditoria da Fase 3). */
  const kbItens = new Set<string>();
  const resultado = (response: string | null): TurnResult => ({
    response,
    toolsCalled,
    transferred,
    lacunas,
    ...(transferencia ? { transferencia } : {}),
  });

  // Agentic loop
  let continueLoop = true;
  let rodadas = 0;
  while (continueLoop) {
    opcoes.signal?.throwIfAborted();
    if (++rodadas > MAX_RODADAS_DE_FERRAMENTA) {
      logger.log({ type: "alerta", gravidade: "alta", motivo: "rodadas_de_ferramenta_demais" });
      throw new Error(`turno passou de ${MAX_RODADAS_DE_FERRAMENTA} rodadas de ferramenta`);
    }
    const response = await esperarOuCancelar(
      llm.chat({
        system: systemPrompt,
        messages,
        tools: llmTools,
        model: config.llmModel,
        signal: opcoes.signal,
      }),
      opcoes.signal
    );

    if (response.stop_reason === "tool_use") {
      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      const toolResults: LLMMessage["content"] = [];
      if (!Array.isArray(toolResults)) throw new Error("unreachable");

      for (const block of assistantContent) {
        if (block.type !== "tool_use") continue;
        opcoes.signal?.throwIfAborted();

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
            const execucao = toolDef.handler(toolInput, state, client);
            output = EFEITOS[toolName] !== undefined ? await execucao : await esperarOuCancelar(execucao, opcoes.signal);
          } catch (err) {
            opcoes.signal?.throwIfAborted();
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
          const pergunta = String((toolInput as { pergunta?: unknown })?.pergunta ?? "");
          const ids = o.itens?.map((i) => i.id) ?? [];
          for (const id of ids) kbItens.add(id);
          if (o.resultado !== "encontrado") lacunas.push(pergunta);
          logger.log({
            type: "kb_consulta",
            pergunta,
            itens: ids,
            resultado: o.resultado === "encontrado" ? "encontrado" : "lacuna",
          });
        }

        if (toolName === "transferir_humano") {
          transferred = true;
          const o = output as { status?: string; resumo_para_atendente?: ResumoTransferencia };
          if (o.status === "transferido" && o.resumo_para_atendente) {
            transferencia = o.resumo_para_atendente;
            opcoes.aoTransferir?.(transferencia, [...lacunas]);
          }
        }

        const status = (output as { status?: unknown } | null)?.status;
        if (EFEITOS[toolName] !== undefined && status === EFEITOS[toolName]) opcoes.aoEfeito?.();

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

      if (text) addMessage(state, "assistant", text);
      continueLoop = false;

      return resultado(text);
    }
  }

  return resultado(null);
}
