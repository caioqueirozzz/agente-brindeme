import { describe, it, expect } from "vitest";
import { AgenteDireto } from "../src/duble/direto.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { ScriptedLLM, endTurn, toolUse } from "./helpers/llmRoteirizado.js";
import { pedido } from "./helpers/bateriaContrato.js";

const TEL = "5583999990000";
const T = "2026-10-14T12:00:00.000Z";

describe("dublê direto", () => {
  it("roda o runTurn real e devolve a resposta no formato do WhatsApp", async () => {
    const llm = new ScriptedLLM([endTurn("Olá! **Bem-vindo** à loja.\n\nComo posso ajudar?")]);
    const agente = new AgenteDireto(llm, new MockBrindeMeClient());

    const r = await agente.processarLote(pedido(TEL, ["d1"], "oi"));

    expect(r).toEqual({ respostas: ["Olá! *Bem-vindo* à loja.", "Como posso ajudar?"], modo: "ia" });
    expect(llm.seen[0].at(-1)).toEqual({ role: "user", content: "oi" });
  });

  it("lote repetido devolve a resposta guardada sem chamar o modelo de novo", async () => {
    const llm = new ScriptedLLM([endTurn("primeira")]);
    const agente = new AgenteDireto(llm, new MockBrindeMeClient());
    const p = pedido(TEL, ["d2"]);
    const a = await agente.processarLote(p);
    const b = await agente.processarLote(p);
    expect(b).toEqual(a);
    expect(llm.seen).toHaveLength(1);
  });

  it("atendente assume (IA quieta) e devolve", async () => {
    const llm = new ScriptedLLM([endTurn("voltei")]);
    const agente = new AgenteDireto(llm, new MockBrindeMeClient());

    expect(
      await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "at", texto: "assumi", timestamp: T })
    ).toEqual({ modo: "humano" });
    expect(await agente.processarLote(pedido(TEL, ["d3"]))).toEqual({ respostas: [], modo: "humano" });
    expect(llm.seen).toHaveLength(0);

    expect(await agente.processarEvento({ tipo: "devolver", telefone: TEL })).toEqual({ modo: "ia" });
    expect(await agente.processarLote(pedido(TEL, ["d4"]))).toEqual({ respostas: ["voltei"], modo: "ia" });
  });

  it("transferência gera aviso para o atendente com o comando de devolver", async () => {
    const llm = new ScriptedLLM([
      toolUse("transferir_humano", { motivo: "pedido_cliente", prioridade: "normal" }),
      endTurn("Vou te passar para um atendente."),
    ]);
    const agente = new AgenteDireto(llm, new MockBrindeMeClient());
    const r = await agente.processarLote(pedido(TEL, ["d5"], "quero falar com alguém"));
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toContain(`#devolver ${TEL}`);
  });
});
