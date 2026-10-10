import { describe, it, expect, beforeEach } from "vitest";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { prepararOrcamentoHandler } from "../src/tools/prepararOrcamento.js";
import { criarOrcamentoHandler } from "../src/tools/criarOrcamento.js";
import { createInitialState } from "../src/agent/state.js";

const validPreparar = {
  tipo: "PF" as const,
  nome: "João Silva",
  telefone: "5583999990000",
  email: "joao@teste.com",
  itens: [{ subproduto_id: "sub-001-branco", quantidade: 50 }],
};

describe("criarOrcamento", () => {
  let client: MockBrindeMeClient;
  let state: ReturnType<typeof createInitialState>;

  beforeEach(() => {
    client = new MockBrindeMeClient();
    state = createInitialState("5583999990000");
  });

  it("cria orçamento com token válido", async () => {
    const prep = await prepararOrcamentoHandler(validPreparar, state, client) as { token_confirmacao: string };
    const result = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as {
      status: string;
      codigo: string;
    };
    expect(result.status).toBe("criado");
    expect(result.codigo).toMatch(/^ORC-/);
  });

  it("retorna erro com token inválido", async () => {
    await prepararOrcamentoHandler(validPreparar, state, client);
    const result = await criarOrcamentoHandler({ token_confirmacao: "token-errado" }, state, client) as { erro: string };
    expect(result.erro).toBe("token_invalido");
  });

  it("retorna erro sem orçamento pendente", async () => {
    const result = await criarOrcamentoHandler({ token_confirmacao: "qualquer" }, state, client) as { erro: string };
    expect(result.erro).toBe("sem_orcamento_pendente");
  });

  it("é idempotente: segunda chamada retorna mesmo orçamento", async () => {
    const prep = await prepararOrcamentoHandler(validPreparar, state, client) as { token_confirmacao: string };
    const r1 = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as { status: string; codigo: string };

    // Restore token for second call (it was cleared after first creation)
    state.orcamentoPendente = {
      token: prep.token_confirmacao,
      expiraEm: new Date(Date.now() + 60000).toISOString(),
      resumo: {} as never,
      body: {} as never,
    };

    const r2 = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as { status: string; codigo: string };
    expect(r2.status).toBe("ja_criado");
    expect(r2.codigo).toBe(r1.codigo);
  });

  it("token expirado retorna erro", async () => {
    const prep = await prepararOrcamentoHandler(validPreparar, state, client) as { token_confirmacao: string };
    // Force expiry
    state.orcamentoPendente!.expiraEm = new Date(Date.now() - 1000).toISOString();
    const result = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as { erro: string };
    expect(result.erro).toBe("token_expirado");
  });
});
