import { describe, it, expect, beforeEach } from "vitest";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { prepararOrcamentoHandler } from "../src/tools/prepararOrcamento.js";
import { criarOrcamentoHandler } from "../src/tools/criarOrcamento.js";
import { consultarOrcamentoHandler } from "../src/tools/consultarOrcamento.js";
import { createInitialState } from "../src/agent/state.js";

describe("consultarOrcamento", () => {
  let client: MockBrindeMeClient;

  beforeEach(() => { client = new MockBrindeMeClient(); });

  it("retorna nao_encontrado para código de outro telefone", async () => {
    const state = createInitialState("5511111111111");
    const result = await consultarOrcamentoHandler({ codigo: "ORC-1001" }, state, client);
    expect((result as { resultado: string }).resultado).toBe("nao_encontrado");
  });

  it("retorna dados do orçamento criado nesta conversa", async () => {
    const state = createInitialState("5583999990000");

    const prep = await prepararOrcamentoHandler(
      { tipo: "PF", nome: "Test", telefone: "5583999990000", email: "test@test.com", itens: [{ subproduto_id: "sub-001-branco", quantidade: 50 }] },
      state,
      client
    ) as { token_confirmacao: string };

    const criado = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as { codigo: string };

    const result = await consultarOrcamentoHandler({ codigo: criado.codigo }, state, client) as { resultado: string };
    expect(result.resultado).toBe("encontrado");
  });
});
