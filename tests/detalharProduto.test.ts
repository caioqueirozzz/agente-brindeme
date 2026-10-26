import { describe, it, expect } from "vitest";
import { detalharProdutoHandler } from "../src/tools/detalharProduto.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { createInitialState } from "../src/agent/state.js";
import { isFalhaApi } from "../src/integrations/brindeme/errors.js";

describe("detalhar_produto com id que não existe (eval 06)", () => {
  it("não é falha de sistema: manda achar o id pelo buscar_produtos", async () => {
    const r = await detalharProdutoHandler({ produto_id: "caneca-branca-inventada" }, createInitialState("5583999990000"), new MockBrindeMeClient());
    expect(isFalhaApi(r)).toBe(false);
    expect(r).toMatchObject({ resultado: "produto_nao_encontrado" });
    expect(JSON.stringify(r)).toMatch(/buscar_produtos/);
  });
});

describe("estoque por cor contra a quantidade", () => {
  it("garrafa térmica, 100 unidades: só a Preta (120) cobre; a Branca (80) não", async () => {
    const r = await detalharProdutoHandler({ produto_id: "prod-003", quantidade: 100 }, createInitialState("5583999990000"), new MockBrindeMeClient());
    expect(r).toMatchObject({ cores_que_atendem_quantidade: ["Preta"] });
    const porCor = Object.fromEntries(
      (r as { subprodutos_ativos: Array<{ cor: string; atende_quantidade: boolean | null }> }).subprodutos_ativos.map((s) => [s.cor, s.atende_quantidade])
    );
    expect(porCor).toEqual({ Preta: true, Branca: false });
  });

  it("sem quantidade, nada é comparado", async () => {
    const r = await detalharProdutoHandler({ produto_id: "prod-003" }, createInitialState("5583999990000"), new MockBrindeMeClient());
    expect(r).toMatchObject({ cores_que_atendem_quantidade: null });
    const subs = (r as { subprodutos_ativos: Array<{ atende_quantidade: boolean | null }> }).subprodutos_ativos;
    expect(subs.every((s) => s.atende_quantidade === null)).toBe(true);
  });
});

describe("produtos detalhados guardados para o turno seguinte", () => {
  it("guarda só as cores ativas, com id e cor", async () => {
    const state = createInitialState("5583999990000");
    const pretoInativo = new (class extends MockBrindeMeClient {
      async getProduct(id: string) {
        const p = await super.getProduct(id);
        return { ...p, subproducts: p.subproducts.map((s) => (s.id === "sub-001-preto" ? { ...s, status: false } : s)) };
      }
    })();
    await detalharProdutoHandler({ produto_id: "prod-001" }, state, pretoInativo);
    expect(state.produtosDetalhados).toEqual([
      { id: "prod-001", nome: "Caneca de Porcelana Personalizada", cores: [{ subproduto_id: "sub-001-branco", cor: "Branco" }] },
    ]);
  });

  it("os 3 últimos, o mais recente primeiro, sem repetir produto", async () => {
    const state = createInitialState("5583999990000");
    const client = new MockBrindeMeClient();
    for (const id of ["prod-001", "prod-002", "prod-003", "prod-001", "prod-004"]) {
      await detalharProdutoHandler({ produto_id: id }, state, client);
    }
    expect(state.produtosDetalhados?.map((p) => p.id)).toEqual(["prod-004", "prod-001", "prod-003"]);
  });
});
