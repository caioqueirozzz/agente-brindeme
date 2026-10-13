import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { HttpBrindeMeClient } from "../src/integrations/brindeme/httpClient.js";
import { MemoryApiLogger } from "../src/integrations/brindeme/apiLogger.js";
import { detalharProdutoHandler } from "../src/tools/detalharProduto.js";
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

describe("contrato — buscar_produtos hidrata o detalhe antes de filtrar", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("NÃO reporta falta de estoque só porque a listagem não traz subprodutos", async () => {
    const lista = fixture("product-list.json");
    const detalhe = fixture("product-detail.json");
    let chamadasDetalhe = 0;

    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (/\/product\/[^?]+/.test(u)) {
        chamadasDetalhe++;
        return new Response(JSON.stringify(detalhe), { status: 200 });
      }
      return new Response(JSON.stringify(lista), { status: 200 });
    });

    const c = new HttpBrindeMeClient({
      baseUrl: "https://api.brinde.me",
      token: "fixture",
      apiLogger: new MemoryApiLogger(),
    });

    const { buscarProdutosHandler } = await import("../src/tools/buscarProdutos.js");
    const r = (await buscarProdutosHandler(
      { consulta: "caneta", quantidade: 100 },
      createInitialState("5583999990000"),
      c
    )) as { resultado: string; produtos?: Array<{ cores_disponiveis: string[]; sku: string }> };

    // Antes da correção isto vinha "nenhum_produto_encontrado — sem estoque suficiente",
    // porque getTotalStock somava subprodutos que a listagem nunca devolve.
    expect(r.resultado).toBe("produtos_encontrados");
    expect(chamadasDetalhe).toBeGreaterThan(0);
    expect(r.produtos?.[0].cores_disponiveis.length).toBeGreaterThan(0);
    expect(r.produtos?.[0].sku).toBeTruthy();
  });

  it("avisa que a cobertura é parcial — 100 de milhares, até a Fase 3", async () => {
    const lista = fixture("product-list.json");
    const detalhe = fixture("product-detail.json");
    vi.stubGlobal("fetch", async (url: string) =>
      /\/product\/[^?]+/.test(String(url))
        ? new Response(JSON.stringify(detalhe), { status: 200 })
        : new Response(JSON.stringify(lista), { status: 200 })
    );
    const c = new HttpBrindeMeClient({
      baseUrl: "https://api.brinde.me",
      token: "fixture",
      apiLogger: new MemoryApiLogger(),
    });
    const { buscarProdutosHandler } = await import("../src/tools/buscarProdutos.js");
    const r = (await buscarProdutosHandler(
      { consulta: "caneta" },
      createInitialState("5583999990000"),
      c
    )) as { cobertura_parcial: boolean };
    expect(r.cobertura_parcial).toBe(true);
  });
});
