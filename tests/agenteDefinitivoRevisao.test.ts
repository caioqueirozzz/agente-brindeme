import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgenteDefinitivo, MSG_FALHA } from "../src/api/agenteDefinitivo.js";
import { RepositorioConversas } from "../src/conversas/repositorio.js";
import { ConversaDesconhecidaError } from "../src/contrato/agente.js";
import { calcularTurnoId } from "../src/contrato/turno.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { EscritaSimuladaClient } from "../src/integrations/brindeme/escritaSimulada.js";
import type { BrindeMeClient } from "../src/integrations/brindeme/client.js";
import { MENSAGEM_TRANSFERENCIA } from "../src/tools/transferirHumano.js";
import { setBaseConhecimento, setLacunaStore } from "../src/tools/consultarConhecimento.js";
import { MemoryLacunaStore } from "../src/knowledge/lacunas.js";
import { BaseConhecimento } from "../src/knowledge/base.js";
import type { LLMMessage, LLMProvider, LLMResponse } from "../src/llm/types.js";
import { ScriptedLLM, endTurn, toolUse } from "./helpers/llmRoteirizado.js";

// Achados da revisão final do Pacote B (R1–R13 e menores), com o comportamento corrigido.

const TEL = "5583999990000";
const T = "2026-10-14T12:00:00.000Z";
const pedido = (ids: string[], texto = "oi") => ({
  turnoId: calcularTurnoId(ids),
  telefone: TEL,
  mensagens: ids.map((id) => ({ id, timestamp: T, texto })),
});

function montar(llm: LLMProvider, extra: { tetoMs?: number; client?: BrindeMeClient; dir?: string; memoriaMs?: number } = {}) {
  const dir = extra.dir ?? mkdtempSync(join(tmpdir(), "conversas-"));
  const repo = new RepositorioConversas(dir);
  const agente = new AgenteDefinitivo({
    repo,
    llm,
    client: extra.client ?? new MockBrindeMeClient(),
    tetoMs: extra.tetoMs ?? 90_000,
    respostasPorHora: 30,
    ...(extra.memoriaMs !== undefined ? { memoriaMs: extra.memoriaMs } : {}),
  });
  return { agente, repo, dir };
}

function semearPendente(dir: string) {
  const repo = new RepositorioConversas(dir);
  const c = repo.carregar(TEL);
  c.estado.orcamentoPendente = {
    token: "tok",
    expiraEm: new Date(Date.now() + 15 * 60_000).toISOString(),
    resumo: { tipo: "PJ", nome: "E", email: "a@b.test", telefone: TEL, itens: [], total_estimado: 0, arte_refs: [] },
    body: { type: "PJ", customer_name: "E", customer_phone: TEL, customer_email: "a@b.test", items: [{ subproduct_id: "sub-1", quantity: 50 }] },
  };
  repo.salvar(c);
}

function papeisAlternados(mensagens: LLMMessage[]): boolean {
  return mensagens.every((m, i) => i === 0 || m.role !== mensagens[i - 1].role);
}

describe("AgenteDefinitivo — revisão final", () => {
  beforeEach(() => {
    setLacunaStore(new MemoryLacunaStore());
    setBaseConhecimento(new BaseConhecimento([], { incluirRascunhos: false }));
  });
  afterEach(() => setBaseConhecimento(null));

  it("[C1] transferência feita e modelo falha em seguida: cliente avisado e atendente com resumo, sem 503", async () => {
    const llm = new ScriptedLLM([toolUse("transferir_humano", { motivo: "reclamacao", prioridade: "alta" }), new Error("overloaded")]);
    const { agente, repo } = montar(llm);
    const r = await agente.processarLote(pedido(["r1"], "quero falar com alguém, produto veio quebrado"));
    expect(r.respostas).toEqual([MENSAGEM_TRANSFERENCIA]);
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toContain("Motivo: reclamacao");
    expect(r.avisoAtendente).toContain(`#devolver ${TEL}`);
    expect(repo.carregar(TEL).estado.historico.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("[C1] agente reiniciado depois de transferir e antes de responder: a repetição avisa cliente e atendente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conversas-"));
    let soltar: ((e: Error) => void) | undefined;
    const llm: LLMProvider = {
      chat: vi
        .fn<LLMProvider["chat"]>()
        .mockResolvedValueOnce(toolUse("transferir_humano", { motivo: "pedido_cliente", prioridade: "normal" }))
        .mockImplementationOnce(() => new Promise<LLMResponse>((_, rejeitar) => (soltar = rejeitar))),
    };
    const p = pedido(["z1"], "quero um atendente");
    const caiu = montar(llm, { dir }).agente.processarLote(p).catch(() => null);
    await vi.waitFor(() => expect(soltar).toBeDefined());

    const { agente } = montar(new ScriptedLLM(), { dir });
    const r = await agente.processarLote(p);
    expect(r.respostas).toEqual([MENSAGEM_TRANSFERENCIA]);
    expect(r.avisoAtendente).toContain("Motivo: pedido_cliente");
    soltar!(new Error("processo antigo"));
    await caiu;
  });

  it("[C1] resposta vazia depois de transferir: o cliente recebe a mensagem de transferência", async () => {
    const llm = new ScriptedLLM([toolUse("transferir_humano", { motivo: "pedido_cliente", prioridade: "normal" }), endTurn("")]);
    const { agente } = montar(llm);
    const r = await agente.processarLote(pedido(["z2"], "quero um atendente"));
    expect(r).toMatchObject({ respostas: [MENSAGEM_TRANSFERENCIA], modo: "humano" });
  });

  it("[C1/M6] transferência por lacuna e depois o teto: o aviso guarda o motivo e a pergunta", async () => {
    const lento: LLMProvider = {
      chat: vi
        .fn<LLMProvider["chat"]>()
        .mockResolvedValueOnce(toolUse("consultar_conhecimento", { pergunta: "qual o horário?" }))
        .mockResolvedValueOnce(toolUse("transferir_humano", { motivo: "lacuna_conhecimento", prioridade: "normal" }))
        .mockImplementationOnce(() => new Promise<LLMResponse>((r) => setTimeout(() => r(endTurn("tarde demais")), 200))),
    };
    const { agente } = montar(lento, { tetoMs: 50 });
    const r = await agente.processarLote(pedido(["l1"], "qual o horário?"));
    expect(r.respostas).toEqual([MENSAGEM_TRANSFERENCIA]);
    expect(r.avisoAtendente).toContain("Motivo: lacuna_conhecimento");
    expect(r.avisoAtendente).toContain("Pergunta sem resposta: qual o horário?");
  });

  it("[I1] lote guardado repetido depois que o atendente assumiu: não devolve a resposta velha da IA", async () => {
    const { agente } = montar(new ScriptedLLM([endTurn("resposta da IA")]));
    const p = pedido(["g1"]);
    await agente.processarLote(p);
    await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "at1", texto: "assumi", timestamp: T });
    expect(await agente.processarLote(p)).toEqual({ respostas: [], modo: "humano" });
  });

  it("[I1] resposta de transferência guardada continua saindo igual na repetição", async () => {
    const { agente } = montar(new ScriptedLLM([toolUse("transferir_humano", { motivo: "pedido_cliente", prioridade: "normal" }), endTurn("Já te passo.")]));
    const p = pedido(["g2"], "quero atendente");
    const a = await agente.processarLote(p);
    expect(await agente.processarLote(p)).toEqual(a);
  });

  it("[C2a] resposta vazia não entra no histórico; conta como falha e a 2ª vez transfere", async () => {
    const llm = new ScriptedLLM([endTurn(""), endTurn("")]);
    const { agente, repo } = montar(llm);
    const p = pedido(["v1"]);
    await expect(agente.processarLote(p)).rejects.toThrow(/vazia/);
    expect(repo.carregar(TEL).estado.historico).toEqual([]);
    const r = await agente.processarLote(p);
    expect(r).toMatchObject({ respostas: [MSG_FALHA], modo: "humano" });
  });

  it("[C2a] resposta vazia e depois resposta boa: o cliente recebe a boa", async () => {
    const llm = new ScriptedLLM([endTurn(""), endTurn("ok")]);
    const { agente } = montar(llm);
    const p = pedido(["v2"]);
    await expect(agente.processarLote(p)).rejects.toThrow();
    expect(await agente.processarLote(p)).toEqual({ respostas: ["ok"], modo: "ia" });
    expect(llm.seen[1].some((m) => m.content === "")).toBe(false);
  });

  it("[C2b] depois de 20 trocas, a janela mandada ao modelo começa com o cliente e alterna", async () => {
    const llm = new ScriptedLLM(Array.from({ length: 21 }, (_, i) => endTurn(`r${i}`)));
    const { agente } = montar(llm);
    for (let i = 0; i < 21; i++) await agente.processarLote(pedido([`w${i}`], `msg ${i}`));
    expect(llm.seen[20][0].role).toBe("user");
    expect(papeisAlternados(llm.seen[20])).toBe(true);
  });

  it("[C2c] atendente escreve primeiro e devolve: a janela começa com o cliente e alterna", async () => {
    const llm = new ScriptedLLM([endTurn("oi")]);
    const { agente } = montar(llm);
    await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "a0", texto: "Olá, aqui é a loja", timestamp: T });
    await agente.processarEvento({ tipo: "devolver", telefone: TEL });
    await agente.processarLote(pedido(["c1"], "oi, quero canecas"));
    expect(llm.seen[0][0].role).toBe("user");
    expect(papeisAlternados(llm.seen[0])).toBe(true);
    expect(JSON.stringify(llm.seen[0])).toContain("Olá, aqui é a loja");
  });

  it("[I2] atendente assume no meio do turno: o turno para antes da próxima ferramenta e não conta como falha", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conversas-"));
    semearPendente(dir);
    const client = new EscritaSimuladaClient(new MockBrindeMeClient());
    const criar = vi.spyOn(client, "createBudget");
    const llm = new ScriptedLLM([toolUse("criar_orcamento", { token_confirmacao: "tok" }), endTurn("Orçamento criado!")], 80);
    const { agente, repo } = montar(llm, { client, dir });
    const turno = agente.processarLote(pedido(["m1"], "pode criar"));
    await new Promise((r) => setTimeout(r, 20));
    await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "at5", texto: "deixa comigo", timestamp: T });
    expect(await turno).toEqual({ respostas: [], modo: "humano" });
    expect(criar).not.toHaveBeenCalled();
    expect(repo.carregar(TEL).falhasPorTurno).toEqual({});
  });

  it("[I2] orçamento criado antes de o atendente assumir: o aviso conta o que o agente já fez", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conversas-"));
    semearPendente(dir);
    let assumir!: () => Promise<unknown>;
    const llm: LLMProvider = {
      chat: vi
        .fn<LLMProvider["chat"]>()
        .mockResolvedValueOnce(toolUse("criar_orcamento", { token_confirmacao: "tok" }))
        .mockImplementationOnce(async () => {
          await assumir();
          return endTurn("Pronto, orçamento criado!");
        }),
    };
    const { agente } = montar(llm, { client: new EscritaSimuladaClient(new MockBrindeMeClient()), dir });
    assumir = () =>
      agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "at6", texto: "assumo daqui", timestamp: T });
    const r = await agente.processarLote(pedido(["m2"], "pode criar"));
    expect(r.respostas).toEqual([]);
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toMatch(/TESTE-/);
  });

  it("[I3] lote reagrupado pela ponte: a resposta guardada que não foi entregue vem junto", async () => {
    const llm = new ScriptedLLM([endTurn("resposta para m1+m2"), endTurn("resposta para m3")]);
    const { agente } = montar(llm);
    const m = (id: string, texto: string) => ({ id, timestamp: T, texto });
    await agente.processarLote({ turnoId: calcularTurnoId(["m1", "m2"]), telefone: TEL, mensagens: [m("m1", "quero canecas"), m("m2", "50")] });
    const r = await agente.processarLote({
      turnoId: calcularTurnoId(["m1", "m2", "m3"]),
      telefone: TEL,
      mensagens: [m("m1", "quero canecas"), m("m2", "50"), m("m3", "cadê?")],
    });
    expect(r.respostas).toEqual(["resposta para m1+m2", "resposta para m3"]);
  });

  it("[I3] reagrupado só com mensagens já respondidas: devolve a resposta guardada", async () => {
    const llm = new ScriptedLLM([endTurn("resposta para m1+m2")]);
    const { agente } = montar(llm);
    const m = (id: string) => ({ id, timestamp: T, texto: id });
    await agente.processarLote({ turnoId: calcularTurnoId(["m1", "m2"]), telefone: TEL, mensagens: [m("m1"), m("m2")] });
    const r = await agente.processarLote({ turnoId: calcularTurnoId(["m2"]), telefone: TEL, mensagens: [m("m2")] });
    expect(r.respostas).toEqual(["resposta para m1+m2"]);
    expect(llm.seen).toHaveLength(1);
  });

  it("[I4c] registrar_arte repetido depois de falha não duplica a arte", async () => {
    const llm = new ScriptedLLM([
      toolUse("registrar_arte", { descricao_arquivo: "logo.png" }),
      new Error("overloaded"),
      toolUse("registrar_arte", { descricao_arquivo: "logo.png" }),
      endTurn("Recebi!"),
    ]);
    const { agente, repo } = montar(llm);
    const arquivo = { caminho: "C:/artes/abc.png", mime: "image/png", bytes: 2048, nome: "logo.png" };
    const p = { turnoId: calcularTurnoId(["f1"]), telefone: TEL, mensagens: [{ id: "f1", timestamp: T, texto: "", arquivo }] };
    await expect(agente.processarLote(p)).rejects.toThrow();
    await agente.processarLote(p);
    expect(repo.carregar(TEL).estado.artes).toHaveLength(1);
  });

  it("[I4a] arquivo recusado pela ponte não vira arte registrada", async () => {
    const llm = new ScriptedLLM([toolUse("registrar_arte", { descricao_arquivo: "logo.png" }), endTurn("Não consegui usar essa arte.")]);
    const { agente, repo } = montar(llm);
    await agente.processarLote(pedido(["x1"], "[arquivo recusado: logo.png, o conteúdo não é um PNG de verdade]\nsegue a arte"));
    expect(repo.carregar(TEL).estado.artes).toEqual([]);
    const resultado = JSON.parse(String((llm.seen[1].at(-1)?.content as Array<{ content: string }>)[0].content));
    expect(resultado).toMatchObject({ erro: "arquivo_nao_recebido" });
  });

  it("[I4b] arquivo que chega com a conversa no atendente fica guardado para depois do #devolver", async () => {
    const llm = new ScriptedLLM([toolUse("registrar_arte", { descricao_arquivo: "logo.png" }), endTurn("Registrei!")]);
    const { agente, repo } = montar(llm);
    await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "at1", texto: "pode mandar a arte", timestamp: T });
    const arquivo = { caminho: "C:/artes/5583999990000/abc.png", mime: "image/png", bytes: 2048, nome: "logo.png" };
    await agente.processarLote({ turnoId: calcularTurnoId(["h1"]), telefone: TEL, mensagens: [{ id: "h1", timestamp: T, texto: "", arquivo }] });
    await agente.processarEvento({ tipo: "devolver", telefone: TEL, nota: "registrar a arte" });
    await agente.processarLote(pedido(["h2"], "registra a arte que mandei"));
    expect(repo.carregar(TEL).estado.artes[0].arquivo).toBe("C:/artes/5583999990000/abc.png");
  });

  it("[M1] arquivo de estado sem campos obrigatórios é tratado como corrompido", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conversas-"));
    const base = new RepositorioConversas(dir).carregar(TEL);
    const { idsVistos: _ignorado, ...semIds } = base;
    writeFileSync(join(dir, `${TEL}.json`), JSON.stringify(semIds));
    const { agente } = montar(new ScriptedLLM([endTurn("voltei")]), { dir });
    expect(await agente.processarLote(pedido(["k1"]))).toEqual({ respostas: ["voltei"], modo: "ia" });
  });

  it("[M2] ferramenta de leitura pendurada não segura o turno além do teto", async () => {
    const client = new MockBrindeMeClient();
    const consulta = vi.spyOn(client, "getProduct").mockImplementation(() => new Promise(() => {}));
    const llm = new ScriptedLLM([toolUse("detalhar_produto", { produto_id: "p-1" }), endTurn("x")]);
    const { agente } = montar(llm, { tetoMs: 50, client });
    const inicio = Date.now();
    const r = await agente.processarLote(pedido(["p1"], "me fala da caneca"));
    expect(consulta).toHaveBeenCalled();
    expect(Date.now() - inicio).toBeLessThan(1_000);
    expect(r.respostas).toEqual([MSG_FALHA]);
  });

  it("[M3] #devolver de telefone sem conversa é recusado e não cria arquivo", async () => {
    const { agente, dir } = montar(new ScriptedLLM());
    await expect(agente.processarEvento({ tipo: "devolver", telefone: "5583999990001" })).rejects.toBeInstanceOf(
      ConversaDesconhecidaError
    );
    expect(existsSync(join(dir, "5583999990001.json"))).toBe(false);
  });

  it("[M4] mensagem que ficou no histórico de uma tentativa que caiu não é duplicada", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conversas-"));
    const repo = new RepositorioConversas(dir);
    const c = repo.carregar(TEL);
    c.estado.historico.push({ role: "user", content: "pode criar", timestamp: T });
    repo.salvar(c);
    const { agente } = montar(new ScriptedLLM([endTurn("criado")]), { dir });
    await agente.processarLote(pedido(["c9"], "pode criar"));
    expect(new RepositorioConversas(dir).carregar(TEL).estado.historico.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("[I6] conversa ociosa sai da memória e volta do disco igual", async () => {
    const llm = new ScriptedLLM([endTurn("um"), endTurn("dois")]);
    const { agente } = montar(llm, { memoriaMs: 0 });
    await agente.processarLote(pedido(["i1"], "primeira"));
    await agente.processarLote(pedido(["i2"], "segunda"));
    expect(llm.seen[1].map((m) => m.content)).toEqual(["primeira", "um", "segunda"]);
  });

  it("[I6] histórico guardado tem teto", async () => {
    const { agente, repo } = montar(new ScriptedLLM());
    for (let i = 0; i < 260; i++) {
      await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: `at${i}`, texto: `nota ${i}`, timestamp: T });
    }
    expect(repo.carregar(TEL).estado.historico.length).toBeLessThanOrEqual(200);
  });

  it("dois telefones ao mesmo tempo: o modelo lento de um não segura a resposta do outro", async () => {
    const LENTO = "5583888880000";
    let liberarLento!: (r: LLMResponse) => void;
    const llm: LLMProvider = {
      chat: (p) => {
        const ultima = p.messages[p.messages.length - 1];
        if (typeof ultima.content === "string" && ultima.content.includes("demora")) {
          return new Promise<LLMResponse>((r) => (liberarLento = r));
        }
        return Promise.resolve(endTurn("pronto"));
      },
    };
    const { agente } = montar(llm);
    const lento = agente.processarLote({ ...pedido(["a1"], "demora"), telefone: LENTO });
    await vi.waitFor(() => expect(liberarLento).toBeTypeOf("function"));

    expect(await agente.processarLote(pedido(["b1"], "rápido"))).toEqual({ respostas: ["pronto"], modo: "ia" });

    liberarLento(endTurn("enfim"));
    expect(await lento).toEqual({ respostas: ["enfim"], modo: "ia" });
  });
});
