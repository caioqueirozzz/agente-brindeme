import { describe, it, expect, beforeEach } from "vitest";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { consultarPedidoHandler, type PedidoSafeResult } from "../src/tools/consultarPedido.js";
import { createInitialState } from "../src/agent/state.js";

type ResultadoField = Extract<PedidoSafeResult, { resultado: string }>["resultado"];

const SENSITIVE_FIELDS = ["customer_cpf", "customer_email", "customer_phone", "file_url", "nfs", "bankslips", "123.456.789-00", "joao.silva@empresa.com.br"];

describe("consultarPedido", () => {
  let client: MockBrindeMeClient;

  beforeEach(() => { client = new MockBrindeMeClient(); });

  it("encontra pedido com telefone correto", async () => {
    const state = createInitialState("5583999990000");
    const result = await consultarPedidoHandler({ codigo: "PED-2024-001" }, state, client);
    expect((result as Extract<PedidoSafeResult, { resultado: ResultadoField }>).resultado).toBe("encontrado");
  });

  it("encontra pedido com telefone sem código de país", async () => {
    const state = createInitialState("83999990000");
    const result = await consultarPedidoHandler({ codigo: "PED-2024-001" }, state, client);
    expect((result as Extract<PedidoSafeResult, { resultado: ResultadoField }>).resultado).toBe("encontrado");
  });

  it("pede email quando telefone não bate", async () => {
    const state = createInitialState("5511000000001");
    const result = await consultarPedidoHandler({ codigo: "PED-2024-001" }, state, client);
    expect((result as Extract<PedidoSafeResult, { resultado: ResultadoField }>).resultado).toBe("precisa_email");
  });

  it("valida com email correto quando telefone não bate", async () => {
    const state = createInitialState("5511000000001");
    const result = await consultarPedidoHandler(
      { codigo: "PED-2024-001", email: "joao.silva@empresa.com.br" },
      state,
      client
    );
    expect((result as Extract<PedidoSafeResult, { resultado: ResultadoField }>).resultado).toBe("encontrado");
  });

  it("não valida com email errado", async () => {
    const state = createInitialState("5511000000001");
    const result = await consultarPedidoHandler(
      { codigo: "PED-2024-001", email: "errado@email.com" },
      state,
      client
    );
    expect((result as Extract<PedidoSafeResult, { resultado: ResultadoField }>).resultado).toBe("nao_validado");
    expect(state.falhasValidacaoPedido).toBe(1);
  });

  it("bloqueia após 2 falhas de validação", async () => {
    const state = createInitialState("5511000000001");
    await consultarPedidoHandler({ codigo: "PED-2024-001", email: "errado@email.com" }, state, client);
    const result = await consultarPedidoHandler({ codigo: "PED-2024-001", email: "errado2@email.com" }, state, client);
    expect((result as Extract<PedidoSafeResult, { resultado: ResultadoField }>).resultado).toBe("bloqueado");
  });

  it("NUNCA vaza campos sensíveis na resposta", async () => {
    const state = createInitialState("5583999990000");
    const result = await consultarPedidoHandler({ codigo: "PED-2024-001" }, state, client);
    const json = JSON.stringify(result);
    for (const field of SENSITIVE_FIELDS) {
      expect(json).not.toContain(field);
    }
  });

  it("retorna nao_encontrado para código inexistente", async () => {
    const state = createInitialState("5583999990000");
    const result = await consultarPedidoHandler({ codigo: "PED-9999-999" }, state, client);
    expect((result as Extract<PedidoSafeResult, { resultado: ResultadoField }>).resultado).toBe("nao_encontrado");
  });
});
