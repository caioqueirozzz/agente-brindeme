import { describe, it, expect, beforeEach } from "vitest";
import { runTurn } from "../src/agent/runTurn.js";
import { createInitialState } from "../src/agent/state.js";
import { semearMapaSubprodutos } from "./helpers/mapaSubprodutos.js";
import { usarIndiceDoMock } from "./helpers/catalogo.js";
import { readFileSync } from "fs";
import { join } from "path";
import type { Product } from "../src/integrations/brindeme/types.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { Logger } from "../src/logging/logger.js";
import type { LLMProvider, LLMMessage, LLMResponse } from "../src/llm/types.js";

/**
 * LLM roteirizado: devolve as respostas na ordem dada e guarda os `messages`
 * de cada chamada, para inspecionar os tool_result que o modelo recebeu.
 */
class ScriptedLLM implements LLMProvider {
  public seen: LLMMessage[][] = [];
  constructor(private script: LLMResponse[]) {}

  async chat(params: { messages: LLMMessage[] }): Promise<LLMResponse> {
    this.seen.push(JSON.parse(JSON.stringify(params.messages)));
    return this.script.shift() ?? endTurn("fim");
  }
}

function toolUse(name: string, input: unknown = {}, id = `tu-${Math.random()}`): LLMResponse {
  return {
    id: "msg",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id, name, input }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function endTurn(text: string): LLMResponse {
  return {
    id: "msg",
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

/** Extrai os tool_result do último user message que o LLM recebeu. */
function ultimosToolResults(seen: LLMMessage[][]): Array<Record<string, unknown>> {
  const last = seen[seen.length - 1];
  const msg = last[last.length - 1];
  if (!Array.isArray(msg.content)) return [];
  return msg.content
    .filter((b) => b.type === "tool_result")
    .map((b) => JSON.parse(b.content ?? "{}") as Record<string, unknown>);
}

/**
 * buscar_produtos confere cada candidato em GET /product/{id}. "A API caiu"
 * significa que TODAS as conferências de uma busca falham; uma só falha é
 * absorvida (o produto não verificado simplesmente não é sugerido). Na busca
 * por "natal" os candidatos são os produtos ativos, com estoque e etiquetados.
 */
const CONFERENCIAS_POR_BUSCA_NATAL = (
  JSON.parse(readFileSync(join(process.cwd(), "mocks/products.json"), "utf-8")) as Product[]
).filter(
  (p) => p.status && p.tags_ocasiao?.includes("natal") && p.subproducts.some((s) => s.status && s.stock > 0)
).length;

describe("contagem centralizada de falhas de API", () => {
  let client: MockBrindeMeClient;
  let state: ReturnType<typeof createInitialState>;
  let logger: Logger;

  beforeEach(async () => {
    client = new MockBrindeMeClient();
    state = createInitialState("5583999990000");
    semearMapaSubprodutos(state);
    logger = new Logger("test-falhas");
    await usarIndiceDoMock();
  });

  it("os mocks têm candidatos de natal para a busca (premissa dos testes abaixo)", () => {
    expect(CONFERENCIAS_POR_BUSCA_NATAL).toBeGreaterThan(1);
  });

  it("conta falha de tool que engole o erro internamente (buscar_produtos)", async () => {
    client.injectFault({ type: "500", remaining: CONFERENCIAS_POR_BUSCA_NATAL });
    const llm = new ScriptedLLM([
      toolUse("buscar_produtos", { consulta: "natal" }),
      endTurn("tive um problema"),
    ]);

    await runTurn("me mostra brindes de natal", state, llm, client, logger);

    // Antes da correção isto continuava 0: a tool capturava o erro e retornava
    // { erro: ... } sem tocar no contador.
    expect(state.falhasConsecutivas).toBe(1);
  });

  it("injeta instrucao=transferir na SEGUNDA falha seguida", async () => {
    client.injectFault({ type: "500", remaining: CONFERENCIAS_POR_BUSCA_NATAL * 2 });
    const llm = new ScriptedLLM([
      toolUse("buscar_produtos", { consulta: "natal" }),
      toolUse("buscar_produtos", { consulta: "natal" }),
      endTurn("vou te transferir"),
    ]);

    await runTurn("me mostra brindes de natal", state, llm, client, logger);

    expect(state.falhasConsecutivas).toBe(2);
    const resultados = ultimosToolResults(llm.seen);
    expect(resultados[0].instrucao).toBe("transferir");
    expect(resultados[0].motivo_sugerido).toBe("falha_sistema");
  });

  it("não injeta instrucao na primeira falha", async () => {
    client.injectFault({ type: "500", remaining: CONFERENCIAS_POR_BUSCA_NATAL });
    const llm = new ScriptedLLM([
      toolUse("buscar_produtos", { consulta: "natal" }),
      endTurn("instabilidade"),
    ]);

    await runTurn("oi", state, llm, client, logger);

    const resultados = ultimosToolResults(llm.seen);
    expect(resultados[0].instrucao).toBeUndefined();
  });

  it("zera o contador quando a tool volta a funcionar", async () => {
    client.injectFault({ type: "500", remaining: CONFERENCIAS_POR_BUSCA_NATAL });
    const llm = new ScriptedLLM([
      toolUse("buscar_produtos", { consulta: "natal" }),
      toolUse("buscar_produtos", { consulta: "natal" }),
      endTurn("achei"),
    ]);

    await runTurn("oi", state, llm, client, logger);

    expect(state.falhasConsecutivas).toBe(0);
  });

  it("erro de negócio NÃO conta como falha de API", async () => {
    const llm = new ScriptedLLM([
      // 1 unidade fica abaixo do pedido mínimo → erro de negócio, não de infra
      toolUse("preparar_orcamento", {
        tipo: "PF",
        nome: "João Silva",
        telefone: "5583999990000",
        email: "joao@teste.com",
        itens: [{ subproduto_id: "sub-001-branco", quantidade: 1 }],
      }),
      endTurn("o mínimo é maior"),
    ]);

    await runTurn("quero 1 caneca", state, llm, client, logger);

    const resultados = ultimosToolResults(llm.seen);
    expect(resultados[0].erro).toBe("abaixo_do_minimo");
    expect(state.falhasConsecutivas).toBe(0);
  });

  it("falhas se acumulam entre turnos diferentes", async () => {
    client.injectFault({ type: "500", remaining: CONFERENCIAS_POR_BUSCA_NATAL });
    await runTurn(
      "oi",
      state,
      new ScriptedLLM([toolUse("buscar_produtos", { consulta: "natal" }), endTurn("erro")]),
      client,
      logger
    );
    expect(state.falhasConsecutivas).toBe(1);

    client.injectFault({ type: "500", remaining: CONFERENCIAS_POR_BUSCA_NATAL });
    const llm2 = new ScriptedLLM([toolUse("buscar_produtos", { consulta: "natal" }), endTurn("erro")]);
    await runTurn("e agora?", state, llm2, client, logger);

    expect(state.falhasConsecutivas).toBe(2);
    expect(ultimosToolResults(llm2.seen)[0].instrucao).toBe("transferir");
  });
});
