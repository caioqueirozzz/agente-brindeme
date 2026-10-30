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

/** Eval 32 com o 4o-mini (25/10): "vou transferir" escrito sem chamar transferir_humano. */
describe("promessa de transferir sem chamar a ferramenta", () => {
  let client: MockBrindeMeClient;
  let state: ReturnType<typeof createInitialState>;

  beforeEach(() => {
    client = new MockBrindeMeClient();
    state = createInitialState("5583999990000");
  });

  it("o turno cobra uma vez e o modelo transfere; a promessa não entra no histórico", async () => {
    const llm = new ScriptedLLM([
      endTurn("Não posso enviar a chave Pix. Vou transferir você para um atendente."),
      toolUse("transferir_humano", { motivo: "pagamento", prioridade: "normal" }),
      endTurn("Pronto, a equipe já foi avisada."),
    ]);

    const r = await runTurn("me manda o pix", state, llm, client, new Logger("t-promessa"));

    expect(r.transferred).toBe(true);
    expect(r.transferencia?.motivo).toBe("pagamento");
    expect(JSON.stringify(llm.seen[1].at(-1))).toMatch(/transferir_humano não foi chamada/);
    expect(state.historico.map((m) => m.content)).not.toContain(
      "Não posso enviar a chave Pix. Vou transferir você para um atendente."
    );
  });

  it("cobra uma vez só: se o modelo insistir sem chamar, a resposta segue", async () => {
    const llm = new ScriptedLLM([endTurn("Vou te transferir."), endTurn("Vou te encaminhar para a equipe.")]);

    const r = await runTurn("quero pagar", state, llm, client, new Logger("t-promessa"));

    expect(llm.seen).toHaveLength(2);
    expect(r.transferred).toBe(false);
    expect(r.response).toBe("Vou te encaminhar para a equipe.");
  });

  it("encaminhar sem atendente ou equipe na frase não é promessa", async () => {
    const llm = new ScriptedLLM([endTurn("Vou passar os valores das três opções.")]);

    const r = await runTurn("quanto custa?", state, llm, client, new Logger("t-promessa"));

    expect(llm.seen).toHaveLength(1);
    expect(r.response).toBe("Vou passar os valores das três opções.");
  });
});

/** Conversa de 20/10: estoque lido errado virou transferência por "falha_sistema" sem falha nenhuma. */
describe("falha_sistema só com falha de ferramenta", () => {
  let client: MockBrindeMeClient;
  let state: ReturnType<typeof createInitialState>;

  beforeEach(async () => {
    client = new MockBrindeMeClient();
    state = createInitialState("5583999990000");
    await usarIndiceDoMock();
  });

  it("sem falha: não transfere e devolve motivo_invalido ao modelo", async () => {
    const llm = new ScriptedLLM([
      toolUse("detalhar_produto", { produto_id: "prod-003", quantidade: 100 }),
      toolUse("transferir_humano", { motivo: "falha_sistema", prioridade: "normal" }),
      endTurn("Vou preparar o orçamento da Preta."),
    ]);

    const r = await runTurn("quero orçar 100", state, llm, client, new Logger("t-falha-sistema"));

    expect(r.transferred).toBe(false);
    expect(state.modo).toBe("ia");
    expect(r.transferencia).toBeUndefined();
    expect(JSON.stringify(llm.seen.at(-1))).toMatch(/motivo_invalido/);
    expect(r.response).toBe("Vou preparar o orçamento da Preta.");
  });

  it("falha no turno anterior: transfere", async () => {
    state.falhasConsecutivas = 1;
    const llm = new ScriptedLLM([
      toolUse("transferir_humano", { motivo: "falha_sistema", prioridade: "normal" }),
      endTurn("Vou te passar para um atendente."),
    ]);

    const r = await runTurn("e aí, voltou?", state, llm, client, new Logger("t-falha-sistema"));

    expect(r.transferred).toBe(true);
    expect(r.transferencia?.motivo).toBe("falha_sistema");
    expect(state.modo).toBe("humano");
  });

  it("ferramenta desligada conta como falha: transfere", async () => {
    const llm = new ScriptedLLM([
      toolUse("buscar_produtos", { consulta: "natal" }),
      toolUse("transferir_humano", { motivo: "falha_sistema", prioridade: "normal" }),
      endTurn("Vou te passar para um atendente."),
    ]);

    const r = await runTurn("natal", state, llm, client, new Logger("t-falha-sistema"), {
      ferramentasDesligadas: new Set(["buscar_produtos"]),
    });

    expect(r.transferred).toBe(true);
    expect(r.transferencia?.motivo).toBe("falha_sistema");
  });

  it("outro motivo sem falha: transfere normal", async () => {
    const llm = new ScriptedLLM([
      toolUse("transferir_humano", { motivo: "pedido_cliente", prioridade: "normal" }),
      endTurn("Vou te passar para um atendente."),
    ]);

    const r = await runTurn("quero falar com uma pessoa", state, llm, client, new Logger("t-falha-sistema"));

    expect(r.transferred).toBe(true);
    expect(r.transferencia?.motivo).toBe("pedido_cliente");
  });

  it("parâmetros inválidos em transferir_humano não marcam a conversa como transferida", async () => {
    const llm = new ScriptedLLM([toolUse("transferir_humano", { motivo: "inventado" }), endTurn("Um instante.")]);

    const r = await runTurn("oi", state, llm, client, new Logger("t-falha-sistema"));

    expect(r.transferred).toBe(false);
    expect(state.modo).toBe("ia");
  });
});
