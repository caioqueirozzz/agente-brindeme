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
import {
  MENSAGEM_TRANSFERENCIA,
  MOTIVOS,
  transferirHumanoHandler,
  type MotivoTransferencia,
  type ResumoTransferencia,
} from "../tools/transferirHumano.js";

const __dir = dirname(fileURLToPath(import.meta.url));

/** Falhas de API seguidas antes de instruir transferência (decisão técnica #6 do README). */
const FALHAS_PARA_TRANSFERIR = 2;

/** Modelo que não para de chamar ferramenta trava o turno para sempre; passou disto, o turno falha. */
export const MAX_RODADAS_DE_FERRAMENTA = 10;

/** Mensagens do histórico mandadas ao modelo (contando a nova). */
const JANELA_HISTORICO = 40;
const ABERTURA_DO_TRECHO = "[início do trecho da conversa]";

/** "Vou transferir" escrito sem chamar a ferramenta (4o-mini, eval 32): ninguém é avisado e o cliente fica esperando. */
const PROMETE_TRANSFERIR =
  /\b(vou|irei|vamos)\s+(te\s+|lhe\s+)?transferir\b|\b(estou|já estou)\s+(te\s+)?(transferindo|encaminhando)\b|\b(vou|irei|vamos)\s+(te\s+|lhe\s+)?(encaminhar|conectar|passar|chamar)\b[^.!?\n]{0,60}\b(atendente|equipe|pessoa|humano|especialista|consultor)/i;
const COBRANCA_DE_TRANSFERENCIA =
  "[aviso do sistema, não do cliente] Sua resposta diz que vai transferir, mas transferir_humano não foi chamada e ninguém da equipe foi avisado. Se o caso é de transferência, chame transferir_humano agora com o motivo que o descreve; se não, responda ao cliente sem prometer transferência.";

/**
 * Ferramenta → status de sucesso que muda a loja ou o estado e precisa ser salvo na hora.
 * Ferramenta com efeito termina mesmo com o turno cancelado: abandonada no meio, a loja ficaria sem saber.
 */
const EFEITOS: Record<string, string> = {
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

/** Silêncio a partir do qual a mensagem nova é um retorno do cliente, não a continuação da conversa. */
const PAUSA_DE_RETORNO_MS = 6 * 60 * 60 * 1000;

/**
 * Em que ponto da conversa o cliente está. A mensagem nova já está no fim do histórico.
 * "inicio": a assistente ainda não falou · "retorno": voltou depois de um tempo · "andamento": o resto.
 */
export function momentoDaConversa(historico: Mensagem[]): "inicio" | "retorno" | "andamento" {
  const anteriores = historico.slice(0, -1);
  if (!anteriores.some((m) => m.role === "assistant")) return "inicio";
  const atual = Date.parse(historico.at(-1)?.timestamp ?? "");
  const ultima = Date.parse(anteriores.at(-1)?.timestamp ?? "");
  return atual - ultima >= PAUSA_DE_RETORNO_MS ? "retorno" : "andamento";
}

function loadSystemPrompt(state: ConversationState): string {
  const template = readFileSync(join(__dir, "prompt/system.md"), "utf-8");
  const stateForPrompt = {
    // Sem a data, o modelo completava "20/11" com o ano do treino (2023-11-20 na ficha, 25/10).
    hoje: new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    momento_da_conversa: momentoDaConversa(state.historico),
    modo: state.modo,
    cliente: state.cliente,
    memoria: state.memoria?.fatos ?? [],
    necessidade: state.necessidade,
    artes_registradas: state.artes.length,
    produtos_discutidos: state.produtosDiscutidos,
    ultimas_opcoes_apresentadas: state.ultimasOpcoes?.map((o, i) => ({ posicao: i + 1, ...o })),
    produtos_detalhados: state.produtosDetalhados,
    // Resultados de ferramenta não passam para o turno seguinte: sem isto a confirmação não acha a estimativa.
    estimativa_aguardando_confirmacao: state.fichaPedido?.resumo,
    // Memória: o cliente que volta depois do orçamento não é tratado como conversa nova.
    orcamento_ja_enviado_a_equipe: state.orcamentoEnviado,
  };

  return template
    .replace(/\{\{ASSISTANT_NAME\}\}/g, config.assistantName)
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
  /** Ferramentas cujo handler não deve ser chamado: respondem com ferramenta_desligada → transferência. */
  ferramentasDesligadas?: Set<string>;
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
  /** Motivo da última ferramenta que mandou transferir; vale mesmo se o modelo não obedecer. */
  let transferenciaPendente: MotivoTransferencia | undefined;
  /** Sem falha de ferramenta, `falha_sistema` é o modelo fugindo do fluxo (20/10: estoque lido errado). */
  let falhaDeSistemaVista = false;
  let cobrouTransferencia = false;
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
        const entrada = toolDef?.schema.safeParse(toolInput ?? {});

        if (opcoes.ferramentasDesligadas?.has(toolName)) {
          output = { erro: "ferramenta_desligada", instrucao: "transferir", motivo_sugerido: "falha_sistema" };
          error = "ferramenta_desligada";
        } else if (!toolDef || !entrada) {
          output = { erro: "ferramenta_nao_encontrada" };
          error = "unknown_tool";
        } else if (!entrada.success) {
          // Erro do modelo, não da loja: não conta como falha de API nem leva a transferir.
          output = {
            erro: "parametros_invalidos",
            detalhes: entrada.error.issues
              .slice(0, 5)
              .map((i) => `${i.path.join(".") || "(entrada)"}: ${i.message}`),
            instrucao_ao_agente:
              "Corrija os parâmetros conforme o schema da ferramenta e chame de novo. Se faltar dado do cliente, pergunte a ele.",
          };
          error = "parametros_invalidos";
        } else if (
          toolName === "transferir_humano" &&
          (entrada.data as { motivo?: unknown }).motivo === "falha_sistema" &&
          !falhaDeSistemaVista &&
          state.falhasConsecutivas === 0
        ) {
          output = {
            erro: "motivo_invalido",
            instrucao_ao_agente:
              "Nenhuma ferramenta falhou: falha_sistema não se aplica. Siga o atendimento pelas ferramentas (estoque e orçamento se conferem em preparar_orcamento). Se o caso precisar mesmo de atendente, use o motivo que o descreve.",
          };
          error = "motivo_invalido";
        } else {
          try {
            // Entrada já conferida: campo a mais (ex.: telefone inventado) não chega ao handler.
            const execucao = toolDef.handler(entrada.data, state, client);
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
          falhaDeSistemaVista = true;
          state.falhasConsecutivas += 1;
          const erro = (output as { erro?: { erro?: string; alerta?: boolean } }).erro;

          // 401/403 e 412 não esperam a segunda falha (tabela de falhas da Fase 2).
          const imediato = exigeTransferenciaImediata(output);
          // Na 1ª falha só o motivo: se o modelo já transferir, não sai como "outro" (eval 11, 25/10).
          output = { ...(output as object), motivo_sugerido: "falha_sistema" };
          if (imediato || state.falhasConsecutivas >= FALHAS_PARA_TRANSFERIR) {
            output = { ...(output as object), instrucao: "transferir" };
          }
          if (erro?.alerta) {
            logger.log({
              type: "alerta",
              gravidade: "critica",
              motivo: erro.erro ?? "falha_api",
              ferramenta: toolName,
            });
          }
        } else if (error !== "parametros_invalidos" && error !== "unknown_tool" && error !== "motivo_invalido") {
          // Erro do modelo não chega à loja: não prova que a API voltou.
          state.falhasConsecutivas = 0;
        }

        const ordem = output as { instrucao?: unknown; motivo_sugerido?: unknown } | null;
        // Lacuna fica com o modelo: com a base quase vazia, forçar derrubaria quem só consultou de passagem.
        if (ordem?.instrucao === "transferir" && ordem.motivo_sugerido !== "lacuna_conhecimento") {
          const motivo = ordem.motivo_sugerido as MotivoTransferencia;
          if (motivo === "falha_sistema") falhaDeSistemaVista = true;
          transferenciaPendente = MOTIVOS.includes(motivo) ? motivo : "outro";
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
          const o = output as { status?: string; resumo_para_atendente?: ResumoTransferencia };
          transferred ||= o.status === "transferido";
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
      let text = textBlocks.map((b) => b.text ?? "").join("\n").trim();

      if (!transferred && !transferenciaPendente && !cobrouTransferencia && PROMETE_TRANSFERIR.test(text)) {
        cobrouTransferencia = true;
        logger.log({ type: "state_change", change: "prometeu_transferir_sem_chamar" });
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: COBRANCA_DE_TRANSFERENCIA });
        continue;
      }

      if (transferenciaPendente && !transferred) {
        const input = {
          motivo: transferenciaPendente,
          prioridade: "normal" as const,
          observacao: "automática: o modelo ignorou a instrução",
        };
        toolsCalled.push({ name: "transferir_humano", inputSummary: JSON.stringify(input).slice(0, 120) });
        const o = await transferirHumanoHandler(input, state, client);
        logger.log({ type: "tool_call", name: "transferir_humano", input, output: o, duration_ms: 0 });
        // Só o motivo de instrução de ferramenta é forçado; a recusa (orcamento_para_emitir sem ficha) não chega aqui.
        if (o.status === "transferido") {
          transferred = true;
          transferencia = o.resumo_para_atendente;
          opcoes.aoTransferir?.(o.resumo_para_atendente, [...lacunas]);
          opcoes.aoEfeito?.();
          text = MENSAGEM_TRANSFERENCIA;
        }
      }

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
