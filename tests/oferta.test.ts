import { describe, it, expect } from "vitest";
import { calcularOferta, tetoUnitarioCentavos, type Oferta } from "../src/catalogo/oferta.js";
import type { ProdutoIndexado } from "../src/catalogo/indice.js";

function prod(
  quantidade_minima: number,
  subs: Array<{ id: string; cor: string; estoque: number; faixas: Array<[number, number, number]> }>
): Pick<ProdutoIndexado, "quantidade_minima" | "subprodutos"> {
  return {
    quantidade_minima,
    subprodutos: subs.map((s) => ({
      id: s.id,
      sku: s.id,
      cor: s.cor,
      estoque: s.estoque,
      faixas: s.faixas.map(([min, max, preco]) => ({ min, max, preco })),
    })),
  };
}

const caneca = prod(25, [
  { id: "bco", cor: "Branco", estoque: 300, faixas: [[25, 99, 18.9], [100, 499, 15.4]] },
  { id: "pto", cor: "Preto", estoque: 200, faixas: [[25, 99, 19.9], [100, 499, 16.4]] },
]);

function ok(o: Oferta) {
  if (!o.ok) throw new Error(`esperava oferta, veio ${o.motivo}`);
  return o;
}

describe("calcularOferta — regras rígidas", () => {
  it("usa a faixa de preço da quantidade, não a primeira", () => {
    expect(ok(calcularOferta(caneca, 50)).preco_unitario).toBe(18.9);
    expect(ok(calcularOferta(caneca, 100)).preco_unitario).toBe(15.4);
  });

  it("limites da faixa são inclusivos", () => {
    expect(ok(calcularOferta(caneca, 99)).preco_unitario).toBe(18.9);
    expect(ok(calcularOferta(caneca, 100)).preco_unitario).toBe(15.4);
  });

  it("total = preço × quantidade em centavos exatos", () => {
    const o = ok(calcularOferta(prod(1, [{ id: "a", cor: "x", estoque: 100, faixas: [[1, 99, 0.1]] }]), 3));
    expect(o.total_estimado).toBe(0.3); // 0.1 × 3 em float seria 0.30000000000000004
  });

  it("recusa abaixo do mínimo e diz qual é", () => {
    const o = calcularOferta(caneca, 10);
    expect(o).toMatchObject({ ok: false, motivo: "abaixo_do_minimo", detalhe: { minimo: 25 } });
  });

  it("recusa quando nenhuma cor sozinha cobre a quantidade, mesmo que a soma cubra", () => {
    // 300 + 200 = 500 no total, mas nenhuma cor chega a 400
    const o = calcularOferta(caneca, 400);
    expect(o).toMatchObject({
      ok: false,
      motivo: "estoque_insuficiente",
      detalhe: { maior_estoque_de_uma_cor: 300 },
    });
  });

  it("só oferta as cores que cobrem a quantidade", () => {
    const o = ok(calcularOferta(caneca, 250)); // preto tem 200: fica de fora
    expect(o.cores.map((c) => c.cor)).toEqual(["Branco"]);
  });

  it("cor sem estoque não entra", () => {
    const p = prod(1, [
      { id: "a", cor: "Cristal", estoque: 1200, faixas: [[1, 9999, 2]] },
      { id: "b", cor: "Colorido", estoque: 0, faixas: [[1, 9999, 1]] },
    ]);
    const o = ok(calcularOferta(p, 10));
    expect(o.cores.map((c) => c.cor)).toEqual(["Cristal"]);
    expect(o.preco_unitario).toBe(2); // não o 1 da cor sem estoque
  });

  it("produto sem nenhuma cor com estoque", () => {
    const p = prod(1, [{ id: "a", cor: "x", estoque: 0, faixas: [[1, 9, 1]] }]);
    expect(calcularOferta(p, 5)).toMatchObject({ ok: false, motivo: "sem_estoque" });
  });

  it("quantidade fora de qualquer faixa", () => {
    const p = prod(1, [{ id: "a", cor: "x", estoque: 10000, faixas: [[1, 99, 5]] }]);
    expect(calcularOferta(p, 500)).toMatchObject({ ok: false, motivo: "sem_faixa_de_preco" });
  });

  it("cor com faixa para a quantidade vale mesmo se outra cor não tem", () => {
    const p = prod(1, [
      { id: "a", cor: "x", estoque: 1000, faixas: [[1, 99, 5]] },
      { id: "b", cor: "y", estoque: 1000, faixas: [[1, 999, 7]] },
    ]);
    const o = ok(calcularOferta(p, 200));
    expect(o.cores.map((c) => c.cor)).toEqual(["y"]);
  });
});

describe("calcularOferta — orçamento", () => {
  it("recusa acima do teto unitário e informa o menor preço possível", () => {
    const o = calcularOferta(caneca, 50, { unitarioMax: 15 });
    expect(o).toMatchObject({ ok: false, motivo: "acima_do_orcamento", detalhe: { menor_preco_unitario: 18.9 } });
  });

  it("aceita exatamente no teto", () => {
    expect(calcularOferta(caneca, 50, { unitarioMax: 18.9 }).ok).toBe(true);
  });

  it("teto vindo do total divide pela quantidade, arredondando para baixo", () => {
    // R$ 100 / 3 = 33,33... → teto de R$ 33,33 (nunca 33,34, que estouraria o total)
    expect(tetoUnitarioCentavos({ totalMax: 100 }, 3)).toBe(3333);
    const p = prod(1, [{ id: "a", cor: "x", estoque: 100, faixas: [[1, 99, 33.34]] }]);
    expect(calcularOferta(p, 3, { totalMax: 100 }).ok).toBe(false);
  });

  it("vale o mais restritivo entre unitário e total", () => {
    expect(tetoUnitarioCentavos({ unitarioMax: 20, totalMax: 500 }, 50)).toBe(1000); // total manda: 10,00
    expect(tetoUnitarioCentavos({ unitarioMax: 8, totalMax: 500 }, 50)).toBe(800); // unitário manda
    expect(tetoUnitarioCentavos({}, 50)).toBe(Infinity);
  });

  it("lista só as cores que cabem no orçamento", () => {
    const o = ok(calcularOferta(caneca, 50, { unitarioMax: 19 }));
    expect(o.cores.map((c) => c.cor)).toEqual(["Branco"]); // preto custa 19,90
  });
});

describe("calcularOferta — sem quantidade", () => {
  it("avalia no mínimo do produto e diz que a quantidade não foi informada", () => {
    const o = ok(calcularOferta(caneca, undefined));
    expect(o.quantidade).toBe(25);
    expect(o.quantidade_informada).toBe(false);
    expect(o.preco_unitario).toBe(18.9);
  });

  it("quantidade informada fica marcada como informada", () => {
    expect(ok(calcularOferta(caneca, 25)).quantidade_informada).toBe(true);
  });
});
