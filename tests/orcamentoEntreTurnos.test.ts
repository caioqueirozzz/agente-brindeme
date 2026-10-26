import { describe, it, expect } from "vitest";
import { runTurn } from "../src/agent/runTurn.js";
import { createInitialState } from "../src/agent/state.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { Logger } from "../src/logging/logger.js";
import type { LLMProvider, LLMResponse } from "../src/llm/types.js";
import { semearMapaSubprodutos } from "./helpers/mapaSubprodutos.js";
import { toolUse, endTurn } from "./helpers/llmRoteirizado.js";

/** Guarda o prompt de sistema de cada chamada: é onde o estado da conversa chega ao modelo. */
class LLMQueVeOPrompt implements LLMProvider {
  sistemas: string[] = [];
  constructor(private readonly roteiro: LLMResponse[]) {}
  async chat(p: { system: string }): Promise<LLMResponse> {
    this.sistemas.push(p.system);
    return this.roteiro.shift() ?? endTurn("fim");
  }
}

describe("estimativa confirmada no turno seguinte (eval 05)", () => {
  it("a estimativa pendente chega ao modelo quando o cliente responde 'pode enviar'", async () => {
    const state = createInitialState("5583999990000");
    semearMapaSubprodutos(state);
    const client = new MockBrindeMeClient();
    const llm = new LLMQueVeOPrompt([
      toolUse("preparar_orcamento", {
        tipo: "PF",
        nome: "João Silva",
        email: "joao@teste.com",
        itens: [{ subproduto_id: "sub-001-branco", quantidade: 50 }],
      }),
      endTurn("Resumo: 50 canecas brancas, R$ 945,00. Posso enviar para a equipe?"),
      endTurn("ok"),
    ]);

    await runTurn("Quero 50 canecas brancas, PF, João Silva, joao@teste.com", state, llm, client, new Logger("t-entre-turnos"));
    await runTurn("Pode enviar", state, llm, client, new Logger("t-entre-turnos"));

    const estado = JSON.parse(llm.sistemas.at(-1)!.split("# Estado atual da conversa")[1].split("---")[0]);
    expect(estado.estimativa_aguardando_confirmacao).toMatchObject({ email: "joao@teste.com", total_estimado: 945 });
    expect(JSON.stringify(estado)).toContain("sub-001-branco");
  });
});

describe("opções apresentadas no turno anterior", () => {
  it("chegam ao modelo com posição e nome, para 'a primeira opção' apontar a lista certa", async () => {
    const state = createInitialState("5583999990000");
    state.produtosDiscutidos = ["antigo", "caneca", "squeeze"];
    state.ultimasOpcoes = [
      { id: "caneca", nome: "Caneca de Porcelana" },
      { id: "squeeze", nome: "Squeeze de Alumínio" },
    ];
    const llm = new LLMQueVeOPrompt([endTurn("ok")]);

    await runTurn("me fala mais da primeira opção", state, llm, new MockBrindeMeClient(), new Logger("t-opcoes"));

    const estado = JSON.parse(llm.sistemas[0].split("# Estado atual da conversa")[1].split("---")[0]);
    expect(estado.ultimas_opcoes_apresentadas).toEqual([
      { posicao: 1, id: "caneca", nome: "Caneca de Porcelana" },
      { posicao: 2, id: "squeeze", nome: "Squeeze de Alumínio" },
    ]);
  });
});

describe("cores do produto detalhado no turno anterior", () => {
  it("chegam ao modelo com o subproduto_id, para o orçamento não depender de inventar o id", async () => {
    const state = createInitialState("5583999990000");
    const llm = new LLMQueVeOPrompt([
      toolUse("detalhar_produto", { produto_id: "prod-001" }),
      endTurn("A caneca tem branco e preto."),
      endTurn("ok"),
    ]);
    const client = new MockBrindeMeClient();

    await runTurn("me fala da caneca", state, llm, client, new Logger("t-detalhados"));
    await runTurn("quero 50 da branca", state, llm, client, new Logger("t-detalhados"));

    const estado = JSON.parse(llm.sistemas.at(-1)!.split("# Estado atual da conversa")[1].split("---")[0]);
    expect(estado.produtos_detalhados).toEqual([
      {
        id: "prod-001",
        nome: "Caneca de Porcelana Personalizada",
        cores: [
          { subproduto_id: "sub-001-branco", cor: "Branco" },
          { subproduto_id: "sub-001-preto", cor: "Preto" },
        ],
      },
    ]);
  });
});
