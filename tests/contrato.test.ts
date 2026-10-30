import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { HttpBrindeMeClient } from "../src/integrations/brindeme/httpClient.js";
import { MemoryApiLogger } from "../src/integrations/brindeme/apiLogger.js";
import { detalharProdutoHandler } from "../src/tools/detalharProduto.js";
import {
  buscarProdutosHandler,
  setProductIndexStore,
  setOccasionTagStore,
} from "../src/tools/buscarProdutos.js";
import { MemoryProductIndexStore, sincronizarCatalogo } from "../src/catalogo/indice.js";
import { MemoryOccasionTagStore } from "../src/catalogo/ocasioes.js";
import { createInitialState } from "../src/agent/state.js";

/**
 * Testes de contrato (entregável da Fase 2).
 *
 * Diferente dos testes com stub inventado, estes rodam contra RESPOSTAS REAIS
 * da api.brinde.me, gravadas em 12/10/2026. Os dados pessoais foram trocados
 * por valores sintéticos, mas o SHAPE é o da API — é isso que o teste protege.
 *
 * Se a loja mudar o formato de uma resposta, estes testes quebram.
 */

const fixture = (nome: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures", nome), "utf-8"));

function clientComResposta(payload: unknown) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(payload), { status: 200 }));
  return new HttpBrindeMeClient({
    baseUrl: "https://api.brinde.me",
    token: "fixture",
    apiLogger: new MemoryApiLogger(),
  });
}

describe("contrato — GET /product", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("lê a coleção e a paginação reais", async () => {
    const c = clientComResposta(fixture("product-list.json"));
    const r = await c.listProducts({ per_page: 2 });

    expect(r.data.length).toBeGreaterThan(0);
    expect(r.total).toBeGreaterThan(1000); // catálogo real tem milhares
    expect(r.last_page).toBeGreaterThan(1);
  });

  it("a listagem NÃO traz subprodutos — detalhe_carregado precisa marcar isso", async () => {
    const c = clientComResposta(fixture("product-list.json"));
    const r = await c.listProducts();
    for (const p of r.data) {
      expect(p.detalhe_carregado).toBe(false);
      expect(p.subproducts).toEqual([]);
    }
  });

  it("preço e imagem vêm normalizados mesmo na listagem", async () => {
    const c = clientComResposta(fixture("product-list.json"));
    const [p] = (await c.listProducts()).data;
    expect(typeof p.price).toBe("number");
    expect(p.price).toBeLessThan(1000); // já convertido de centavos
    expect(p.images[0]?.url).toMatch(/^https?:\/\//);
    expect(p.code).toEqual(expect.any(String));
  });
});

describe("contrato — GET /product/{id}", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("traz SKU, cores, estoque, faixas de preço, mínimo e imagens", async () => {
    const c = clientComResposta(fixture("product-detail.json"));
    const p = await c.getProduct("qualquer");

    expect(p.detalhe_carregado).toBe(true);
    expect(p.sku).toBeTruthy();
    expect(p.min_quantity).toBeGreaterThan(0);
    expect(p.images.length).toBeGreaterThan(0);
    expect(p.subproducts.length).toBeGreaterThan(0);

    const sub = p.subproducts[0];
    expect(sub.sku).toBeTruthy();
    expect(typeof sub.color).toBe("string");
    expect(sub.color.length).toBeGreaterThan(0);
    expect(typeof sub.stock).toBe("number");
    expect(sub.prices.length).toBeGreaterThan(0);
    expect(sub.prices[0]).toMatchObject({
      min: expect.any(Number),
      max: expect.any(Number),
      price: expect.any(Number),
    });
  });

  it("a tool detalhar_produto entrega o que o agente precisa", async () => {
    const c = clientComResposta(fixture("product-detail.json"));
    const r = (await detalharProdutoHandler(
      { produto_id: "x", quantidade: 100 },
      createInitialState("5583999990000"),
      c
    )) as {
      nome: string;
      min_quantity: number;
      subprodutos_ativos: Array<{ cor: string; sku: string; estoque: number }>;
      imagens: string[];
      preco_para_quantidade_a_partir_de: number | null;
    };

    expect(r.nome).toBeTruthy();
    expect(r.min_quantity).toBeGreaterThan(0);
    expect(r.subprodutos_ativos.length).toBeGreaterThan(0);
    expect(r.subprodutos_ativos[0].cor).toBeTruthy();
    expect(r.subprodutos_ativos[0].sku).toBeTruthy();
    expect(r.imagens.length).toBeGreaterThan(0);
    expect(r.preco_para_quantidade_a_partir_de).toBeGreaterThan(0);
  });
});

describe("contrato — GET /order", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("envelope { data: { items, pagination } }, diferente do de produtos", async () => {
    const c = clientComResposta(fixture("order-list.json"));
    const r = await c.listOrders({ per_page: 1 });
    expect(r.data.length).toBeGreaterThan(0);
    const o = r.data[0];
    expect(o.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(o.code).toEqual(expect.any(String));
    expect(o.status_name).toBeTruthy();
  });

  it("valores monetários convertidos de centavos", async () => {
    const c = clientComResposta(fixture("order-list.json"));
    const [o] = (await c.listOrders()).data;
    expect(o.total).toBeGreaterThan(0);
    // 112650 centavos = 1126.50; se não convertesse, passaria de 100 mil
    expect(o.total).toBeLessThan(100_000);
  });
});

describe("contrato — GET /budget", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("status, cliente e responsável aninhados são lidos corretamente", async () => {
    const payload = fixture("budget-list.json") as { data: { items: unknown[] } };
    const primeiro = payload.data.items[0];
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: primeiro }), { status: 200 }));
    const c = new HttpBrindeMeClient({
      baseUrl: "https://api.brinde.me",
      token: "fixture",
      apiLogger: new MemoryApiLogger(),
    });

    const b = await c.getBudget("x");
    expect(b.code).toEqual(expect.any(String));
    expect(b.status_name).toBeTruthy();
    expect(b.type === "PF" || b.type === "PJ").toBe(true);
    expect(b.items.length).toBeGreaterThan(0);
  });

  it("NUNCA expõe o custo interno da loja", async () => {
    const payload = fixture("budget-list.json") as { data: { items: unknown[] } };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ data: payload.data.items[0] }), { status: 200 })
    );
    const c = new HttpBrindeMeClient({
      baseUrl: "https://api.brinde.me",
      token: "fixture",
      apiLogger: new MemoryApiLogger(),
    });
    const b = await c.getBudget("x");
    expect(JSON.stringify(b)).not.toContain('"cost"');
  });
});

describe("contrato — GET /admin", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("lista os responsáveis com id, nome e e-mail", async () => {
    const c = clientComResposta(fixture("admin-list.json"));
    const admins = await c.listAdmins();
    expect(admins.length).toBeGreaterThan(0);
    expect(admins[0].id).toBeTruthy();
    expect(admins[0].name).toBeTruthy();
  });
});

describe("contrato — nenhum dado sensível vaza para o modelo", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("a resposta de pedido do cliente não carrega CPF, e-mail, telefone, NF nem boleto", async () => {
    const payload = fixture("order-list.json") as { data: { items: Array<Record<string, unknown>> } };
    const bruto = payload.data.items[0];

    // O payload cru da API tem esses campos...
    expect(Object.keys(bruto)).toEqual(
      expect.arrayContaining(["customer_cpf", "customer_email", "customer_phone"])
    );

    // ...e o que chega ao modelo, não.
    const { buildSafeResultParaTeste } = await import("./helpers/pedidoSeguro.js");
    const seguro = buildSafeResultParaTeste(bruto);
    const json = JSON.stringify(seguro);
    for (const campo of ["cpf", "bankslip", "nfs", "file_url", "@"]) {
      expect(json.toLowerCase()).not.toContain(campo);
    }
  });
});

describe("contrato — catálogo: listagem real → índice → recomendação", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /** Responde a listagem com a fixture e cada GET /product/{id} com o detalhe real, já com o id pedido. */
  function stubApi(contador?: { detalhes: number }) {
    const lista = fixture("product-list.json");
    const detalhe = fixture("product-detail.json") as { data: Record<string, unknown> };
    vi.stubGlobal("fetch", async (url: string) => {
      const m = /\/product\/([^?/]+)/.exec(String(url));
      if (m) {
        if (contador) contador.detalhes++;
        return new Response(JSON.stringify({ data: { ...detalhe.data, id: m[1] } }), { status: 200 });
      }
      return new Response(JSON.stringify(lista), { status: 200 });
    });
    return new HttpBrindeMeClient({
      baseUrl: "https://api.brinde.me",
      token: "fixture",
      apiLogger: new MemoryApiLogger(),
    });
  }

  it("a listagem real traz updated_at — base da sincronização incremental", async () => {
    const c = stubApi();
    for (const p of (await c.listProducts()).data) {
      expect(p.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("NÃO reporta falta de estoque só porque a listagem não traz subprodutos", async () => {
    const contador = { detalhes: 0 };
    const c = stubApi(contador);
    const store = new MemoryProductIndexStore();
    await sincronizarCatalogo(c, store);
    setProductIndexStore(store);
    setOccasionTagStore(new MemoryOccasionTagStore());

    const r = (await buscarProdutosHandler(
      { consulta: "caneta", quantidade: 100 },
      createInitialState("5583999990000"),
      c
    )) as {
      resultado: string;
      produtos?: Array<{ cores_disponiveis: string[]; sku: string; preco_unitario_na_quantidade: number }>;
    };

    expect(r.resultado).toBe("produtos_encontrados");
    // o detalhe foi lido na sincronização E conferido de novo na recomendação
    expect(contador.detalhes).toBeGreaterThan(2);
    expect(r.produtos?.[0].cores_disponiveis.length).toBeGreaterThan(0);
    expect(r.produtos?.[0].sku).toBeTruthy();
    // preço real em centavos (68) convertido para reais
    expect(r.produtos?.[0].preco_unitario_na_quantidade).toBeLessThan(10);
  });

  it("o registro do índice guarda só o necessário para recomendar", async () => {
    const store = new MemoryProductIndexStore();
    await sincronizarCatalogo(stubApi(), store);
    const [registro] = store.carregar().produtos;
    expect(Object.keys(registro).sort()).toEqual(
      [
        "ausencias", "atualizado_em", "categorias", "codigo", "descricao", "destaque", "id",
        "imagem_url", "etiquetas_embutidas", "nome", "personalizacoes", "quantidade_minima",
        "sincronizado_em", "sku", "slug", "subprodutos",
      ].sort()
    );
    expect(JSON.stringify(registro)).not.toMatch(/"cost"|cpf|bankslip/i);
  });
});
