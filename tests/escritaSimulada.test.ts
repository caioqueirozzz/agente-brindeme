import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { EscritaSimuladaClient, STATUS_TESTE } from "../src/integrations/brindeme/escritaSimulada.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import type { CreateBudgetBody } from "../src/integrations/brindeme/types.js";

const corpo: CreateBudgetBody = {
  type: "PJ",
  customer_name: "Empresa Teste",
  customer_phone: "5583999990000",
  customer_email: "compras@empresa.test",
  items: [{ subproduct_id: "sub-1", quantity: 50 }],
};

describe("escrita simulada de orçamento", () => {
  it("cria orçamento TESTE sem chamar o POST da loja", async () => {
    const real = new MockBrindeMeClient();
    const post = vi.spyOn(real, "createBudget");
    const cliente = new EscritaSimuladaClient(real);

    const orcamento = await cliente.createBudget(corpo, { idempotencyKey: "tok" });

    expect(post).not.toHaveBeenCalled();
    expect(orcamento.code).toMatch(/^TESTE-/);
    expect(orcamento.status_name).toBe(STATUS_TESTE);
    expect(orcamento.items).toEqual([
      { subproduct_id: "sub-1", quantity: 50, unit_price: 0, subtotal: 0, product_name: "", color: "" },
    ]);
  });

  it("consulta o orçamento simulado pelo id", async () => {
    const cliente = new EscritaSimuladaClient(new MockBrindeMeClient());
    const criado = await cliente.createBudget(corpo);
    expect(await cliente.getBudget(criado.id)).toEqual(criado);
  });

  it("dois orçamentos simulados têm códigos diferentes", async () => {
    const cliente = new EscritaSimuladaClient(new MockBrindeMeClient());
    const a = await cliente.createBudget(corpo);
    const b = await cliente.createBudget(corpo);
    expect(a.code).not.toBe(b.code);
  });

  it("leituras vão para o cliente real", async () => {
    const real = new MockBrindeMeClient();
    const leitura = vi.spyOn(real, "listAdmins");
    await new EscritaSimuladaClient(real).listAdmins();
    expect(leitura).toHaveBeenCalledOnce();
  });
});

describe("escrita simulada com arquivo", () => {
  it("orçamento simulado continua consultável depois de reiniciar", async () => {
    const arquivo = join(mkdtempSync(join(tmpdir(), "simulados-")), "orcamentos-teste.json");
    const criado = await new EscritaSimuladaClient(new MockBrindeMeClient(), arquivo).createBudget(corpo);
    const reiniciado = new EscritaSimuladaClient(new MockBrindeMeClient(), arquivo);
    expect(await reiniciado.getBudget(criado.id)).toEqual(criado);
  });

  it("id de orçamento simulado nunca vai à API da loja", async () => {
    const real = new MockBrindeMeClient();
    const consulta = vi.spyOn(real, "getBudget");
    const cliente = new EscritaSimuladaClient(real, join(mkdtempSync(join(tmpdir(), "simulados-")), "x.json"));
    await expect(cliente.getBudget("teste-00000000-0000-0000-0000-000000000000")).rejects.toThrow();
    expect(consulta).not.toHaveBeenCalled();
  });
});
