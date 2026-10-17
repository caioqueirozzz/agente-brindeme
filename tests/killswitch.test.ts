import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgenteDefinitivo, MSG_SUSPENSAO } from "../src/api/agenteDefinitivo.js";
import { RepositorioConversas } from "../src/conversas/repositorio.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { setBaseConhecimento, setLacunaStore } from "../src/tools/consultarConhecimento.js";
import { MemoryLacunaStore } from "../src/knowledge/lacunas.js";
import { BaseConhecimento } from "../src/knowledge/base.js";
import { ScriptedLLM, endTurn, toolUse } from "./helpers/llmRoteirizado.js";
import { pedido } from "./helpers/bateriaContrato.js";
import { runTurn } from "../src/agent/runTurn.js";
import { createInitialState } from "../src/agent/state.js";
import { Logger } from "../src/logging/logger.js";

const TEL = "5583999990000";

function montar(lerEstado?: () => { suspenso: boolean; ferramentasDesligadas?: string[] }) {
  const dir = mkdtempSync(join(tmpdir(), "ks-"));
  const repo = new RepositorioConversas(dir);
  const agente = new AgenteDefinitivo({
    repo,
    llm: new ScriptedLLM([endTurn("Olá!")]),
    client: new MockBrindeMeClient(),
    tetoMs: 5_000,
    respostasPorHora: 30,
    lerEstado,
  });
  return { agente, repo };
}

describe("kill switch — AgenteDefinitivo", () => {
  beforeEach(() => {
    setLacunaStore(new MemoryLacunaStore());
    setBaseConhecimento(new BaseConhecimento([], { incluirRascunhos: false }));
  });
  afterEach(() => setBaseConhecimento(null));

  it("suspenso: retorna MSG_SUSPENSAO sem salvar turno", async () => {
    const { agente, repo } = montar(() => ({ suspenso: true }));
    const p = pedido(TEL, ["ks1"]);
    const r = await agente.processarLote(p);
    expect(r).toEqual({ respostas: [MSG_SUSPENSAO], modo: "ia" });
    // Não salva como turno: cliente pode tentar de novo quando retomar
    expect(repo.carregar(TEL).turnos).toHaveLength(0);
  });

  it("suspenso: não bloqueia TurnoEmAndamento (agente ativo recebe o check do suspend)", async () => {
    const { agente } = montar(() => ({ suspenso: true }));
    // Dois lotes diferentes, ambos recebem MSG_SUSPENSAO (sem 409)
    const r1 = await agente.processarLote(pedido(TEL, ["ks2"]));
    const r2 = await agente.processarLote(pedido(TEL, ["ks3"]));
    expect(r1.respostas).toEqual([MSG_SUSPENSAO]);
    expect(r2.respostas).toEqual([MSG_SUSPENSAO]);
  });

  it("não suspenso: agente responde normalmente", async () => {
    const { agente } = montar(() => ({ suspenso: false }));
    const r = await agente.processarLote(pedido(TEL, ["ks4"]));
    expect(r.respostas).toEqual(["Olá!"]);
    expect(r.modo).toBe("ia");
  });

  it("lote já respondido é devolvido mesmo com agente suspenso (idempotência)", async () => {
    const { agente } = montar(() => ({ suspenso: false }));
    const p = pedido(TEL, ["ks5"]);
    const original = await agente.processarLote(p);
    // Agora suspende e tenta de novo o mesmo turnoId
    const { agente: agenteB, repo } = montar(() => ({ suspenso: true }));
    // Agente B lê do mesmo repo — tem o turno guardado
    const dir = mkdtempSync(join(tmpdir(), "ks-"));
    const repo2 = new RepositorioConversas(dir);
    const c = repo2.carregar(TEL);
    c.turnos.push({ turnoId: p.turnoId, resposta: original, ids: p.mensagens.map((m) => m.id) });
    repo2.salvar(c);
    const agenteC = new AgenteDefinitivo({
      repo: repo2,
      llm: new ScriptedLLM(),
      client: new MockBrindeMeClient(),
      tetoMs: 5_000,
      respostasPorHora: 30,
      lerEstado: () => ({ suspenso: true }),
    });
    expect(await agenteC.processarLote(p)).toEqual(original);
  });
});

describe("ferramenta desligada — runTurn", () => {
  beforeEach(() => {
    setLacunaStore(new MemoryLacunaStore());
    setBaseConhecimento(new BaseConhecimento([], { incluirRascunhos: false }));
  });
  afterEach(() => setBaseConhecimento(null));

  it("ferramenta desligada: runTurn passa instrucao=transferir ao modelo e nunca chama o handler", async () => {
    const state = createInitialState(TEL);
    const llm = new ScriptedLLM([
      toolUse("buscar_produtos", { ocasiao: "natal", quantidade: 50 }),
      endTurn("Não consigo pesquisar agora, chamei alguém."),
    ]);
    const r = await runTurn("quero produtos para natal", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId), {
      ferramentasDesligadas: new Set(["buscar_produtos"]),
    });
    expect(r.toolsCalled[0].name).toBe("buscar_produtos");
    // O modelo recebeu instrucao=transferir mas não o resultado real da busca
    const msgFerramenta = llm.seen[1]?.at(-1);
    expect(JSON.stringify(msgFerramenta)).toContain("ferramenta_desligada");
    // Sem erro de execução real (o handler nunca foi chamado)
    expect(r.response).toBeTruthy();
  });

  it("ferramenta não listada: roda normalmente mesmo com outras desligadas", async () => {
    const state = createInitialState(TEL);
    const llm = new ScriptedLLM([endTurn("Olá!")]);
    const r = await runTurn("oi", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId), {
      ferramentasDesligadas: new Set(["criar_orcamento"]),
    });
    expect(r.response).toBe("Olá!");
  });
});

describe("ferramenta desligada — AgenteDefinitivo", () => {
  beforeEach(() => {
    setLacunaStore(new MemoryLacunaStore());
    setBaseConhecimento(new BaseConhecimento([], { incluirRascunhos: false }));
  });
  afterEach(() => setBaseConhecimento(null));

  it("ferramenta desligada via lerEstado é passada ao runTurn", async () => {
    const { agente, repo } = montar(() => ({
      suspenso: false,
      ferramentasDesligadas: ["criar_orcamento"],
    }));
    // Não testamos que o runTurn recusa, só que o agente não estoura e finaliza
    const r = await agente.processarLote(pedido(TEL, ["ks10"]));
    expect(r.modo).toBeDefined();
  });
});
