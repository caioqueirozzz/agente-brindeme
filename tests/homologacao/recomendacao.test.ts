/**
 * Homologação da Fase 6 — H2: recomendações e precisão das informações.
 * Um oráculo independente, escrito a partir das regras de negócio e lendo direto mocks/products.json,
 * confere o que buscar_produtos, detalhar_produto e preparar_orcamento devolvem para TODO o catálogo
 * em cada fronteira de faixa de quantidade. Divergência aqui é preço errado na boca do agente.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialState, type ConversationState } from "../../src/agent/state.js";
import { MockBrindeMeClient } from "../../src/integrations/brindeme/mockClient.js";
import type { Product } from "../../src/integrations/brindeme/types.js";
import { buscarProdutosHandler } from "../../src/tools/buscarProdutos.js";
import { detalharProdutoHandler } from "../../src/tools/detalharProduto.js";
import { prepararOrcamentoHandler } from "../../src/tools/prepararOrcamento.js";
import { usarIndiceDoMock } from "../helpers/catalogo.js";
import { TEL, restaurarAmbiente } from "./bancada.js";

const CATALOGO: Product[] = JSON.parse(readFileSync(join(process.cwd(), "mocks/products.json"), "utf-8"));

/** Quantidades que exercitam cada fronteira: mínimo−1, mínimo, e o min/max de cada faixa de cada cor. */
function quantidadesDeTeste(p: Product): number[] {
  const q = new Set<number>([p.min_quantity - 1, p.min_quantity]);
  for (const s of p.subproducts) for (const f of s.prices) q.add(f.min).add(f.max).add(f.min - 1);
  return [...q].filter((n) => n > 0 && n <= 2000).sort((a, b) => a - b);
}

/** Oráculo: o que a loja aceitaria vender, por cor, naquela quantidade. */
function esperado(p: Product, quantidade: number) {
  if (!p.status || quantidade < p.min_quantity) return [];
  return p.subproducts
    .filter((s) => s.status && s.stock >= quantidade)
    .map((s) => ({ s, faixa: s.prices.find((f) => quantidade >= f.min && quantidade <= f.max) }))
    .filter((x) => x.faixa)
    .map((x) => ({ id: x.s.id, cor: x.s.color, preco: x.faixa!.price }));
}

const centavos = (v: number) => Math.round(v * 100);

let state: ConversationState;
const client = new MockBrindeMeClient();

beforeEach(async () => {
  await usarIndiceDoMock();
  state = createInitialState(TEL);
});
afterEach(restaurarAmbiente);

describe("H2 — precisão de preço, mínimo e estoque em todo o catálogo", () => {
  for (const produto of CATALOGO) {
    it(`H2.1 ${produto.id} (${produto.name}): buscar_produtos bate com a tabela em cada fronteira de faixa`, async () => {
      for (const quantidade of quantidadesDeTeste(produto)) {
        const r = (await buscarProdutosHandler({ consulta: produto.name, quantidade }, state, client)) as {
          resultado: string;
          produtos?: Array<{ id: string; preco_unitario_na_quantidade: number; total_estimado: number; cores_disponiveis: string[] }>;
        };
        const achado = r.produtos?.find((x) => x.id === produto.id);
        const cores = esperado(produto, quantidade);
        const contexto = `${produto.id} × ${quantidade}`;
        if (cores.length === 0) {
          expect(achado, `${contexto}: não podia ser sugerido`).toBeUndefined();
          continue;
        }
        expect(achado, `${contexto}: devia ser sugerido`).toBeDefined();
        const menor = Math.min(...cores.map((c) => c.preco));
        expect(achado!.preco_unitario_na_quantidade, contexto).toBe(menor);
        expect(centavos(achado!.total_estimado), contexto).toBe(centavos(menor) * quantidade);
        expect(new Set(achado!.cores_disponiveis), contexto).toEqual(new Set(cores.map((c) => c.cor)));
      }
    });
  }

  it("H2.2 detalhar_produto dá o preço de CADA cor (a caneca preta é mais cara que a branca)", async () => {
    const r = (await detalharProdutoHandler({ produto_id: "prod-001", quantidade: 100 }, state, client)) as {
      precos_variam_por_cor: boolean;
      subprodutos_ativos: Array<{ subproduto_id: string; preco_para_quantidade: number }>;
    };
    expect(r.precos_variam_por_cor).toBe(true);
    const preco = Object.fromEntries(r.subprodutos_ativos.map((s) => [s.subproduto_id, s.preco_para_quantidade]));
    expect(preco).toEqual({ "sub-001-branco": 15.4, "sub-001-preto": 16.4 });
  });

  it("H2.3 detalhar_produto não lista cor inativa e marca cor sem estoque como indisponível", async () => {
    const r = (await detalharProdutoHandler({ produto_id: "prod-006" }, state, client)) as {
      subprodutos_ativos: Array<{ subproduto_id: string; disponivel: boolean }>;
    };
    expect(r.subprodutos_ativos.find((s) => s.subproduto_id === "sub-006-colorido")?.disponivel).toBe(false);
  });

  it("H2.4 preparar_orcamento: subtotal de cada cor = preço da faixa × quantidade, em centavos exatos", async () => {
    for (const produto of CATALOGO) {
      for (const sub of produto.subproducts) state.subprodutoParaProduto[sub.id] = produto.id;
      for (const quantidade of quantidadesDeTeste(produto)) {
        for (const cor of esperado(produto, quantidade)) {
          const r = (await prepararOrcamentoHandler(
            { tipo: "PF", nome: "Oráculo", email: "o@teste.com", itens: [{ subproduto_id: cor.id, quantidade }] },
            state,
            client
          )) as { resumo?: { itens: Array<{ preco_unitario: number; subtotal: number }>; total_estimado: number } };
          const contexto = `${cor.id} × ${quantidade}`;
          expect(r.resumo, contexto).toBeDefined();
          expect(r.resumo!.itens[0].preco_unitario, contexto).toBe(cor.preco);
          expect(centavos(r.resumo!.total_estimado), contexto).toBe(centavos(cor.preco) * quantidade);
        }
      }
    }
  });

  it("H2.5 preparar_orcamento recusa abaixo do mínimo, estoque insuficiente e produto inativo", async () => {
    for (const p of CATALOGO) for (const s of p.subproducts) state.subprodutoParaProduto[s.id] = p.id;
    const preparar = (subproduto_id: string, quantidade: number) =>
      prepararOrcamentoHandler(
        { tipo: "PF", nome: "Teste", email: "t@teste.com", itens: [{ subproduto_id, quantidade }] },
        state,
        client
      ) as Promise<{ erro?: string }>;
    expect((await preparar("sub-001-branco", 24)).erro).toBe("abaixo_do_minimo");
    expect((await preparar("sub-003-branca", 81)).erro).toBe("estoque_insuficiente");
    // prod-008 está desativado na loja: barra antes de olhar a cor.
    expect((await preparar("sub-008-branca", 30)).erro).toBe("produto_inativo");
    expect((await preparar("sub-006-colorido", 100)).erro).toBe("estoque_insuficiente");
  });

  it("H2.6 [correção Fase 6] quantidade fora de todas as faixas não cai no preço de referência", async () => {
    // 10.000 canecas: a última faixa da branca vai até 9.999. Antes saía o price do produto (R$ 18,90).
    const semLimite = new (class extends MockBrindeMeClient {
      async getProduct(id: string) {
        const p = await super.getProduct(id);
        return { ...p, subproducts: p.subproducts.map((s) => ({ ...s, stock: 100_000 })) };
      }
    })();
    state.subprodutoParaProduto["sub-001-branco"] = "prod-001";
    const r = (await prepararOrcamentoHandler(
      { tipo: "PJ", nome: "Atacado", email: "a@teste.com", itens: [{ subproduto_id: "sub-001-branco", quantidade: 10_000 }] },
      state,
      semLimite
    )) as { erro?: string; resumo?: unknown };
    expect(r.erro).toBe("sem_faixa_de_preco");
    expect(r.resumo).toBeUndefined();
    expect(state.fichaPedido).toBeUndefined();
  });

  it("H2.7 [correção Fase 6] produto desativado com cor ainda ativa não é orçado", async () => {
    const desativado = new (class extends MockBrindeMeClient {
      async getProduct(id: string) {
        return { ...(await super.getProduct(id)), status: false };
      }
    })();
    state.subprodutoParaProduto["sub-002-prata"] = "prod-002";
    const r = (await prepararOrcamentoHandler(
      { tipo: "PF", nome: "Teste", email: "t@teste.com", itens: [{ subproduto_id: "sub-002-prata", quantidade: 60 }] },
      state,
      desativado
    )) as { erro?: string };
    expect(r.erro).toBe("produto_inativo");
  });

  it("H2.8 orçamento total sem quantidade não vira preço: pede a quantidade", async () => {
    const r = (await buscarProdutosHandler({ consulta: "caneca", orcamento_total: 1000 }, state, client)) as {
      resultado: string;
      faltando: string[];
    };
    expect(r).toMatchObject({ resultado: "faltam_dados", faltando: ["quantidade"] });
  });

  it("H2.9 sem quantidade, a busca não passa preço nenhum (preço muda por faixa)", async () => {
    const r = (await buscarProdutosHandler({ consulta: "caneca" }, state, client)) as {
      aviso?: string;
      produtos: Array<Record<string, unknown>>;
    };
    expect(r.aviso).toMatch(/não passe valor/);
    for (const p of r.produtos) {
      expect(p).not.toHaveProperty("preco_unitario_na_quantidade");
      expect(p).not.toHaveProperty("total_estimado");
    }
  });

  it("H2.10 teto por unidade e teto total: nada sugerido acima do valor do cliente", async () => {
    const r = (await buscarProdutosHandler(
      { consulta: "brinde corporativo", quantidade: 100, orcamento_total: 1500 },
      state,
      client
    )) as { produtos?: Array<{ preco_unitario_na_quantidade: number; total_estimado: number }> };
    for (const p of r.produtos ?? []) {
      expect(p.preco_unitario_na_quantidade).toBeLessThanOrEqual(15);
      expect(p.total_estimado).toBeLessThanOrEqual(1500);
    }
  });

  it("H2.11 no máximo 3 sugestões por busca", async () => {
    const r = (await buscarProdutosHandler({ consulta: "personalizado", quantidade: 100 }, state, client)) as {
      produtos?: unknown[];
    };
    expect((r.produtos ?? []).length).toBeLessThanOrEqual(3);
  });
});
