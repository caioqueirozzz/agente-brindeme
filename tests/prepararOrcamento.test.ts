import { describe, it, expect, beforeEach } from "vitest";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { prepararOrcamentoHandler } from "../src/tools/prepararOrcamento.js";
import { createInitialState } from "../src/agent/state.js";
import { semearMapaSubprodutos } from "./helpers/mapaSubprodutos.js";

const validInput = {
  tipo: "PF" as const,
  nome: "João Silva",
  telefone: "5583999990000",
  email: "joao@teste.com",
  itens: [{ subproduto_id: "sub-001-branco", quantidade: 50 }],
};

describe("prepararOrcamento", () => {
  let client: MockBrindeMeClient;
  let state: ReturnType<typeof createInitialState>;

  beforeEach(() => {
    client = new MockBrindeMeClient();
    state = createInitialState("5583999990000");
    semearMapaSubprodutos(state);
  });

  it("retorna resumo com token e total estimado", async () => {
    const result = await prepararOrcamentoHandler(validInput, state, client) as {
      status: string;
      token_confirmacao: string;
      resumo: { total_estimado: number };
    };
    expect(result.status).toBe("resumo_pronto");
    expect(result.token_confirmacao).toBeTruthy();
    // 50 * 18.90 em float dá 944.9999999999999; o total é arredondado em
    // centavos justamente para esse número não chegar ao cliente.
    expect(result.resumo.total_estimado).toBe(945);
  });

  it("guarda token no estado", async () => {
    await prepararOrcamentoHandler(validInput, state, client);
    expect(state.orcamentoPendente?.token).toBeTruthy();
  });

  it("recusa quantidade abaixo do mínimo", async () => {
    const result = await prepararOrcamentoHandler(
      { ...validInput, itens: [{ subproduto_id: "sub-001-branco", quantidade: 5 }] },
      state,
      client
    ) as { erro: string; min_quantity: number };
    expect(result.erro).toBe("abaixo_do_minimo");
    expect(result.min_quantity).toBe(25);
  });

  it("recusa subproduto inativo", async () => {
    const result = await prepararOrcamentoHandler(
      { ...validInput, itens: [{ subproduto_id: "sub-008-branca", quantidade: 25 }] },
      state,
      client
    ) as { erro: string };
    expect(result.erro).toBe("subproduto_inativo");
  });

  it("recusa subproduto inexistente", async () => {
    const result = await prepararOrcamentoHandler(
      { ...validInput, itens: [{ subproduto_id: "sub-naoexiste", quantidade: 25 }] },
      state,
      client
    ) as { erro: string };
    // Subproduto que nunca passou por buscar/detalhar: a listagem da API não
    // traz subprodutos, então não há como resolvê-lo.
    expect(result.erro).toBe("subproduto_desconhecido");
  });

  it("inclui arte_refs no resumo quando há artes registradas", async () => {
    state.artes = [{ ref: "arte-abc123", arquivo: "logo.png" }];
    const result = await prepararOrcamentoHandler(validInput, state, client) as {
      resumo: { arte_refs: string[] };
    };
    expect(result.resumo.arte_refs).toContain("arte-abc123");
  });
});
