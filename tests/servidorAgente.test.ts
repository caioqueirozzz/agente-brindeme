import { describe, it, expect } from "vitest";
import { AgenteEco } from "../src/duble/eco.js";
import type { Agente } from "../src/contrato/agente.js";
import { bateriaContrato, derrubarServidor, pedido, subirServidor } from "./helpers/bateriaContrato.js";

bateriaContrato("dublê eco", ({ atrasoMs }) => new AgenteEco({ atrasoMs }));

describe("servidor do contrato", () => {
  it("rota desconhecida → 404", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco());
    try {
      const r = await fetch(`${base}/api/outra`);
      expect(r.status).toBe(404);
    } finally {
      await derrubarServidor(servidor);
    }
  });

  it("erro qualquer do agente → 503 falha_temporaria", async () => {
    const quebrado: Agente = {
      processarLote: async () => {
        throw new Error("Claude fora");
      },
      processarEvento: async () => ({ modo: "ia" }),
    };
    const { servidor, base } = await subirServidor(quebrado);
    try {
      const r = await fetch(`${base}/api/mensagens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pedido("5583999990000", ["x1"])),
      });
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ status: "falha_temporaria" });
    } finally {
      await derrubarServidor(servidor);
    }
  });

  it("o eco devolve o texto do lote", async () => {
    const eco = new AgenteEco();
    expect(await eco.processarLote(pedido("5583999990000", ["e1", "e2"], "oi"))).toEqual({
      respostas: ["eco: oi\noi"],
      modo: "ia",
    });
  });
});
