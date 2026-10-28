import { describe, it, expect, beforeEach } from "vitest";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { AVISO_ESTIMATIVA, prepararOrcamentoHandler } from "../src/tools/prepararOrcamento.js";
import { transferirHumanoHandler } from "../src/tools/transferirHumano.js";
import { addMessage, createInitialState } from "../src/agent/state.js";
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

  it("estoque insuficiente diz a cor e as cores do produto que atendem (conversa real de 25/10: o modelo chutou a cor)", async () => {
    const r = await prepararOrcamentoHandler(
      { ...validInput, itens: [{ subproduto_id: "sub-003-branca", quantidade: 100 }] },
      state,
      client
    );
    expect(r).toMatchObject({
      erro: "estoque_insuficiente",
      cor: "Branca",
      estoque_disponivel: 80,
      cores_que_atendem: [{ subproduto_id: "sub-003-preta", cor: "Preta" }],
    });
  });

  it("retorna a estimativa com o aviso de que a equipe confirma personalização, frete e prazo", async () => {
    const result = await prepararOrcamentoHandler(validInput, state, client) as {
      status: string;
      aviso: string;
      instrucao: string;
      resumo: { total_estimado: number };
    };
    expect(result.status).toBe("estimativa_pronta");
    expect(result.aviso).toMatch(/personalização fora do padrão, frete e prazo/i);
    expect(result.instrucao).toMatch(/orcamento_para_emitir/);
    expect(JSON.stringify(result)).not.toMatch(/token|criar_orcamento/);
    // 50 * 18.90 em float dá 944.9999999999999; o total é arredondado em
    // centavos justamente para esse número não chegar ao cliente.
    expect(result.resumo.total_estimado).toBe(945);
  });

  it("[#26] traz o resumo pronto para o cliente: produto, cor, valores e o aviso literal", async () => {
    const result = (await prepararOrcamentoHandler(validInput, state, client)) as {
      resumo_para_cliente: string;
      instrucao: string;
    };
    // toLocaleString separa "R$" do valor com espaço inquebrável.
    expect(result.resumo_para_cliente.replace(/ /g, " ")).toBe(
      [
        "• 50× Caneca de Porcelana Personalizada (Branco) — R$ 18,90 cada = R$ 945,00",
        "Total estimado: R$ 945,00",
        `_${AVISO_ESTIMATIVA}_`,
      ].join("\n")
    );
    expect(result.instrucao).toMatch(/resumo_para_cliente/);
  });

  it("telefone do orçamento é o da conversa, não o que o modelo mandar (#12)", async () => {
    const ditadoPeloModelo = { ...validInput, telefone: "5511888887777" };
    await prepararOrcamentoHandler(ditadoPeloModelo, state, client);
    expect(state.fichaPedido?.resumo.telefone).toBe("5583999990000");
  });

  it("o modelo nem recebe o campo telefone para preencher", async () => {
    const { tools } = await import("../src/tools/index.js");
    const schema = tools.find((t) => t.name === "preparar_orcamento")!.inputSchema as { properties: object };
    expect(Object.keys(schema.properties)).not.toContain("telefone");
  });

  it("não pede CPF, CNPJ nem endereço: ficam com quem emite (decisão de 25/10)", async () => {
    const { tools } = await import("../src/tools/index.js");
    const schema = tools.find((t) => t.name === "preparar_orcamento")!.inputSchema as { properties: object };
    expect(Object.keys(schema.properties).join(",")).not.toMatch(/cpf|cnpj|endereco/i);
  });

  it("prazo desejado e personalização vão para a ficha", async () => {
    await prepararOrcamentoHandler({ ...validInput, prazo_desejado: "até 10/12", personalizacao: "tem arte, 2 cores" }, state, client);
    expect(state.fichaPedido?.resumo).toMatchObject({ prazo_desejado: "até 10/12", personalizacao: "tem arte, 2 cores" });
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
    expect(segunda).toMatchObject({ status: "estimativa_pronta" });
  });

  it("guarda a ficha no estado", async () => {
    await prepararOrcamentoHandler(validInput, state, client);
    expect(state.fichaPedido?.resumo.itens).toHaveLength(1);
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
    // prod-008 está inativo no mock (e isso agora barra antes, com produto_inativo): aqui o produto
    // fica ativo para exercitar só a cor inativa.
    const produtoAtivo = new (class extends MockBrindeMeClient {
      async getProduct(id: string) {
        return { ...(await super.getProduct(id)), status: true };
      }
    })();
    const result = await prepararOrcamentoHandler(
      { ...validInput, itens: [{ subproduto_id: "sub-008-branca", quantidade: 25 }] },
      state,
      produtoAtivo
    ) as { erro: string };
    expect(result.erro).toBe("subproduto_inativo");
  });

  it("[Fase 6] recusa produto desativado na loja", async () => {
    const result = await prepararOrcamentoHandler(
      { ...validInput, itens: [{ subproduto_id: "sub-008-branca", quantidade: 25 }] },
      state,
      client
    ) as { erro: string };
    expect(result.erro).toBe("produto_inativo");
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

describe("transferir_humano com orcamento_para_emitir (R5: o agente estima, pessoa emite)", () => {
  let client: MockBrindeMeClient;
  let state: ReturnType<typeof createInitialState>;
  const enviar = () => transferirHumanoHandler({ motivo: "orcamento_para_emitir", prioridade: "normal" }, state, client);

  beforeEach(() => {
    client = new MockBrindeMeClient();
    state = createInitialState("5583999990000");
    semearMapaSubprodutos(state);
    addMessage(state, "user", "quero 50 canecas brancas");
  });

  it("sem estimativa, recusa e manda preparar antes", async () => {
    expect(await enviar()).toMatchObject({ erro: "sem_estimativa" });
    expect(state.modo).toBe("ia");
  });

  it("no mesmo turno do resumo, recusa: o cliente ainda não confirmou", async () => {
    await prepararOrcamentoHandler(validInput, state, client);
    expect(await enviar()).toMatchObject({ erro: "aguardando_confirmacao" });
    expect(state.modo).toBe("ia");
  });

  it("depois da confirmação, transfere com a ficha e limpa a pendência", async () => {
    await prepararOrcamentoHandler({ ...validInput, prazo_desejado: "até 10/12" }, state, client);
    addMessage(state, "user", "pode enviar");
    const r = await enviar();
    expect(r.status).toBe("transferido");
    expect(r.resumo_para_atendente?.ficha_pedido).toMatchObject({
      email: "joao@teste.com",
      total_estimado: 945,
      prazo_desejado: "até 10/12",
    });
    expect(state.modo).toBe("humano");
    expect(state.fichaPedido).toBeUndefined();
  });

  it("preparar de novo a mesma ficha no turno da confirmação não apaga a confirmação (eval 05, 25/10)", async () => {
    await prepararOrcamentoHandler(validInput, state, client);
    addMessage(state, "user", "pode enviar");
    await prepararOrcamentoHandler({ ...validInput, observacoes: "reescrita pelo modelo" }, state, client);
    expect((await enviar()).status).toBe("transferido");
  });

  it("mesma ficha preparada de novo não manda pedir confirmação outra vez (conversa real de 25/10: laço no 'pode enviar')", async () => {
    await prepararOrcamentoHandler(validInput, state, client);
    addMessage(state, "user", "pode enviar");
    const r = await prepararOrcamentoHandler(validInput, state, client);
    expect(r).toMatchObject({ status: "ficha_ja_apresentada" });
    expect(JSON.stringify(r)).not.toMatch(/pergunte se pode enviar/);
  });

  it("a ficha que vai à equipe é a que o cliente viu, não a reescrita pelo modelo (prazo 20/11 virou 2023-11-20)", async () => {
    await prepararOrcamentoHandler({ ...validInput, prazo_desejado: "20/11" }, state, client);
    addMessage(state, "user", "pode enviar");
    await prepararOrcamentoHandler({ ...validInput, prazo_desejado: "2023-11-20" }, state, client);
    expect(state.fichaPedido?.resumo.prazo_desejado).toBe("20/11");
  });

  it("ficha diferente no turno da confirmação precisa de confirmação nova", async () => {
    await prepararOrcamentoHandler(validInput, state, client);
    addMessage(state, "user", "na verdade quero 80");
    await prepararOrcamentoHandler({ ...validInput, itens: [{ subproduto_id: "sub-001-branco", quantidade: 80 }] }, state, client);
    expect(await enviar()).toMatchObject({ erro: "aguardando_confirmacao" });
  });

  it("outro motivo não exige ficha", async () => {
    const r = await transferirHumanoHandler({ motivo: "desconto", prioridade: "normal" }, state, client);
    expect(r.status).toBe("transferido");
  });
});
