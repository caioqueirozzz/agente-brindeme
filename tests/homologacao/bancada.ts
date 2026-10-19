import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgenteDefinitivo } from "../../src/api/agenteDefinitivo.js";
import type { TurnResult } from "../../src/agent/runTurn.js";
import { calcularTurnoId } from "../../src/contrato/turno.js";
import type { Arquivo, RespostaMensagens } from "../../src/contrato/esquemas.js";
import type { EstadoSistema } from "../../src/controle/estadoSistema.js";
import { RepositorioConversas } from "../../src/conversas/repositorio.js";
import { MockBrindeMeClient } from "../../src/integrations/brindeme/mockClient.js";
import { carregarBase } from "../../src/knowledge/base.js";
import { MemoryLacunaStore } from "../../src/knowledge/lacunas.js";
import type { LLMMessage, LLMProvider, LLMResponse } from "../../src/llm/types.js";
import { setBaseConhecimento, setLacunaStore } from "../../src/tools/consultarConhecimento.js";
import { setOrderIndexStore } from "../../src/tools/consultarPedido.js";
import { usarIndiceDoMock } from "../helpers/catalogo.js";
import { indiceDosMocks } from "../helpers/indicePedidos.js";
import { endTurn, toolUse } from "../helpers/llmRoteirizado.js";

export { endTurn, toolUse };

/** Telefone do dono do PED-2024-001 nos mocks. */
export const TEL = "5583999990000";
/** Telefone que não é dono de nenhum pedido dos mocks. */
export const TEL_ESTRANHO = "5511000000001";

export interface ChamadaLLM {
  system: string;
  messages: LLMMessage[];
}

/** Passo do roteiro: resposta pronta, resposta montada a partir do que o modelo "viu", ou erro lançado. */
export type Passo = LLMResponse | Error | ((c: ChamadaLLM) => LLMResponse);

/**
 * Faz o papel do modelo. O roteiro de cada turno é empilhado antes de mandar a mensagem;
 * cada chamada guarda o system prompt e as mensagens, para conferir o que o modelo recebeu.
 */
export class RoteiroLLM implements LLMProvider {
  readonly chamadas: ChamadaLLM[] = [];
  private readonly fila: Passo[] = [];
  /** Demora de cada resposta: simula modelo lento (teto do turno, atendente que assume no meio). */
  atrasoMs = 0;

  roteiro(...passos: Passo[]): this {
    this.fila.push(...passos);
    return this;
  }

  pendentes(): number {
    return this.fila.length;
  }

  async chat(p: { system: string; messages: LLMMessage[] }): Promise<LLMResponse> {
    const chamada = { system: p.system, messages: JSON.parse(JSON.stringify(p.messages)) as LLMMessage[] };
    this.chamadas.push(chamada);
    if (this.atrasoMs) await new Promise((r) => setTimeout(r, this.atrasoMs));
    const passo = this.fila.shift() ?? endTurn("fim do roteiro");
    if (passo instanceof Error) throw passo;
    return typeof passo === "function" ? passo(chamada) : passo;
  }
}

/** Resultados de ferramenta da última mensagem que o modelo recebeu. */
export function resultados(c: ChamadaLLM): Array<Record<string, unknown>> {
  const ultima = c.messages.at(-1);
  if (!ultima || !Array.isArray(ultima.content)) return [];
  return ultima.content
    .filter((b) => b.type === "tool_result")
    .map((b) => JSON.parse(b.content ?? "{}") as Record<string, unknown>);
}

/** Todos os tool_result que o modelo recebeu em todas as chamadas, na ordem. */
export function todosResultados(llm: RoteiroLLM): Array<Record<string, unknown>> {
  const vistos = new Set<string>();
  const saida: Array<Record<string, unknown>> = [];
  for (const c of llm.chamadas) {
    for (const m of c.messages) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b.type !== "tool_result" || vistos.has(b.tool_use_id!)) continue;
        vistos.add(b.tool_use_id!);
        saida.push(JSON.parse(b.content ?? "{}") as Record<string, unknown>);
      }
    }
  }
  return saida;
}

/** O token do orçamento pendente vai no estado do system prompt (é assim que o modelo o recebe entre turnos). */
export function tokenDoPrompt(system: string): string {
  const m = /"token_confirmacao":\s*"([^"]+)"/.exec(system);
  if (!m) throw new Error("system prompt sem token_confirmacao");
  return m[1];
}

/** Base com um item aprovado por categoria usada nos testes, mais um rascunho que nunca pode sair. */
function baseDeHomologacao(): void {
  const dir = mkdtempSync(join(tmpdir(), "homolog-kb-"));
  const item = (over: Record<string, unknown>) => ({
    status: "aprovado",
    aprovado_por: "Homologação",
    aprovado_em: "2026-10-01",
    revisar_em: "2027-04-01",
    ...over,
  });
  writeFileSync(
    join(dir, "entrega.json"),
    JSON.stringify({
      categoria: "entrega",
      itens: [
        item({
          id: "entrega-brasil",
          titulo: "Entrega para todo o Brasil",
          conteudo: "Entregamos para todo o Brasil por Correios e transportadoras.",
          palavras_chave: ["frete", "envio", "correios", "entrega", "entregam"],
          perguntas_exemplo: ["Vocês entregam em todo o Brasil?"],
        }),
        item({
          id: "retirada-rascunho",
          titulo: "Retirada na loja",
          conteudo: "Retirada gratuita no balcão em 24h.",
          palavras_chave: ["retirada", "retirar", "balcao"],
          perguntas_exemplo: ["Posso retirar na loja?"],
          status: "rascunho",
          aprovado_por: undefined,
          aprovado_em: undefined,
        }),
      ],
    }),
    "utf-8"
  );
  setBaseConhecimento(carregarBase({ dir, incluirRascunhos: false }).base);
}

export interface Bancada {
  agente: AgenteDefinitivo;
  repo: RepositorioConversas;
  client: MockBrindeMeClient;
  llm: RoteiroLLM;
  lacunas: MemoryLacunaStore;
  /** Mutável: simula o #suspender / #desligar gravado pela ponte. */
  sistema: EstadoSistema;
  turnos: TurnResult[];
  enviar(texto: string, opcoes?: { telefone?: string; arquivo?: Arquivo; id?: string }): Promise<RespostaMensagens>;
}

export async function montarBancada(opcoes: { tetoMs?: number; respostasPorHora?: number; repoDir?: string } = {}): Promise<Bancada> {
  await usarIndiceDoMock();
  setOrderIndexStore(indiceDosMocks());
  const lacunas = new MemoryLacunaStore();
  setLacunaStore(lacunas);
  baseDeHomologacao();

  const repo = new RepositorioConversas(opcoes.repoDir ?? mkdtempSync(join(tmpdir(), "homolog-conv-")));
  const client = new MockBrindeMeClient();
  const llm = new RoteiroLLM();
  const sistema: EstadoSistema = { suspenso: false };
  const turnos: TurnResult[] = [];
  const agente = new AgenteDefinitivo({
    repo,
    llm,
    client,
    tetoMs: opcoes.tetoMs ?? 5_000,
    respostasPorHora: opcoes.respostasPorHora ?? 30,
    lerEstado: () => sistema,
    aoTurno: (r) => turnos.push(r),
  });

  let n = 0;
  const enviar: Bancada["enviar"] = (texto, o = {}) => {
    const id = o.id ?? `hm-${Date.now()}-${++n}`;
    return agente.processarLote({
      turnoId: calcularTurnoId([id]),
      telefone: o.telefone ?? TEL,
      mensagens: [{ id, timestamp: new Date().toISOString(), texto, ...(o.arquivo ? { arquivo: o.arquivo } : {}) }],
    });
  };

  return { agente, repo, client, llm, lacunas, sistema, turnos, enviar };
}

export function restaurarAmbiente(): void {
  setBaseConhecimento(null);
}
