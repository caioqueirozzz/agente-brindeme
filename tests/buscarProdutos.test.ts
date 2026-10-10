import { describe, it, expect, beforeEach } from "vitest";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { buscarProdutosHandler } from "../src/tools/buscarProdutos.js";
import { createInitialState } from "../src/agent/state.js";

describe("buscarProdutos", () => {
  let client: MockBrindeMeClient;
  const state = createInitialState("5583999990000");

  beforeEach(() => { client = new MockBrindeMeClient(); });

  it("filtra produto inativo (camiseta)", async () => {
    const result = await buscarProdutosHandler({ consulta: "camiseta" }, state, client) as Record<string, unknown>;
    expect(result).toHaveProperty("resultado");
    if (Array.isArray(result["produtos"])) {
      expect((result["produtos"] as Array<{ id: string }>).every((p) => p.id !== "prod-008")).toBe(true);
    }
  });

  it("filtra por quantidade mínima", async () => {
    const result = await buscarProdutosHandler(
      { consulta: "ecobag", quantidade: 10 },
      state,
      client
    ) as Record<string, unknown>;
    if (Array.isArray(result["produtos"])) {
      expect((result["produtos"] as Array<{ id: string }>).every((p) => p.id !== "prod-005")).toBe(true);
    }
  });

  it("filtra por estoque insuficiente", async () => {
    const result = await buscarProdutosHandler(
      { consulta: "caneca", quantidade: 10000 },
      state,
      client
    );
    expect((result as { resultado: string }).resultado).toBe("nenhum_produto_encontrado");
  });

  it("filtra por preço máximo", async () => {
    const result = await buscarProdutosHandler(
      { consulta: "garrafa", quantidade: 25, preco_max_unitario: 20 },
      state,
      client
    ) as Record<string, unknown>;
    if (Array.isArray(result["produtos"])) {
      expect((result["produtos"] as Array<{ id: string }>).every((p) => p.id !== "prod-003")).toBe(true);
    }
  });

  it("informa qual filtro eliminou candidatos", async () => {
    const result = await buscarProdutosHandler(
      { consulta: "brinde", quantidade: 1, preco_max_unitario: 0.01 },
      state,
      client
    ) as { resultado: string; razao: string };
    expect(result.resultado).toBe("nenhum_produto_encontrado");
    expect(result.razao).toBeTruthy();
  });

  it("calcula preço correto por faixa de quantidade", async () => {
    // caneca prod-001: 25-99 = R$18.90, 100-499 = R$15.40
    const result50 = await buscarProdutosHandler(
      { consulta: "caneca porcelana", quantidade: 50 },
      state,
      client
    ) as { produtos: Array<{ preco_unitario_na_quantidade: number }> };
    const caneca50 = result50.produtos?.[0];
    expect(caneca50?.preco_unitario_na_quantidade).toBe(18.90);

    const result100 = await buscarProdutosHandler(
      { consulta: "caneca porcelana", quantidade: 100 },
      state,
      client
    ) as { produtos: Array<{ preco_unitario_na_quantidade: number }> };
    const caneca100 = result100.produtos?.[0];
    expect(caneca100?.preco_unitario_na_quantidade).toBe(15.40);
  });
});
