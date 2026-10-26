import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { MAX_RODADAS_DE_FERRAMENTA, montarJanela, runTurn } from "../src/agent/runTurn.js";
import { createInitialState, type ConversationState, type Mensagem } from "../src/agent/state.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { Logger } from "../src/logging/logger.js";
import { setBaseConhecimento, setLacunaStore } from "../src/tools/consultarConhecimento.js";
import { MemoryLacunaStore } from "../src/knowledge/lacunas.js";
import { BaseConhecimento } from "../src/knowledge/base.js";
import { ScriptedLLM, endTurn, toolUse } from "./helpers/llmRoteirizado.js";
import type { LLMProvider, LLMResponse } from "../src/llm/types.js";

const TEL = "5583999990000";

describe("montarJanela (histórico que vai ao modelo)", () => {
  const T0 = "2026-10-14T12:00:00.000Z";
  const m = (role: Mensagem["role"], content: string): Mensagem => ({ role, content, timestamp: T0 });

  it("junta mensagens seguidas do mesmo lado e sempre começa pelo cliente", () => {
    const historico = [m("assistant", "[Atendente]: oi"), m("assistant", "[devolvido à IA]"), m("user", "quero canecas")];
    expect(montarJanela(historico, "quero canecas")).toEqual([
      { role: "user", content: "[início do trecho da conversa]" },
      { role: "assistant", content: "[Atendente]: oi\n\n[devolvido à IA]" },
      { role: "user", content: "quero canecas" },
    ]);
  });

  it("descarta mensagem vazia e junta o que sobrou do mesmo lado", () => {
    const historico = [m("user", "oi"), m("assistant", ""), m("user", "e aí?")];
    expect(montarJanela(historico, "e aí?")).toEqual([{ role: "user", content: "oi\n\ne aí?" }]);
  });

  it("janela cortada que começa numa resposta ganha a abertura do cliente", () => {
    const historico: Mensagem[] = [];
    for (let i = 0; i < 25; i++) historico.push(m("user", `p${i}`), m("assistant", `r${i}`));
    historico.push(m("user", "nova"));
    const janela = montarJanela(historico, "nova");
    expect(janela[0].role).toBe("user");
    expect(janela.every((x, i) => i === 0 || x.role !== janela[i - 1].role)).toBe(true);
  });
});

/** Estimativa mostrada num turno anterior: a mensagem nova do cliente é a confirmação. */
function comFichaPedido(state: ConversationState): ConversationState {
  state.fichaPedido = {
    mensagemDoResumo: "resumo-de-um-turno-anterior",
    resumo: { tipo: "PJ", nome: "Empresa", email: "a@b.test", telefone: TEL, itens: [], total_estimado: 0, arte_refs: [] },
  };
  return state;
}

describe("runTurn — Fase 4", () => {
  beforeEach(() => {
    setLacunaStore(new MemoryLacunaStore());
    setBaseConhecimento(new BaseConhecimento([], { incluirRascunhos: false }));
  });
  afterEach(() => setBaseConhecimento(null));

  it("sinal já cancelado: rejeita sem chamar o modelo", async () => {
    const llm = new ScriptedLLM([endTurn("oi")]);
    const controle = new AbortController();
    controle.abort();
    const state = createInitialState(TEL);
    await expect(
      runTurn("oi", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId), { signal: controle.signal })
    ).rejects.toThrow();
    expect(llm.seen).toHaveLength(0);
  });

  it("cancelado enquanto o modelo pensava: a ferramenta seguinte não roda", async () => {
    const controle = new AbortController();
    const llm: LLMProvider = {
      async chat(): Promise<LLMResponse> {
        controle.abort();
        return toolUse("transferir_humano", { motivo: "orcamento_para_emitir", prioridade: "normal" });
      },
    };
    const state = comFichaPedido(createInitialState(TEL));
    await expect(
      runTurn("pode enviar", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId), { signal: controle.signal })
    ).rejects.toThrow();
    expect(state.modo).toBe("ia");
    expect(state.fichaPedido).toBeDefined();
  });

  it("aoEfeito roda logo depois da transferência com a estimativa", async () => {
    const state = comFichaPedido(createInitialState(TEL));
    const vistos: string[] = [];
    const llm = new ScriptedLLM([toolUse("transferir_humano", { motivo: "orcamento_para_emitir", prioridade: "normal" }), endTurn("Enviei!")]);
    const r = await runTurn("pode enviar", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId), {
      aoEfeito: () => vistos.push(state.modo),
    });
    expect(vistos).toEqual(["humano"]);
    expect(r.transferencia?.ficha_pedido?.email).toBe("a@b.test");
  });

  it("aoEfeito roda logo depois de registrar_arte", async () => {
    const state = createInitialState(TEL);
    const artes: number[] = [];
    const llm = new ScriptedLLM([toolUse("registrar_arte", { descricao_arquivo: "logo.png" }), endTurn("Recebi!")]);
    await runTurn("[ARQUIVO recebido: logo.png (image/png, 2 KB)]", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId), {
      aoEfeito: () => artes.push(state.artes.length),
    });
    expect(artes).toEqual([1]);
  });

  it("devolve o resumo da transferência e a pergunta sem resposta", async () => {
    const state = createInitialState(TEL);
    const llm = new ScriptedLLM([
      toolUse("consultar_conhecimento", { pergunta: "qual o horário de vocês?" }),
      toolUse("transferir_humano", { motivo: "lacuna_conhecimento", prioridade: "normal" }),
      endTurn("Vou chamar alguém da equipe."),
    ]);
    const r = await runTurn("qual o horário?", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId));
    expect(r.transferred).toBe(true);
    expect(r.transferencia?.motivo).toBe("lacuna_conhecimento");
    expect(r.lacunas).toEqual(["qual o horário de vocês?"]);
  });

  it("modelo que não para de chamar ferramenta: o turno desiste depois do limite de rodadas", async () => {
    let chamadas = 0;
    const teimoso: LLMProvider = {
      async chat(): Promise<LLMResponse> {
        chamadas++;
        return toolUse("consultar_pedido", { codigo: "X" });
      },
    };
    const state = createInitialState(TEL);
    await expect(runTurn("oi", state, teimoso, new MockBrindeMeClient(), new Logger(state.conversaId))).rejects.toThrow(
      /rodadas/
    );
    expect(chamadas).toBe(MAX_RODADAS_DE_FERRAMENTA);
  });

  it("sem transferência: lacunas vazias e sem resumo", async () => {
    const state = createInitialState(TEL);
    const r = await runTurn("oi", state, new ScriptedLLM([endTurn("Olá!")]), new MockBrindeMeClient(), new Logger(state.conversaId));
    expect(r.lacunas).toEqual([]);
    expect(r.transferencia).toBeUndefined();
  });

  it("Logger grava o contexto (turnoId) em cada linha", () => {
    const id = `teste-contexto-${Date.now()}`;
    new Logger(id, { turnoId: "0123456789abcdef" }).log({ type: "state_change", change: "x" });
    const linha = readFileSync(join(process.cwd(), "logs", `${id}.jsonl`), "utf-8").trim();
    expect(JSON.parse(linha)).toMatchObject({ turnoId: "0123456789abcdef", type: "state_change" });
  });
});
