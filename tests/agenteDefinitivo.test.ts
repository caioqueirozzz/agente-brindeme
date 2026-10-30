import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgenteDefinitivo, MSG_FALHA, MSG_LIMITE } from "../src/api/agenteDefinitivo.js";
import { RepositorioConversas } from "../src/conversas/repositorio.js";
import { TurnoEmAndamentoError } from "../src/contrato/agente.js";
import { calcularTurnoId } from "../src/contrato/turno.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import type { BrindeMeClient } from "../src/integrations/brindeme/client.js";
import { setBaseConhecimento, setLacunaStore } from "../src/tools/consultarConhecimento.js";
import { MemoryLacunaStore } from "../src/knowledge/lacunas.js";
import { BaseConhecimento } from "../src/knowledge/base.js";
import type { LLMProvider, LLMResponse } from "../src/llm/types.js";
import { ScriptedLLM, endTurn, toolUse } from "./helpers/llmRoteirizado.js";
import { pedido } from "./helpers/bateriaContrato.js";

const TEL = "5583999990000";
const T = "2026-10-14T12:00:00.000Z";

function montar(
  llm: LLMProvider,
  extra: { tetoMs?: number; respostasPorHora?: number; client?: BrindeMeClient; dir?: string } = {}
) {
  const dir = extra.dir ?? mkdtempSync(join(tmpdir(), "conversas-"));
  const repo = new RepositorioConversas(dir);
  const agente = new AgenteDefinitivo({
    repo,
    llm,
    client: extra.client ?? new MockBrindeMeClient(),
    tetoMs: extra.tetoMs ?? 90_000,
    respostasPorHora: extra.respostasPorHora ?? 30,
  });
  return { agente, repo, dir };
}

/** Estimativa mostrada num turno anterior, à espera da confirmação do cliente. */
function semearFichaPedido(dir: string): void {
  const repo = new RepositorioConversas(dir);
  const c = repo.carregar(TEL);
  c.estado.fichaPedido = {
    mensagemDoResumo: "resumo-de-um-turno-anterior",
    resumo: { tipo: "PJ", nome: "Empresa", email: "a@b.test", telefone: TEL, itens: [], total_estimado: 0, arte_refs: [] },
  };
  repo.salvar(c);
}

describe("AgenteDefinitivo", () => {
  beforeEach(() => {
    setLacunaStore(new MemoryLacunaStore());
    setBaseConhecimento(new BaseConhecimento([], { incluirRascunhos: false }));
  });
  afterEach(() => setBaseConhecimento(null));

  it("lote repetido devolve a resposta guardada, inclusive depois de reiniciar", async () => {
    const llm = new ScriptedLLM([endTurn("Olá! **Bem-vindo**")]);
    const { agente, dir } = montar(llm);
    const p = pedido(TEL, ["r1"]);
    const a = await agente.processarLote(p);
    expect(a).toEqual({ respostas: ["Olá! *Bem-vindo*"], modo: "ia" });
    expect(await agente.processarLote(p)).toEqual(a);
    const reiniciado = montar(llm, { dir }).agente;
    expect(await reiniciado.processarLote(p)).toEqual(a);
    expect(llm.seen).toHaveLength(1);
  });

  it("outro lote da mesma conversa com turno rodando → TurnoEmAndamentoError", async () => {
    const { agente } = montar(new ScriptedLLM([endTurn("a"), endTurn("b")], 100));
    const primeiro = agente.processarLote(pedido(TEL, ["e1"]));
    await expect(agente.processarLote(pedido(TEL, ["e2"]))).rejects.toBeInstanceOf(TurnoEmAndamentoError);
    await primeiro;
  });

  it("só as mensagens novas vão ao modelo", async () => {
    const llm = new ScriptedLLM([endTurn("1"), endTurn("2")]);
    const { agente } = montar(llm);
    const m1 = { id: "n1", timestamp: T, texto: "oi" };
    const m2 = { id: "n2", timestamp: T, texto: "quero canecas" };
    await agente.processarLote({ turnoId: calcularTurnoId(["n1"]), telefone: TEL, mensagens: [m1] });
    await agente.processarLote({ turnoId: calcularTurnoId(["n1", "n2"]), telefone: TEL, mensagens: [m1, m2] });
    expect(llm.seen[1].at(-1)).toEqual({ role: "user", content: "quero canecas" });
  });

  it("conversa em humano: guarda a mensagem e não chama o modelo", async () => {
    const llm = new ScriptedLLM();
    const { agente, repo } = montar(llm);
    await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "at1", texto: "assumi", timestamp: T });
    expect(await agente.processarLote(pedido(TEL, ["h1"], "cadê meu pedido?"))).toEqual({ respostas: [], modo: "humano" });
    expect(llm.seen).toHaveLength(0);
    expect(repo.carregar(TEL).estado.historico.map((m) => m.content)).toEqual(["[Atendente]: assumi", "cadê meu pedido?"]);
  });

  it("falha do Claude desfaz o turno; na 2ª falha do mesmo lote transfere", async () => {
    const llm = new ScriptedLLM([new Error("overloaded"), new Error("overloaded")]);
    const { agente, repo } = montar(llm);
    const p = pedido(TEL, ["f1"], "oi");

    await expect(agente.processarLote(p)).rejects.toThrow("overloaded");
    const depois = repo.carregar(TEL);
    expect(depois.estado.historico).toEqual([]);
    expect(depois.idsVistos).toEqual([]);

    const r = await agente.processarLote(p);
    expect(r.respostas).toEqual([MSG_FALHA]);
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toContain("Motivo: falha_sistema");
    expect(r.avisoAtendente).toContain(`#devolver ${TEL}`);
  });

  it("repetir o lote depois de falha não duplica mensagem nem arquivo", async () => {
    const llm = new ScriptedLLM([new Error("overloaded"), endTurn("Recebi a arte.")]);
    const { agente, repo } = montar(llm);
    const arquivo = { caminho: "C:/artes/abc.png", mime: "image/png", bytes: 2_048, nome: "logo.png" };
    const p = { turnoId: calcularTurnoId(["a1"]), telefone: TEL, mensagens: [{ id: "a1", timestamp: T, texto: "segue", arquivo }] };

    await expect(agente.processarLote(p)).rejects.toThrow();
    await agente.processarLote(p);

    const c = repo.carregar(TEL);
    expect(c.estado.arquivosRecebidos).toHaveLength(1);
    expect(c.estado.historico.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("teto de tempo: cancela, transfere pelo sistema e a estimativa pendente chega ao atendente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conversas-"));
    semearFichaPedido(dir);
    const lento: LLMProvider = {
      async chat(): Promise<LLMResponse> {
        await new Promise((r) => setTimeout(r, 100));
        return toolUse("transferir_humano", { motivo: "orcamento_para_emitir", prioridade: "normal" });
      },
    };
    const { agente } = montar(lento, { tetoMs: 20, dir });

    const r = await agente.processarLote(pedido(TEL, ["t1"], "pode enviar"));

    expect(r).toMatchObject({ respostas: [MSG_FALHA], modo: "humano" });
    expect(r.avisoAtendente).toContain("turno passou do teto de tempo");
    expect(r.avisoAtendente).toContain("Orçamento para emitir");
  });

  it("o estado vai para o disco logo depois da transferência com a estimativa, antes do turno acabar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conversas-"));
    semearFichaPedido(dir);
    let derrubar: ((e: Error) => void) | undefined;
    const llm: LLMProvider = {
      chat: vi
        .fn<LLMProvider["chat"]>()
        .mockResolvedValueOnce(toolUse("transferir_humano", { motivo: "orcamento_para_emitir", prioridade: "normal" }))
        .mockImplementationOnce(() => new Promise<LLMResponse>((_, rej) => (derrubar = rej))),
    };
    const { agente } = montar(llm, { dir });

    const turno = agente.processarLote(pedido(TEL, ["o1"], "pode enviar"));
    await vi.waitFor(() => expect(derrubar).toBeDefined());
    expect(new RepositorioConversas(dir).carregar(TEL).estado.modo).toBe("humano");

    // Com a transferência já feita, a falha seguinte do modelo conclui pela transferência.
    derrubar!(new Error("processo caiu"));
    await expect(turno).resolves.toMatchObject({ modo: "humano" });
  });

  it("limite por hora: transfere uma vez com aviso; depois a IA fica quieta", async () => {
    const llm = new ScriptedLLM([endTurn("1"), endTurn("2")]);
    const { agente } = montar(llm, { respostasPorHora: 2 });
    await agente.processarLote(pedido(TEL, ["l1"]));
    await agente.processarLote(pedido(TEL, ["l2"]));

    const r = await agente.processarLote(pedido(TEL, ["l3"]));
    expect(r).toMatchObject({ respostas: [MSG_LIMITE], modo: "humano" });
    expect(r.avisoAtendente).toContain("limite de respostas por hora");
    expect(await agente.processarLote(pedido(TEL, ["l4"]))).toEqual({ respostas: [], modo: "humano" });
    expect(llm.seen).toHaveLength(2);
  });

  it("devolver depois do limite: a IA volta a responder", async () => {
    const llm = new ScriptedLLM([endTurn("1"), endTurn("de volta")]);
    const { agente } = montar(llm, { respostasPorHora: 1 });
    await agente.processarLote(pedido(TEL, ["d1"]));
    await agente.processarLote(pedido(TEL, ["d2"]));
    await agente.processarEvento({ tipo: "devolver", telefone: TEL });
    expect(await agente.processarLote(pedido(TEL, ["d3"]))).toEqual({ respostas: ["de volta"], modo: "ia" });
  });

  it("eventos: atendente repetido não duplica; devolver volta à IA com a nota e zera as falhas", async () => {
    const { agente, repo } = montar(new ScriptedLLM());
    const ev = { tipo: "mensagem_atendente" as const, telefone: TEL, id: "at9", texto: "assumi", timestamp: T };
    await agente.processarEvento(ev);
    await agente.processarEvento(ev);
    expect(await agente.processarEvento({ tipo: "devolver", telefone: TEL, nota: "pagou" })).toEqual({ modo: "ia" });
    const c = repo.carregar(TEL);
    expect(c.estado.historico.map((m) => m.content)).toEqual([
      "[Atendente]: assumi",
      '[Atendente devolveu o atendimento à IA com a nota: "pagou"]',
    ]);
    expect(c.estado.falhasConsecutivas).toBe(0);
  });

  it("evento durante o turno: o turno termina e a conversa fica em humano", async () => {
    const { agente, repo } = montar(new ScriptedLLM([endTurn("resposta")], 100));
    const turno = agente.processarLote(pedido(TEL, ["x1"]));
    await new Promise((r) => setTimeout(r, 20));
    await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "at2", texto: "eu assumo", timestamp: T });
    const r = await turno;
    expect(r.modo).toBe("humano");
    expect(repo.carregar(TEL).estado.modo).toBe("humano");
  });

  it("transferência pela ferramenta: aviso legível com a pergunta sem resposta", async () => {
    const llm = new ScriptedLLM([
      toolUse("consultar_conhecimento", { pergunta: "qual o horário de vocês?" }),
      toolUse("transferir_humano", { motivo: "lacuna_conhecimento", prioridade: "normal" }),
      endTurn("Vou chamar alguém da equipe."),
    ]);
    const { agente } = montar(llm);
    const r = await agente.processarLote(pedido(TEL, ["tr1"], "qual o horário de vocês?"));
    expect(r.modo).toBe("humano");
    expect(r.respostas).toEqual(["Vou chamar alguém da equipe."]);
    expect(r.avisoAtendente).toContain("Pergunta sem resposta: qual o horário de vocês?");
  });

  it("arquivo do lote fica no estado e registrar_arte usa o caminho real", async () => {
    const llm = new ScriptedLLM([toolUse("registrar_arte", { descricao_arquivo: "logo.png" }), endTurn("Recebi!")]);
    const { agente, repo } = montar(llm);
    const arquivo = { caminho: "C:/artes/abc.png", mime: "image/png", bytes: 2_048, nome: "logo.png" };
    await agente.processarLote({ turnoId: calcularTurnoId(["f9"]), telefone: TEL, mensagens: [{ id: "f9", timestamp: T, texto: "", arquivo }] });
    const c = repo.carregar(TEL);
    expect(c.estado.arquivosRecebidos).toEqual([{ nome: "logo.png", caminho: "C:/artes/abc.png", mime: "image/png", bytes: 2_048 }]);
    expect(c.estado.artes[0].arquivo).toBe("C:/artes/abc.png");
  });
});
