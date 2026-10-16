import { describe, it, expect, beforeEach } from "vitest";
import { runTurn } from "../src/agent/runTurn.js";
import { createInitialState } from "../src/agent/state.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { Logger } from "../src/logging/logger.js";
import { MENSAGEM_TRANSFERENCIA } from "../src/tools/transferirHumano.js";
import { usarIndiceDoMock } from "./helpers/catalogo.js";
import { ScriptedLLM, toolUse, endTurn } from "./helpers/llmRoteirizado.js";
import { setLacunaStore } from "../src/tools/consultarConhecimento.js";
import { MemoryLacunaStore } from "../src/knowledge/lacunas.js";

/** Eval 11 (#11): a ferramenta manda transferir e o modelo responde sem transferir. */
describe("transferência garantida pelo código", () => {
  let client: MockBrindeMeClient;
  let state: ReturnType<typeof createInitialState>;

  beforeEach(async () => {
    client = new MockBrindeMeClient();
    state = createInitialState("5583999990000");
    await usarIndiceDoMock();
  });

  it("instrução de transferir ignorada pelo modelo: o turno transfere mesmo assim", async () => {
    client.injectFault({ type: "500", remaining: 1_000 });
    const llm = new ScriptedLLM([
      toolUse("buscar_produtos", { consulta: "natal" }),
      toolUse("buscar_produtos", { consulta: "natal" }),
      endTurn("Estamos com instabilidade, tente de novo mais tarde."),
    ]);
    const transferencias: string[] = [];

    const r = await runTurn("me mostra brindes de natal", state, llm, client, new Logger("t-garantida"), {
      aoTransferir: (resumo) => transferencias.push(resumo.motivo),
    });

    expect(r.transferred).toBe(true);
    expect(r.toolsCalled.map((t) => t.name)).toContain("transferir_humano");
    expect(JSON.parse(r.toolsCalled.at(-1)!.inputSummary)).toMatchObject({ motivo: "falha_sistema" });
    expect(r.transferencia?.motivo).toBe("falha_sistema");
    expect(transferencias).toEqual(["falha_sistema"]);
    expect(state.modo).toBe("humano");
    expect(r.response).toBe(MENSAGEM_TRANSFERENCIA);
  });

  it("modelo que transfere sozinho: uma transferência só", async () => {
    client.injectFault({ type: "500", remaining: 1_000 });
    const llm = new ScriptedLLM([
      toolUse("buscar_produtos", { consulta: "natal" }),
      toolUse("buscar_produtos", { consulta: "natal" }),
      toolUse("transferir_humano", { motivo: "falha_sistema", prioridade: "normal" }),
      endTurn("Vou te passar para um atendente."),
    ]);

    const r = await runTurn("natal", state, llm, client, new Logger("t-garantida"));

    expect(r.toolsCalled.filter((t) => t.name === "transferir_humano")).toHaveLength(1);
    expect(r.response).toBe("Vou te passar para um atendente.");
  });

  it("lacuna da base não força: a base vazia não pode derrubar toda conversa que a consulta", async () => {
    setLacunaStore(new MemoryLacunaStore());
    const llm = new ScriptedLLM([
      toolUse("consultar_conhecimento", { pergunta: "qual a cor do céu de marte em julho?" }),
      endTurn("Vou buscar as canecas para você."),
    ]);

    const r = await runTurn("quero canecas", state, llm, client, new Logger("t-garantida"));

    expect(r.transferred).toBe(false);
    expect(r.response).toBe("Vou buscar as canecas para você.");
    setLacunaStore(null);
  });

  it("sem instrução de transferir, nada muda", async () => {
    client.injectFault({ type: "500", remaining: 1_000 });
    const llm = new ScriptedLLM([toolUse("buscar_produtos", { consulta: "natal" }), endTurn("Instabilidade, um instante.")]);

    const r = await runTurn("natal", state, llm, client, new Logger("t-garantida"));

    expect(r.transferred).toBe(false);
    expect(state.modo).not.toBe("humano");
  });
});
