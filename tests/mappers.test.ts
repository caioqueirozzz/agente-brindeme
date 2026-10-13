import { describe, it, expect } from "vitest";
import {
  mapProduct,
  mapOrder,
  mapAdmin,
  mapPrices,
  mapSubproduct,
  unwrapCollection,
  unwrapResource,
  money,
  mapBudget,
} from "../src/integrations/brindeme/mappers.js";

/**
 * Fixtures espelham o shape REAL observado em api.brinde.me (out/2026).
 * Dados sintéticos de propósito: a resposta real traz CPF, e-mail e CNPJ de
 * clientes, que não entram no repositório.
 */

const PRODUTO_LISTAGEM = {
  id: "dfa3d674-9202-40c1-a60c-48937db9e2be",
  slug: "caneta-ecologica-kraft",
  code: 15437,
  name: "Caneta Ecológica Kraft",
  description: "Caneta em kraft",
  tech_description: "<b>Altura:</b> 13,3 cm",
  status: true,
  sku: "09319",
  tag: null,
  image: { image_url: { original: "https://cdn.brinde.me/p/orig.jpg", thumb: "https://cdn/t.jpg" } },
  featured: false,
  recent: false,
  stock: 119862,
  price: 377,
};

const PRODUTO_DETALHE = {
  ...PRODUTO_LISTAGEM,
  min_quantity: 20,
  images: [{ id: "img-1", image_url: { original: "https://cdn.brinde.me/p/1.jpg" } }],
  categories: [{ id: "cat-1", name: "Canetas" }],
  customizations: [],
  subproducts: [
    {
      id: "sub-preto",
      product_id: "dfa3d674",
      color_id: "c1",
      sku: "09319-PRE",
      status: true,
      image: { image_url: { original: "https://cdn.brinde.me/s/preto.jpg" } },
      color: { id: "c1", name: "Preto" },
      stock: 19977,
      prices: [{ init_quantity: 1, final_quantity: 9999999, price: 68 }],
    },
  ],
};

describe("mappers — produto", () => {
  it("converte code int, preço em centavos e imagem aninhada", () => {
    const p = mapProduct(PRODUTO_LISTAGEM);
    expect(p.code).toBe("15437");
    expect(p.price).toBeCloseTo(3.77);
    expect(p.images[0].url).toBe("https://cdn.brinde.me/p/orig.jpg");
  });

  it("marca detalhe_carregado=false na listagem — ela não traz subprodutos", () => {
    const p = mapProduct(PRODUTO_LISTAGEM);
    expect(p.detalhe_carregado).toBe(false);
    expect(p.subproducts).toEqual([]);
    expect(p.min_quantity).toBe(1); // ausente na listagem
  });

  it("marca detalhe_carregado=true e traz os campos completos no detalhe", () => {
    const p = mapProduct(PRODUTO_DETALHE);
    expect(p.detalhe_carregado).toBe(true);
    expect(p.min_quantity).toBe(20);
    expect(p.categories[0].name).toBe("Canetas");
    expect(p.subproducts).toHaveLength(1);
  });

  it("subproduto: color objeto vira string, preço vira reais", () => {
    const s = mapSubproduct(PRODUTO_DETALHE.subproducts[0]);
    expect(s.color).toBe("Preto");
    expect(s.sku).toBe("09319-PRE");
    expect(s.stock).toBe(19977);
    expect(s.prices[0].price).toBeCloseTo(0.68);
  });

  it("prices: init_quantity/final_quantity viram min/max", () => {
    const r = mapPrices([{ init_quantity: 50, final_quantity: 99, price: 1250 }]);
    expect(r[0]).toEqual({ min: 50, max: 99, price: 12.5 });
  });
});

describe("mappers — envelopes", () => {
  it("coleção de produtos: { data: [], pagination: {} }", () => {
    const { items, paginacao } = unwrapCollection({
      data: [PRODUTO_LISTAGEM],
      pagination: { total: 6535, per_page: 2, current_page: 1, last_page: 3268 },
    });
    expect(items).toHaveLength(1);
    expect(paginacao.total).toBe(6535);
    expect(paginacao.last_page).toBe(3268);
  });

  it("coleção de pedidos: { data: { items: [], pagination: {} } } — envelope diferente", () => {
    const { items, paginacao } = unwrapCollection({
      data: { items: [{ id: "o1" }, { id: "o2" }], pagination: { total: 2, per_page: 3 } },
    });
    expect(items).toHaveLength(2);
    expect(paginacao.total).toBe(2);
  });

  it("coleção de admins: { data: [] } sem paginação", () => {
    const { items, paginacao } = unwrapCollection({ data: [{ id: "a1" }] });
    expect(items).toHaveLength(1);
    expect(paginacao.total).toBe(1);
  });

  it("recurso único em { data }", () => {
    expect(unwrapResource({ data: { id: "x" } })).toEqual({ id: "x" });
  });

  it("recurso de POST /budget em { resource }", () => {
    expect(unwrapResource({ resource: { code: 10 } })).toEqual({ code: 10 });
  });

  it("paginação com valores em string ainda vira número", () => {
    const { paginacao } = unwrapCollection({
      data: [],
      pagination: { total: "6535", per_page: "100", current_page: "1" },
    });
    expect(paginacao.total).toBe(6535);
    expect(paginacao.per_page).toBe(100);
  });
});

describe("mappers — pedido", () => {
  const PEDIDO = {
    id: "537c4238-f904-45af-8885-d97d1bcac108",
    code: 2,
    budget_code: 10,
    type: "PJ",
    customer_name: "Fulano de Tal",
    customer_cpf: null,
    customer_email: "fulano@exemplo.test",
    customer_phone: "(83) 99999-0000",
    status_id: "7bb0e82d-b221-4c72-b38b-404f4197548f",
    status_name: "Aprovado",
    shipping_type: null,
    shipping_time: null,
    subtotal: 112650,
    total: 112650,
    items: [
      {
        subproduct_id: "sub-1",
        product_name: "Caneca",
        color_name: "Branco",
        quantity: "50",
        price: 2253,
        total: 112650,
      },
    ],
    file_url: null,
    nfs: [],
    bankslips: [],
  };

  it("code int vira string e status_id é UUID, não número", () => {
    const o = mapOrder(PEDIDO);
    expect(o.code).toBe("2");
    expect(o.status_id).toBe("7bb0e82d-b221-4c72-b38b-404f4197548f");
    expect(o.status_name).toBe("Aprovado");
  });

  it("valores em centavos viram reais", () => {
    const o = mapOrder(PEDIDO);
    expect(o.total).toBeCloseTo(1126.5);
    expect(o.items[0].unit_price).toBeCloseTo(22.53);
    expect(o.items[0].quantity).toBe(50);
  });

  it("shipping_time null é preservado — a loja pode não ter definido frete", () => {
    const o = mapOrder(PEDIDO);
    expect(o.shipping_time).toBeNull();
  });

  it("telefone formatado da API continua casando com o da conversa", async () => {
    const { phoneMatches } = await import("../src/agent/state.js");
    const o = mapOrder(PEDIDO);
    expect(phoneMatches("5583999990000", o.customer_phone)).toBe(true);
  });
});

describe("mappers — admin e dinheiro", () => {
  it("admin", () => {
    const a = mapAdmin({ id: "a1", name: "Fulana", email: "f@x.test", phone: "(83) 90000-0000" });
    expect(a.name).toBe("Fulana");
  });

  it("money converte centavos para reais", () => {
    expect(money(377)).toBeCloseTo(3.77);
    expect(money("1250")).toBeCloseTo(12.5);
    expect(money(null)).toBe(0);
  });
});

describe("mappers — orçamento (shape aninhado real)", () => {
  const ORCAMENTO = {
    id: "c07fa6bd-4ec5-493d-bd99-bfd66771a02d",
    code: 21,
    type: "PJ",
    status: { id: "9fbc9a44-09d4-495a-bb77-bb0223d6958d", name: "Pendente de aprovação" },
    customer: { id: "9ce39af3", code: 425, name: "Fulano", email: "f@exemplo.test", phone: "(83) 90000-0000" },
    billing_company: { company_name: "EMPRESA LTDA", trade_name: "EMPRESA" },
    admin: { id: "adm-1", name: "Vendedora" },
    subtotal: 1357490,
    total: 1357490,
    comments: null,
    created_at: "2026-10-02T19:00:17-03:00",
    items: [
      {
        id: "a05dcf35",
        subproduct_id: "27a3a6bc",
        quantity: 62,
        price: 5886,
        cost: 2580,
        product_mock_image_url: "https://cdn.brinde.me/mock/1.png",
        subproduct: { id: "27a3a6bc", product_name: "Caneca", color: { id: "c1", name: "Azul" } },
      },
    ],
  };

  it("lê status, cliente e responsável aninhados", () => {
    const b = mapBudget(ORCAMENTO);
    expect(b.code).toBe("21");
    expect(b.status_name).toBe("Pendente de aprovação");
    expect(b.customer_name).toBe("Fulano");
    expect(b.customer_email).toBe("f@exemplo.test");
    expect(b.admin_id).toBe("adm-1");
  });

  it("item: subproduto aninhado, cor como objeto, subtotal calculado", () => {
    const b = mapBudget(ORCAMENTO);
    const i = b.items[0];
    expect(i.product_name).toBe("Caneca");
    expect(i.color).toBe("Azul");
    expect(i.quantity).toBe(62);
    expect(i.unit_price).toBeCloseTo(58.86);
    expect(i.subtotal).toBeCloseTo(58.86 * 62);
  });

  it("NUNCA expõe `cost` — é o custo interno da loja", () => {
    const b = mapBudget(ORCAMENTO);
    expect(JSON.stringify(b)).not.toContain("2580");
    expect(JSON.stringify(b)).not.toContain("cost");
  });

  it("promove o mockup do item para o orçamento", () => {
    expect(mapBudget(ORCAMENTO).mockup_url).toBe("https://cdn.brinde.me/mock/1.png");
  });
});

describe("mappers — precisão monetária", () => {
  it("não deixa artefato de float chegar ao cliente", () => {
    // 7860 centavos = R$ 78,60 — e não 78.60000000000001
    expect(money(7860)).toBe(78.6);
    expect(money(1)).toBe(0.01);
    expect(money(333)).toBe(3.33);
    expect(String(money(7860))).not.toContain("0000");
  });

  it("subtotal calculado também fica exato", () => {
    const b = mapBudget({
      id: "b", code: 1, type: "PF", status: { name: "X" },
      items: [{ subproduct_id: "s", quantity: 20, price: 393, subproduct: { product_name: "P" } }],
    });
    expect(b.items[0].subtotal).toBe(78.6);
  });
});
