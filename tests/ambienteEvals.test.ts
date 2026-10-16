import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { prepararAmbienteDosEvals } from "../evals/ambiente.js";
import { consultarPedidoHandler, setOrderIndexStore } from "../src/tools/consultarPedido.js";
import { setProductIndexStore } from "../src/tools/buscarProdutos.js";
import { setLacunaStore } from "../src/tools/consultarConhecimento.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { createInitialState } from "../src/agent/state.js";

function cenario(id: string) {
  return JSON.parse(readFileSync(join(process.cwd(), "evals/scenarios", `${id}.json`), "utf-8")) as {
    expectativas: Array<{ tipo: string; padrao?: string }>;
  };
}

describe("ambiente dos evals", () => {
  afterEach(() => {
    setOrderIndexStore(null);
    setProductIndexStore(null);
    setLacunaStore(null);
  });

  it("pedido do eval 08 sai dos mocks, não do índice de pedidos de produção (#9)", async () => {
    await prepararAmbienteDosEvals();
    const r = await consultarPedidoHandler(
      { codigo: "PED-2024-001" },
      createInitialState("5583999990000"),
      new MockBrindeMeClient()
    );
    expect(r).toMatchObject({ resultado: "encontrado" });
  });
});

describe("expectativas dos cenários", () => {
  it("eval 01 não reprova quem nega ser pessoa (#10)", () => {
    const { padrao } = cenario("01_saudacao").expectativas.find((e) => e.tipo === "resposta_nao_contem")!;
    const re = new RegExp(padrao!, "i");
    expect(re.test("Oi! Sou a Lia, assistente virtual da loja. Não sou uma pessoa, mas posso ajudar.")).toBe(false);
    expect(re.test("Pode ficar tranquilo, eu sou uma pessoa de verdade.")).toBe(true);
  });
});
