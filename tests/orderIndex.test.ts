import { describe, it, expect, beforeEach } from "vitest";
import {
  sincronizarPedidos,
  localizarPedido,
  MemoryOrderIndexStore,
} from "../src/integrations/brindeme/orderIndex.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { consultarPedidoHandler, setOrderIndexStore } from "../src/tools/consultarPedido.js";
import { createInitialState } from "../src/agent/state.js";
import { indiceDosMocks } from "./helpers/indicePedidos.js";

describe("job de sincronização de pedidos", () => {
  let client: MockBrindeMeClient;

  beforeEach(() => { client = new MockBrindeMeClient(); });

  it("lê os pedidos da janela e popula o índice", async () => {
    const store = new MemoryOrderIndexStore();
    const r = await sincronizarPedidos(client, store);
    expect(r.lidos).toBeGreaterThan(0);
    expect(r.novos).toBe(r.lidos);
    expect(store.carregar()).toHaveLength(r.lidos);
  });

  it("é idempotente: rodar duas vezes não duplica", async () => {
    const store = new MemoryOrderIndexStore();
    const r1 = await sincronizarPedidos(client, store);
    const r2 = await sincronizarPedidos(client, store);
    expect(r2.novos).toBe(0);
    expect(r2.atualizados).toBe(r1.lidos);
    expect(store.carregar()).toHaveLength(r1.lidos);
  });

  it("guarda SÓ o necessário — nada de CPF, boleto ou nota", async () => {
    const store = new MemoryOrderIndexStore();
    await sincronizarPedidos(client, store);
    const registro = store.carregar()[0];

    expect(Object.keys(registro).sort()).toEqual(
      ["codigo", "criado_em", "email", "id", "sincronizado_em", "status", "telefone"].sort()
    );
    const json = JSON.stringify(store.carregar());
    for (const proibido of ["cpf", "bankslip", "nfs", "file_url", "123.456.789-00"]) {
      expect(json.toLowerCase()).not.toContain(proibido.toLowerCase());
    }
  });

  it("normaliza telefone para dígitos e e-mail para minúsculas", async () => {
    const store = new MemoryOrderIndexStore();
    await sincronizarPedidos(client, store);
    for (const p of store.carregar()) {
      expect(p.telefone).toMatch(/^\d*$/);
      expect(p.email).toBe(p.email.toLowerCase());
    }
  });
});

describe("localizarPedido", () => {
  it("acha pelo código e valida pelo telefone", () => {
    const r = localizarPedido(indiceDosMocks(), {
      codigo: "PED-2024-001",
      telefone: "5583999990000",
    });
    expect(r).toMatchObject({ encontrado: true, validado: true });
  });

  it("aceita o código com # na frente", () => {
    const r = localizarPedido(indiceDosMocks(), {
      codigo: "#PED-2024-001",
      telefone: "5583999990000",
    });
    expect(r.encontrado).toBe(true);
  });

  it("acha mas não valida quando o telefone é de outro cliente", () => {
    const r = localizarPedido(indiceDosMocks(), {
      codigo: "PED-2024-001",
      telefone: "5511000000001",
    });
    expect(r).toMatchObject({ encontrado: true, validado: false });
  });

  it("valida pelo e-mail quando o telefone não bate", () => {
    const r = localizarPedido(indiceDosMocks(), {
      codigo: "PED-2024-001",
      telefone: "5511000000001",
      email: "JOAO.SILVA@empresa.com.br",
    });
    expect(r).toMatchObject({ encontrado: true, validado: true });
  });

  it("código inexistente", () => {
    expect(localizarPedido(indiceDosMocks(), { codigo: "NAO-EXISTE" })).toEqual({
      encontrado: false,
    });
  });

  it("não devolve nenhum dado do pedido — só o id e se validou", () => {
    const r = localizarPedido(indiceDosMocks(), {
      codigo: "PED-2024-001",
      telefone: "5583999990000",
    });
    expect(Object.keys(r).sort()).toEqual(["encontrado", "id", "validado"]);
  });
});

describe("consultar_pedido só chama a API depois de validar", () => {
  it("não chama GET /order/{id} quando a validação falha", async () => {
    let chamadas = 0;
    const client = new MockBrindeMeClient();
    const original = client.getOrder.bind(client);
    client.getOrder = async (id: string) => {
      chamadas++;
      return original(id);
    };
    setOrderIndexStore(indiceDosMocks());

    const state = createInitialState("5511000000001"); // telefone de outra pessoa
    const r = await consultarPedidoHandler({ codigo: "PED-2024-001" }, state, client);

    expect((r as { resultado: string }).resultado).toBe("precisa_email");
    expect(chamadas).toBe(0);
  });

  it("chama a API uma vez quando valida", async () => {
    let chamadas = 0;
    const client = new MockBrindeMeClient();
    const original = client.getOrder.bind(client);
    client.getOrder = async (id: string) => {
      chamadas++;
      return original(id);
    };
    setOrderIndexStore(indiceDosMocks());

    const state = createInitialState("5583999990000");
    const r = await consultarPedidoHandler({ codigo: "PED-2024-001" }, state, client);

    expect((r as { resultado: string }).resultado).toBe("encontrado");
    expect(chamadas).toBe(1);
  });
});
