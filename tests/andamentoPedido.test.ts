import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialState } from "../src/agent/state.js";
import { config } from "../src/config.js";
import { andamentoPedidoHandler, setBuscarPedidosNoQuadro } from "../src/tools/andamentoPedido.js";
import type { BrindeMeClient } from "../src/integrations/brindeme/client.js";

const semCliente = {} as BrindeMeClient;
const estado = () => createInitialState("5583999990000");
const PEDIDOS = [
  { codigo: "PED-0105", etapa_atual: "Em produção" },
  { codigo: "PED-0007", etapa_atual: "Entregue" },
];

describe("andamento_pedido", () => {
  const original = { ...config.crm };
  let pedidoPor: string | null;
  beforeEach(() => {
    config.crm.url = "http://crm.local";
    config.crm.segredo = "segredo-de-teste-123456";
    pedidoPor = null;
    setBuscarPedidosNoQuadro(async (telefone) => {
      pedidoPor = telefone;
      return PEDIDOS;
    });
  });
  afterEach(() => {
    Object.assign(config.crm, original);
    setBuscarPedidosNoQuadro(null);
  });

  it("busca pelo telefone da conversa, sem pedir código", async () => {
    const r = await andamentoPedidoHandler({}, estado(), semCliente);
    expect(pedidoPor).toBe("5583999990000");
    expect(r).toEqual({ resultado: "encontrado", pedidos: PEDIDOS });
  });

  it("código citado destaca o pedido, com ou sem prefixo e zeros", async () => {
    expect(await andamentoPedidoHandler({ codigo: "ped-0105" }, estado(), semCliente)).toEqual({ resultado: "encontrado", pedidos: [PEDIDOS[0]] });
    expect(await andamentoPedidoHandler({ codigo: "#7" }, estado(), semCliente)).toEqual({ resultado: "encontrado", pedidos: [PEDIDOS[1]] });
  });

  it("código de outro cliente não aparece: volta só a lista deste telefone", async () => {
    const r = await andamentoPedidoHandler({ codigo: "PED-9999" }, estado(), semCliente);
    expect(r).toEqual({ resultado: "codigo_nao_encontrado_neste_telefone", pedidos_do_cliente: PEDIDOS });
  });

  it("sem pedidos, sem CRM e com CRM fora do ar", async () => {
    setBuscarPedidosNoQuadro(async () => []);
    expect(await andamentoPedidoHandler({}, estado(), semCliente)).toEqual({ resultado: "nenhum_pedido_no_quadro" });
    setBuscarPedidosNoQuadro(async () => {
      throw new Error("fora");
    });
    expect(await andamentoPedidoHandler({}, estado(), semCliente)).toMatchObject({ instrucao: "transferir" });
    config.crm.url = "";
    expect(await andamentoPedidoHandler({}, estado(), semCliente)).toMatchObject({ resultado: "indisponivel" });
  });
});
