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

describe("orçamento confirmado no turno seguinte (eval 05)", () => {
  it("o token do resumo pendente chega ao modelo quando o cliente responde 'pode criar'", async () => {
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
      endTurn("Resumo: 50 canecas brancas, R$ 945,00. Posso criar?"),
      endTurn("ok"),
    ]);

    await runTurn("Quero 50 canecas brancas, PF, João Silva, joao@teste.com", state, llm, client, new Logger("t-entre-turnos"));
    const token = state.orcamentoPendente!.token;
    await runTurn("Pode criar", state, llm, client, new Logger("t-entre-turnos"));

    const promptDoSegundoTurno = llm.sistemas.at(-1)!;
    expect(promptDoSegundoTurno).toContain(token);
    expect(promptDoSegundoTurno).toContain("sub-001-branco");
  });
});
