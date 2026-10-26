import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { runTurn } from "../src/agent/runTurn.js";
import { createInitialState } from "../src/agent/state.js";
import { Logger } from "../src/logging/logger.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { carregarBase } from "../src/knowledge/base.js";
import { MemoryLacunaStore } from "../src/knowledge/lacunas.js";
import { setBaseConhecimento, setLacunaStore } from "../src/tools/consultarConhecimento.js";
import type { LLMProvider, LLMMessage, LLMResponse } from "../src/llm/types.js";

/** LLM roteirizado que também guarda o `system` de cada chamada. */
class ScriptedLLM implements LLMProvider {
  public systems: string[] = [];
  public seen: LLMMessage[][] = [];
  constructor(private script: LLMResponse[]) {}
  async chat(params: { system: string; messages: LLMMessage[] }): Promise<LLMResponse> {
    this.systems.push(params.system);
    this.seen.push(JSON.parse(JSON.stringify(params.messages)));
    return this.script.shift() ?? fim("fim");
  }
}
const usar = (name: string, input: unknown): LLMResponse => ({
  id: "m",
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: `tu-${Math.random()}`, name, input }],
  usage: { input_tokens: 1, output_tokens: 1 },
});
const fim = (text: string): LLMResponse => ({
  id: "m",
  stop_reason: "end_turn",
  content: [{ type: "text", text }],
  usage: { input_tokens: 1, output_tokens: 1 },
});

function logDa(conversaId: string): Array<Record<string, any>> {
  const f = join(process.cwd(), "logs", `${conversaId}.jsonl`);
  return readFileSync(f, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
}

function baseAprovada() {
  const dir = mkdtempSync(join(tmpdir(), "kb-"));
  writeFileSync(
    join(dir, "entrega.json"),
    JSON.stringify({
      categoria: "entrega",
      itens: [
        {
          id: "entrega-brasil",
          titulo: "Entrega para todo o Brasil",
          conteudo: "Entregamos para todo o Brasil por Correios e transportadoras.",
          palavras_chave: ["frete", "envio"],
          perguntas_exemplo: ["Vocês entregam em todo o Brasil?"],
          status: "aprovado",
          aprovado_por: "Logística",
          aprovado_em: "2026-10-01",
          revisar_em: "2027-04-01",
        },
      ],
    }),
    "utf-8"
  );
  return carregarBase({ dir }).base;
}

describe("auditoria da base de conhecimento no turno", () => {
  let lacunas: MemoryLacunaStore;
  beforeEach(() => {
    setBaseConhecimento(baseAprovada());
    lacunas = new MemoryLacunaStore();
    setLacunaStore(lacunas);
  });

  it("guarda no log qual item da base foi usado, e o inclui na resposta enviada", async () => {
    const state = createInitialState("5583999990000");
    const llm = new ScriptedLLM([
      usar("consultar_conhecimento", { pergunta: "Vocês entregam em todo o Brasil?" }),
      fim("Sim, entregamos para todo o Brasil!"),
    ]);

    await runTurn("Vocês entregam em todo o Brasil?", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId));

    const log = logDa(state.conversaId);
    const consulta = log.find((e) => e.type === "kb_consulta")!;
    expect(consulta).toMatchObject({ resultado: "encontrado", itens: ["entrega-brasil"] });
    const resposta = log.find((e) => e.type === "response_sent")!;
    expect(resposta.kb_itens).toEqual(["entrega-brasil"]);
  });

  it("turno sem consulta à base não traz kb_itens", async () => {
    const state = createInitialState("5583999990000");
    await runTurn("oi", state, new ScriptedLLM([fim("Olá!")]), new MockBrindeMeClient(), new Logger(state.conversaId));
    const resposta = logDa(state.conversaId).find((e) => e.type === "response_sent")!;
    expect(resposta).not.toHaveProperty("kb_itens");
  });

  it("pergunta sem resposta: log de lacuna, lacuna registrada e a instrução de transferir chega ao modelo", async () => {
    const state = createInitialState("5583999990000");
    const llm = new ScriptedLLM([
      usar("consultar_conhecimento", { pergunta: "Qual o CNPJ de vocês?" }),
      fim("Vou chamar um atendente."),
    ]);

    await runTurn("Qual o CNPJ de vocês?", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId));

    const log = logDa(state.conversaId);
    expect(log.find((e) => e.type === "kb_consulta")).toMatchObject({ resultado: "lacuna", itens: [] });
    expect(log.find((e) => e.type === "response_sent")).not.toHaveProperty("kb_itens");
    expect(lacunas.listar()).toHaveLength(1);

    // seen[1] é a chamada logo depois da ferramenta; o "Vou chamar um atendente." sem transferir ainda gera a cobrança.
    const depoisDaFerramenta = llm.seen[1];
    const toolResult = JSON.parse((depoisDaFerramenta[depoisDaFerramenta.length - 1].content as any[])[0].content);
    expect(toolResult).toMatchObject({ instrucao: "transferir", motivo_sugerido: "lacuna_conhecimento" });
  });

  it("a pergunta no log do turno sai mascarada", async () => {
    const state = createInitialState("5583999990000");
    const llm = new ScriptedLLM([
      usar("consultar_conhecimento", { pergunta: "meu zap é 83999990000, vocês entregam?" }),
      fim("ok"),
    ]);
    await runTurn("oi", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId));
    const consulta = logDa(state.conversaId).find((e) => e.type === "kb_consulta")!;
    expect(JSON.stringify(consulta)).not.toContain("83999990000");
  });
});

describe("prompt de sistema", () => {
  it("não embute mais a FAQ: manda consultar a base e transferir em caso de lacuna", async () => {
    const state = createInitialState("5583999990000");
    const llm = new ScriptedLLM([fim("oi")]);
    await runTurn("oi", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId));
    const sys = llm.systems[0];

    expect(sys).not.toContain("{{FAQ}}");
    expect(sys).not.toMatch(/\{\{[A-Z_]+\}\}/); // nenhum placeholder de template sobrando
    expect(sys).toContain("consultar_conhecimento");
    expect(sys).toContain("sem_resposta_na_base");
    expect(sys).toMatch(/instrucao: "transferir"/);
    expect(sys).toContain("Como recomendar produtos");
    expect(sys).toMatch(/no máximo 3 opções/);
  });
});
