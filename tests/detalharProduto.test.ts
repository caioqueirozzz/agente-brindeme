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
