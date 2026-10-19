import { describe, it, expect, beforeEach } from "vitest";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { prepararOrcamentoHandler } from "../src/tools/prepararOrcamento.js";
import { criarOrcamentoHandler } from "../src/tools/criarOrcamento.js";
import { addMessage, createInitialState } from "../src/agent/state.js";
import { semearMapaSubprodutos } from "./helpers/mapaSubprodutos.js";

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
    semearMapaSubprodutos(state);
  });

  it("cria orçamento com token válido", async () => {
    const prep = await prepararOrcamentoHandler(validPreparar, state, client) as { token_confirmacao: string };
    addMessage(state, "user", "pode criar");
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
    addMessage(state, "user", "pode criar");
    const r1 = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as { status: string; codigo: string };

    // Sem pendência (já foi consumida): o "pode criar" repetido devolve o mesmo código, não sem_orcamento_pendente.
    expect(state.orcamentoPendente).toBeUndefined();
    addMessage(state, "user", "criou?");
    const r2 = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as { status: string; codigo: string };
    expect(r2.status).toBe("ja_criado");
    expect(r2.codigo).toBe(r1.codigo);
  });

  it("[Fase 6] não cria no mesmo turno do resumo: o cliente ainda não confirmou", async () => {
    addMessage(state, "user", "quero 50 canecas brancas");
    const prep = await prepararOrcamentoHandler(validPreparar, state, client) as { token_confirmacao: string };
    const r = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as { erro: string };
    expect(r.erro).toBe("aguardando_confirmacao");
    expect(state.orcamentos).toHaveLength(0);
    // A pendência continua: a confirmação na próxima mensagem cria.
    addMessage(state, "user", "pode criar");
    const ok = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as { status: string };
    expect(ok.status).toBe("criado");
  });

  it("[Fase 6] pendência salva antes da Fase 6 (sem marca) continua aceitando a confirmação", async () => {
    const prep = await prepararOrcamentoHandler(validPreparar, state, client) as { token_confirmacao: string };
    delete state.orcamentoPendente!.mensagemDoResumo;
    const r = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as { status: string };
    expect(r.status).toBe("criado");
  });

  it("token expirado retorna erro", async () => {
    const prep = await prepararOrcamentoHandler(validPreparar, state, client) as { token_confirmacao: string };
    // Force expiry
    state.orcamentoPendente!.expiraEm = new Date(Date.now() - 1000).toISOString();
    const result = await criarOrcamentoHandler({ token_confirmacao: prep.token_confirmacao }, state, client) as { erro: string };
    expect(result.erro).toBe("token_expirado");
  });
});
