import { describe, it, expect, beforeEach } from "vitest";
import {
  buscarProdutosHandler,
  setProductIndexStore,
  setOccasionTagStore,
  OBSERVACAO_PRECOS,
} from "../src/tools/buscarProdutos.js";
import { MemoryProductIndexStore, sincronizarCatalogo } from "../src/catalogo/indice.js";
import { MemoryOccasionTagStore } from "../src/catalogo/ocasioes.js";
import { createInitialState } from "../src/agent/state.js";
import { ApiError, isFalhaApi, exigeTransferenciaImediata } from "../src/integrations/brindeme/errors.js";
import { ClienteCatalogoFalso, produto, sub } from "./helpers/produtos.js";

const catalogo = () => [
  produto({
    id: "caneca",
    nome: "Caneca de Porcelana",
    min: 25,
    destaque: true,
    etiquetas: ["natal"],
    subprodutos: [
      sub("c-bco", "Branco", 300, [[25, 99, 18.9], [100, 499, 15.4]]),
      sub("c-pto", "Preto", 200, [[25, 99, 19.9], [100, 499, 16.4]]),
    ],
  }),
  produto({ id: "squeeze", nome: "Squeeze de Alumínio", min: 50, subprodutos: [sub("s-az", "Azul", 150, [[50, 999, 12]])] }),
];

type Saida = Record<string, any>;

describe("buscar_produtos (ferramenta)", () => {
  let client: ClienteCatalogoFalso;
  let state: ReturnType<typeof createInitialState>;

  beforeEach(async () => {
    client = new ClienteCatalogoFalso(catalogo());
    const index = new MemoryProductIndexStore();
    await sincronizarCatalogo(client, index);
    setProductIndexStore(index);
    setOccasionTagStore(new MemoryOccasionTagStore());
    state = createInitialState("5583999990000");
  });

  const buscar = (input: Parameters<typeof buscarProdutosHandler>[0]) =>
    buscarProdutosHandler(input, state, client) as Promise<Saida>;

  it("com quantidade: preço da faixa, total estimado e cores", async () => {
    const r = await buscar({ consulta: "caneca", quantidade: 100 });
    expect(r.resultado).toBe("produtos_encontrados");
    expect(r.quantidade_considerada).toBe(100);
    expect(r.observacao_precos).toBe(OBSERVACAO_PRECOS);
    expect(r.aviso).toBeUndefined();
    expect(r.produtos[0]).toMatchObject({
      id: "caneca",
      nome: "Caneca de Porcelana",
      preco_unitario_na_quantidade: 15.4,
      total_estimado: 1540,
      min_quantity: 25,
      cores_disponiveis: ["Branco", "Preto"],
      imagem_url: "https://cdn.teste/caneca.jpg",
    });
  });

  it("sem quantidade: nenhum preço chega ao modelo, só o mínimo, e manda perguntar (eval 17)", async () => {
    const r = await buscar({ consulta: "caneca" });
    expect(r.aviso).toMatch(/pergunte a quantidade/i);
    expect(r.produtos[0]).toMatchObject({ nome: "Caneca de Porcelana", min_quantity: 25 });
    expect(JSON.stringify(r.produtos)).not.toMatch(/preco|total_estimado|18\.9/);
  });

  it("não expõe ids de subproduto, estoque nem dado interno ao modelo", async () => {
    const r = await buscar({ consulta: "caneca", quantidade: 100 });
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/c-bco|c-pto|estoque|"stock"|cost/);
  });

  it("orcamento_total sem quantidade é dado faltando, não busca vazia", async () => {
    const r = await buscar({ consulta: "caneca", orcamento_total: 500 });
    expect(r).toMatchObject({ resultado: "faltam_dados", faltando: ["quantidade"] });
  });

  it("orcamento_total com quantidade vira teto por unidade", async () => {
    expect((await buscar({ consulta: "caneca", quantidade: 100, orcamento_total: 1500 })).resultado).toBe(
      "nenhum_produto_encontrado"
    );
    expect((await buscar({ consulta: "caneca", quantidade: 100, orcamento_total: 1600 })).resultado).toBe(
      "produtos_encontrados"
    );
  });

  it("indica a ocasião só quando o produto está etiquetado com ela", async () => {
    const r = await buscar({ consulta: "brinde", quantidade: 100, ocasiao: "natal" });
    expect(r.ocasioes_consideradas).toEqual(["Natal"]);
    expect(r.produtos.map((p: Saida) => p.id)).toEqual(["caneca"]); // squeeze não é de natal e "brinde" é genérico
    expect(r.produtos[0].indicado_para_a_ocasiao).toBe(true);
  });

  it("sem ocasião no pedido, o campo não aparece (o modelo não tem o que afirmar)", async () => {
    const r = await buscar({ consulta: "caneca", quantidade: 100 });
    expect(r.produtos[0]).not.toHaveProperty("indicado_para_a_ocasiao");
  });

  it("guarda o mapa subproduto → produto para preparar_orcamento, inclusive cores não ofertadas", async () => {
    await buscar({ consulta: "caneca", quantidade: 250 }); // preto (200) não cobre; branco sim
    expect(state.subprodutoParaProduto["c-bco"]).toBe("caneca");
    expect(state.subprodutoParaProduto["c-pto"]).toBe("caneca");
    expect(state.produtosDiscutidos).toContain("caneca");
  });

  it("guarda a necessidade do cliente no estado", async () => {
    await buscar({ consulta: "caneca", quantidade: 100, preco_max_unitario: 20, orcamento_total: 2000, ocasiao: "natal" });
    expect(state.necessidade).toMatchObject({
      quantidade: 100,
      precoMaxUnitario: 20,
      orcamentoTotal: 2000,
      ocasiao: "natal",
    });
  });

  describe("sem resultado", () => {
    it("explica o que não fechou e traz ajuste verificável", async () => {
      const r = await buscar({ consulta: "squeeze", quantidade: 20 });
      expect(r.resultado).toBe("nenhum_produto_encontrado");
      expect(r.motivo).toBe("regras_nao_fecham");
      expect(r.razao).toMatch(/pedido mínimo/);
      expect(r.ajustes_sugeridos).toEqual([
        { tipo: "aumentar_quantidade", produto_id: "squeeze", nome: "Squeeze de Alumínio", quantidade: 50, preco_unitario: 12, total_estimado: 600 },
      ]);
      expect(r.instrucao_ao_agente).toMatch(/Não cite produto/);
    });

    it("sem correspondência no catálogo", async () => {
      const r = await buscar({ consulta: "carro elétrico", quantidade: 5 });
      expect(r).toMatchObject({ resultado: "nenhum_produto_encontrado", motivo: "sem_correspondencia", ajustes_sugeridos: [] });
      expect(r.razao).toContain("carro elétrico");
    });
  });

  describe("falhas de infraestrutura", () => {
    it("API fora na conferência: devolve falha de API (que o runTurn conta), não 'nenhum produto'", async () => {
      client.falhaNoDetalhe.set("caneca", new ApiError(500, {}));
      const r = await buscar({ consulta: "caneca", quantidade: 100 });
      expect(isFalhaApi(r)).toBe(true);
      expect(r.erro.erro).toBe("instabilidade");
    });

    it("401 na conferência exige transferência imediata", async () => {
      client.falhaNoDetalhe.set("caneca", new ApiError(401, {}));
      const r = await buscar({ consulta: "caneca", quantidade: 100 });
      expect(exigeTransferenciaImediata(r)).toBe(true);
    });

    it("índice vazio: falha de sistema com a instrução de como resolver, transferindo", async () => {
      setProductIndexStore(new MemoryProductIndexStore());
      const r = await buscar({ consulta: "caneca" });
      expect(isFalhaApi(r)).toBe(true);
      expect(r.erro).toMatchObject({ erro: "indice_indisponivel", transferir_imediato: true, alerta: true });
      expect(r.erro.detalhes).toMatch(/sync:catalogo/);
    });
  });
});
