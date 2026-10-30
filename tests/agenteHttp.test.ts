import { describe, it, expect } from "vitest";
import { AgenteEco } from "../src/duble/eco.js";
import { criarClienteHttp } from "../src/whatsapp/agenteHttp.js";
import { derrubarServidor, pedido, subirServidor } from "./helpers/bateriaContrato.js";

const T = "2026-10-14T12:00:00.000Z";

describe("cliente HTTP do agente", () => {
  it("200 → ok com a resposta validada", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco());
    try {
      const r = await criarClienteHttp(base, 2_000).enviarLote(pedido("5583999990000", ["h1"]));
      expect(r).toEqual({ tipo: "ok", resposta: { respostas: ["eco: oi"], modo: "ia" } });
    } finally {
      await derrubarServidor(servidor);
    }
  });

  it("409 → em_andamento", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco({ atrasoMs: 300 }));
    try {
      const cliente = criarClienteHttp(base, 2_000);
      const primeiro = cliente.enviarLote(pedido("5583999990000", ["h2"]));
      await new Promise((r) => setTimeout(r, 50));
      expect(await cliente.enviarLote(pedido("5583999990000", ["h3"]))).toEqual({ tipo: "em_andamento" });
      expect((await primeiro).tipo).toBe("ok");
    } finally {
      await derrubarServidor(servidor);
    }
  });

  it("agente fora do ar → falha", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco());
    await derrubarServidor(servidor);
    const r = await criarClienteHttp(base, 2_000).enviarLote(pedido("5583999990000", ["h4"]));
    expect(r.tipo).toBe("falha");
  });

  it("sem resposta dentro do prazo → falha", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco({ atrasoMs: 500 }));
    try {
      const r = await criarClienteHttp(base, 100).enviarLote(pedido("5583999990000", ["h5"]));
      expect(r).toEqual({ tipo: "falha", motivo: "TimeoutError" });
    } finally {
      await derrubarServidor(servidor);
    }
  });

  it("evento → ok com o modo; agente fora → falha", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco());
    const cliente = criarClienteHttp(base, 2_000);
    const evento = { tipo: "mensagem_atendente" as const, telefone: "5583999990000", id: "a1", texto: "oi", timestamp: T };
    expect(await cliente.enviarEvento(evento)).toEqual({ tipo: "ok", resposta: { modo: "humano" } });
    await derrubarServidor(servidor);
    expect((await cliente.enviarEvento(evento)).tipo).toBe("falha");
  });

  it("evento fora do contrato → recusado com o status, para não ficar pendente para sempre", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco());
    try {
      const cliente = criarClienteHttp(base, 2_000);
      const invalido = { tipo: "devolver" as const, telefone: "123" };
      expect(await cliente.enviarEvento(invalido)).toEqual({ tipo: "recusado", status: 400 });
    } finally {
      await derrubarServidor(servidor);
    }
  });
});
