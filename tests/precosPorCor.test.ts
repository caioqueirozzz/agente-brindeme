import { describe, it, expect, beforeEach } from "vitest";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { detalharProdutoHandler } from "../src/tools/detalharProduto.js";
import { buscarProdutosHandler } from "../src/tools/buscarProdutos.js";
import { createInitialState } from "../src/agent/state.js";
import { readFileSync } from "fs";
import { join } from "path";
import type { Product } from "../src/integrations/brindeme/types.js";

const produtos: Product[] = JSON.parse(
  readFileSync(join(process.cwd(), "mocks/products.json"), "utf-8")
);

/** Produto cujas cores têm tabelas de preço diferentes. */
const comPrecosDistintos = produtos.find(
  (p) => new Set(p.subproducts.filter((s) => s.status).map((s) => JSON.stringify(s.prices))).size > 1
)!;

/** Produto cujas cores compartilham a mesma tabela. */
const comPrecoUniforme = produtos.find(
  (p) =>
    p.subproducts.filter((s) => s.status).length > 1 &&
    new Set(p.subproducts.filter((s) => s.status).map((s) => JSON.stringify(s.prices))).size === 1
)!;

describe("preços por cor", () => {
  let client: MockBrindeMeClient;
  let state: ReturnType<typeof createInitialState>;

  beforeEach(() => {
    client = new MockBrindeMeClient();
    state = createInitialState("5583999990000");
  });

  it("os mocks realmente têm produto com preço variando por cor", () => {
    expect(comPrecosDistintos).toBeDefined();
    expect(comPrecoUniforme).toBeDefined();
  });

  it("cada subproduto carrega a própria tabela de preços", async () => {
    const r = (await detalharProdutoHandler(
      { produto_id: comPrecosDistintos.id },
      state,
      client
    )) as {
      precos_variam_por_cor: boolean;
      tabela_precos: unknown;
      subprodutos_ativos: Array<{ cor: string; tabela_precos: Array<{ preco: number }> }>;
    };

    expect(r.precos_variam_por_cor).toBe(true);
    // tabela única fica null: forçar o agente a olhar por cor
    expect(r.tabela_precos).toBeNull();

    const assinaturas = new Set(r.subprodutos_ativos.map((s) => JSON.stringify(s.tabela_precos)));
    expect(assinaturas.size).toBeGreaterThan(1);
  });

  it("mantém tabela única quando todas as cores custam igual", async () => {
    const r = (await detalharProdutoHandler(
      { produto_id: comPrecoUniforme.id },
      state,
      client
    )) as { precos_variam_por_cor: boolean; tabela_precos: Array<{ preco: number }> };

    expect(r.precos_variam_por_cor).toBe(false);
    expect(Array.isArray(r.tabela_precos)).toBe(true);
    expect(r.tabela_precos.length).toBeGreaterThan(0);
  });

  it("preco_para_quantidade de cada cor reflete a faixa daquela cor", async () => {
    const sub = comPrecosDistintos.subproducts.find((s) => s.status)!;
    const faixa = sub.prices[0];
    const qty = faixa.min;

    const r = (await detalharProdutoHandler(
      { produto_id: comPrecosDistintos.id, quantidade: qty },
      state,
      client
    )) as {
      preco_para_quantidade_a_partir_de: number | null;
      subprodutos_ativos: Array<{ subproduto_id: string; preco_para_quantidade: number | null }>;
    };

    for (const s of r.subprodutos_ativos) {
      const esperado =
        comPrecosDistintos.subproducts
          .find((x) => x.id === s.subproduto_id)!
          .prices.find((p) => qty >= p.min && qty <= p.max)?.price ?? null;
      expect(s.preco_para_quantidade).toBe(esperado);
    }

    const precos = r.subprodutos_ativos
      .map((s) => s.preco_para_quantidade)
      .filter((v): v is number => v !== null);
    expect(r.preco_para_quantidade_a_partir_de).toBe(Math.min(...precos));
  });

  it("buscar_produtos anuncia o MENOR preço entre as cores, não o da primeira", async () => {
    const qty = Math.max(
      comPrecosDistintos.min_quantity,
      comPrecosDistintos.subproducts.find((s) => s.status)!.prices[0].min
    );

    const r = (await buscarProdutosHandler(
      { consulta: comPrecosDistintos.name, quantidade: qty },
      state,
      client
    )) as {
      resultado: string;
      produtos: Array<{ id: string; preco_unitario_na_quantidade: number | null }>;
    };

    const encontrado = r.produtos?.find((p) => p.id === comPrecosDistintos.id);
    expect(encontrado).toBeDefined();

    const candidatos = comPrecosDistintos.subproducts
      .filter((s) => s.status && s.stock > 0)
      .map((s) => s.prices.find((p) => qty >= p.min && qty <= p.max)?.price)
      .filter((v): v is number => v !== undefined);

    expect(encontrado!.preco_unitario_na_quantidade).toBe(Math.min(...candidatos));
  });
});
