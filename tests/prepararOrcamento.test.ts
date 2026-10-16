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

  it("telefone do orçamento é o da conversa, não o que o modelo mandar (#12)", async () => {
    const ditadoPeloModelo = { ...validInput, telefone: "5511888887777" };
    await prepararOrcamentoHandler(ditadoPeloModelo, state, client);
    expect(state.orcamentoPendente?.body.customer_phone).toBe("5583999990000");
    expect(state.orcamentoPendente?.resumo.telefone).toBe("5583999990000");
  });

  it("o modelo nem recebe o campo telefone para preencher", async () => {
    const { tools } = await import("../src/tools/index.js");
    const schema = tools.find((t) => t.name === "preparar_orcamento")!.inputSchema as { properties: object };
    expect(Object.keys(schema.properties)).not.toContain("telefone");
  });

  it("id do produto no lugar do subproduto: devolve as cores com o id certo (eval 05)", async () => {
    const limpo = createInitialState("5583999990000");
    limpo.produtosDiscutidos.push("prod-001");
    const r = (await prepararOrcamentoHandler(
      { ...validInput, itens: [{ subproduto_id: "prod-001", quantidade: 50 }] },
      limpo,
      client
    )) as { erro: string; opcoes: Array<{ subproduto_id: string; cor: string }>; instrucao: string };
    expect(r.erro).toBe("informe_a_cor");
    expect(r.opcoes).toContainEqual(expect.objectContaining({ subproduto_id: "sub-001-branco" }));
    expect(r.instrucao).toMatch(/preparar_orcamento de novo/);
    const segunda = await prepararOrcamentoHandler(
      { ...validInput, itens: [{ subproduto_id: "sub-001-branco", quantidade: 50 }] },
      limpo,
      client
    );
    expect(segunda).toMatchObject({ status: "resumo_pronto" });
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
