import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { criarServidorAgente } from "../../src/contrato/servidorHttp.js";
import type { Agente } from "../../src/contrato/agente.js";
import { calcularTurnoId } from "../../src/contrato/turno.js";
import {
  respostaEventoSchema,
  respostaMensagensSchema,
  type PedidoMensagens,
} from "../../src/contrato/esquemas.js";

const T = "2026-10-14T12:00:00.000Z";

export function pedido(telefone: string, ids: string[], texto = "oi"): PedidoMensagens {
  return {
    turnoId: calcularTurnoId(ids),
    telefone,
    mensagens: ids.map((id) => ({ id, timestamp: T, texto })),
  };
}

export async function subirServidor(agente: Agente): Promise<{ servidor: Server; base: string }> {
  const servidor = criarServidorAgente(agente);
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address() as AddressInfo;
  return { servidor, base: `http://127.0.0.1:${port}` };
}

export async function derrubarServidor(servidor: Server): Promise<void> {
  servidor.closeAllConnections();
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
}

export function bateriaContrato(
  nome: string,
  criar: (opcoes: { atrasoMs: number }) => Agente | Promise<Agente>
): void {
  describe(`contrato do agente — ${nome}`, () => {
    let servidor: Server | undefined;
    let base = "";

    async function subir(atrasoMs = 0) {
      ({ servidor, base } = await subirServidor(await criar({ atrasoMs })));
    }

    function post(rota: string, corpo: unknown) {
      return fetch(`${base}${rota}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
    }

    afterEach(async () => {
      if (servidor) await derrubarServidor(servidor);
      servidor = undefined;
    });

    it("GET /api/health → 200", async () => {
      await subir();
      const r = await fetch(`${base}/api/health`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
    });

    it("lote novo → 200 com respostas e modo ia", async () => {
      await subir();
      const r = await post("/api/mensagens", pedido("5583999990000", ["c1"]));
      expect(r.status).toBe(200);
      const corpo = respostaMensagensSchema.parse(await r.json());
      expect(corpo.modo).toBe("ia");
      expect(corpo.respostas.length).toBeGreaterThan(0);
    });

    it("mesmo turnoId → a mesma resposta", async () => {
      await subir();
      const p = pedido("5583999990000", ["c2"]);
      const a = await (await post("/api/mensagens", p)).json();
      const b = await (await post("/api/mensagens", p)).json();
      expect(b).toEqual(a);
    });

    it("corpo fora do contrato → 400", async () => {
      await subir();
      const r = await post("/api/mensagens", { telefone: "+55 83", mensagens: [] });
      expect(r.status).toBe(400);
    });

    it("outro lote da mesma conversa com turno em andamento → 409", async () => {
      await subir(300);
      const primeiro = post("/api/mensagens", pedido("5583999990000", ["c3"]));
      await new Promise((r) => setTimeout(r, 50));
      const segundo = await post("/api/mensagens", pedido("5583999990000", ["c4"]));
      expect(segundo.status).toBe(409);
      expect(await segundo.json()).toEqual({ status: "em_andamento" });
      expect((await primeiro).status).toBe(200);
    });

    it("mensagem_atendente → humano, e o lote seguinte não gera resposta", async () => {
      await subir();
      const ev = await post("/api/eventos", {
        tipo: "mensagem_atendente",
        telefone: "5583999990000",
        id: "at1",
        texto: "Oi, aqui é a Ana",
        timestamp: T,
      });
      expect(respostaEventoSchema.parse(await ev.json())).toEqual({ modo: "humano" });
      const r = await post("/api/mensagens", pedido("5583999990000", ["c5"]));
      expect(respostaMensagensSchema.parse(await r.json())).toEqual({ respostas: [], modo: "humano" });
    });

    it("devolver → ia", async () => {
      await subir();
      await post("/api/eventos", {
        tipo: "mensagem_atendente",
        telefone: "5583999990000",
        id: "at2",
        texto: "assumi",
        timestamp: T,
      });
      const ev = await post("/api/eventos", { tipo: "devolver", telefone: "5583999990000", nota: "pode seguir" });
      expect(respostaEventoSchema.parse(await ev.json())).toEqual({ modo: "ia" });
    });

    it("devolver de conversa que o agente nunca viu → 404", async () => {
      await subir();
      const ev = await post("/api/eventos", { tipo: "devolver", telefone: "5583999990001" });
      expect(ev.status).toBe(404);
      expect(await ev.json()).toEqual({ status: "conversa_desconhecida" });
    });
  });
}
