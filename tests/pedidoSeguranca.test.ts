import { describe, it, expect, beforeEach } from "vitest";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { consultarPedidoHandler } from "../src/tools/consultarPedido.js";
import { createInitialState } from "../src/agent/state.js";
import { setOrderIndexStore } from "../src/tools/consultarPedido.js";
import { indiceDosMocks } from "./helpers/indicePedidos.js";

describe("consultarPedido — enforcement da transferência", () => {
  let client: MockBrindeMeClient;

  beforeEach(() => {
    client = new MockBrindeMeClient();
    setOrderIndexStore(indiceDosMocks());
  });

  it("bloqueio carrega instrucao=transferir, não só a promessa na mensagem", async () => {
    const state = createInitialState("5511000000001");
    await consultarPedidoHandler({ codigo: "PED-2024-001", email: "errado@x.com" }, state, client);
    const r = (await consultarPedidoHandler(
      { codigo: "PED-2024-001", email: "errado2@x.com" },
      state,
      client
    )) as { resultado: string; instrucao?: string; motivo_sugerido?: string };

    expect(r.resultado).toBe("bloqueado");
    expect(r.instrucao).toBe("transferir");
    expect(r.motivo_sugerido).toBeTruthy();
  });
});

describe("consultarPedido — teto contra varredura de códigos", () => {
  let client: MockBrindeMeClient;

  beforeEach(() => {
    client = new MockBrindeMeClient();
    setOrderIndexStore(indiceDosMocks());
  });

  it("conta toda consulta, inclusive as que só pedem e-mail", async () => {
    const state = createInitialState("5511000000001");
    await consultarPedidoHandler({ codigo: "PED-2024-001" }, state, client);
    await consultarPedidoHandler({ codigo: "PED-2024-002" }, state, client);
    expect(state.consultasPedido).toBe(2);
    expect(state.falhasValidacaoPedido).toBe(0); // nenhum e-mail errado foi tentado
  });

  it("bloqueia a varredura após o teto, mesmo sem nenhuma falha de e-mail", async () => {
    const state = createInitialState("5511000000001");

    // 5 consultas sem e-mail: cada uma só devolveria "precisa_email" de graça
    for (let i = 0; i < 5; i++) {
      const r = (await consultarPedidoHandler(
        { codigo: `PED-2024-00${i}` },
        state,
        client
      )) as { resultado: string };
      expect(r.resultado).not.toBe("bloqueado");
    }

    const r = (await consultarPedidoHandler({ codigo: "PED-2024-001" }, state, client)) as {
      resultado: string;
      instrucao?: string;
    };
    expect(r.resultado).toBe("bloqueado");
    expect(r.instrucao).toBe("transferir");
  });

  it("não atrapalha o fluxo legítimo: telefone bate na primeira consulta", async () => {
    const state = createInitialState("5583999990000");
    const r = (await consultarPedidoHandler({ codigo: "PED-2024-001" }, state, client)) as {
      resultado: string;
    };
    expect(r.resultado).toBe("encontrado");
    expect(state.consultasPedido).toBe(1);
  });

  it("código inexistente também consome do teto", async () => {
    const state = createInitialState("5583999990000");
    await consultarPedidoHandler({ codigo: "PED-9999-999" }, state, client);
    expect(state.consultasPedido).toBe(1);
  });
});
