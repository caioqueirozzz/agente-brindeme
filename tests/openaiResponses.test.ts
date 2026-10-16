import { describe, it, expect } from "vitest";
import type { Response } from "openai/resources/responses/responses";
import { OpenAIResponsesProvider, type ClienteResponses } from "../src/llm/openaiResponses.js";
import { criarLLM } from "../src/llm/index.js";
import { OpenAIProvider } from "../src/llm/openai.js";
import type { LLMMessage } from "../src/llm/types.js";

function resposta(output: unknown[], extra: Partial<Response> = {}): Response {
  return {
    id: "resp-1",
    status: "completed",
    output,
    incomplete_details: null,
    usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
    ...extra,
  } as unknown as Response;
}

function clienteFalso(r: Response) {
  const chamadas: Array<{ body: Record<string, unknown>; options?: { signal?: AbortSignal } }> = [];
  const cliente: ClienteResponses = {
    responses: {
      create: async (body, options) => {
        chamadas.push({ body: body as unknown as Record<string, unknown>, options });
        return r;
      },
    },
  };
  return { cliente, chamadas };
}

const TOOL = { name: "buscar_produtos", description: "Busca no catálogo", input_schema: { type: "object", properties: { termo: { type: "string" } } } };
const texto = (t: string) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text: t }] });

describe("OpenAIResponsesProvider (#8)", () => {
  it("traduz o histórico com ferramenta para itens da Responses e repassa o cancelamento", async () => {
    const { cliente, chamadas } = clienteFalso(resposta([texto("ok")]));
    const historico: LLMMessage[] = [
      { role: "user", content: "quero canecas" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Vou buscar." },
          { type: "tool_use", id: "call_1", name: "buscar_produtos", input: { termo: "caneca" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"total":2}' }, { type: "text", text: "[Atendente]: oi" }] },
    ];
    const controle = new AbortController();
    await new OpenAIResponsesProvider(cliente).chat({ system: "prompt", messages: historico, tools: [TOOL], model: "m", signal: controle.signal });

    expect(chamadas[0].body).toMatchObject({
      model: "m",
      instructions: "prompt",
      store: false,
      max_output_tokens: 4096,
      input: [
        { role: "user", content: "quero canecas" },
        { role: "assistant", content: "Vou buscar." },
        { type: "function_call", call_id: "call_1", name: "buscar_produtos", arguments: '{"termo":"caneca"}' },
        { type: "function_call_output", call_id: "call_1", output: '{"total":2}' },
        { role: "user", content: "[Atendente]: oi" },
      ],
      tools: [{ type: "function", name: "buscar_produtos", description: "Busca no catálogo", parameters: TOOL.input_schema, strict: false }],
    });
    expect(chamadas[0].options?.signal).toBe(controle.signal);
  });

  it("raciocínio vai como reasoning.effort; sem configuração, não vai", async () => {
    const com = clienteFalso(resposta([texto("ok")]));
    await new OpenAIResponsesProvider(com.cliente, { esforco: "low" }).chat({ system: "s", model: "m", tools: [], messages: [{ role: "user", content: "oi" }] });
    expect(com.chamadas[0].body.reasoning).toEqual({ effort: "low" });

    const sem = clienteFalso(resposta([texto("ok")]));
    await new OpenAIResponsesProvider(sem.cliente).chat({ system: "s", model: "m", tools: [], messages: [{ role: "user", content: "oi" }] });
    expect(sem.chamadas[0].body).not.toHaveProperty("reasoning");
    expect(sem.chamadas[0].body).not.toHaveProperty("tools");
  });

  it("function_call volta como tool_use; item de raciocínio é ignorado", async () => {
    const { cliente } = clienteFalso(
      resposta([
        { type: "reasoning", id: "rs_1", summary: [] },
        { type: "function_call", call_id: "call_9", name: "buscar_produtos", arguments: '{"termo":"copo"}' },
      ])
    );
    const r = await new OpenAIResponsesProvider(cliente).chat({ system: "s", model: "m", tools: [TOOL], messages: [{ role: "user", content: "copo" }] });
    expect(r).toEqual({
      id: "resp-1",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "call_9", name: "buscar_produtos", input: { termo: "copo" } }],
      usage: { input_tokens: 120, output_tokens: 30 },
    });
  });

  it("texto vira end_turn; corte por tamanho vira max_tokens; argumentos inválidos viram {}", async () => {
    const fim = await new OpenAIResponsesProvider(clienteFalso(resposta([texto("Olá!")])).cliente).chat({
      system: "s", model: "m", tools: [], messages: [{ role: "user", content: "oi" }],
    });
    expect(fim).toMatchObject({ stop_reason: "end_turn", content: [{ type: "text", text: "Olá!" }] });

    const cortado = await new OpenAIResponsesProvider(
      clienteFalso(resposta([texto("Olá, tu")], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })).cliente
    ).chat({ system: "s", model: "m", tools: [], messages: [{ role: "user", content: "oi" }] });
    expect(cortado.stop_reason).toBe("max_tokens");

    const quebrado = await new OpenAIResponsesProvider(
      clienteFalso(resposta([{ type: "function_call", call_id: "c", name: "buscar_produtos", arguments: '{"termo": "co' }])).cliente
    ).chat({ system: "s", model: "m", tools: [TOOL], messages: [{ role: "user", content: "x" }] });
    expect(quebrado.content).toEqual([{ type: "tool_use", id: "c", name: "buscar_produtos", input: {} }]);
  });
});

describe("criarLLM com LLM_API", () => {
  const base = { openaiApiKey: "chave-falsa", llmModel: "m", llmRaciocinio: "" };

  it("responses escolhe o provedor da Responses; vazio ou chat continua na Chat Completions", () => {
    expect(criarLLM({ ...base, llmApi: "responses" })).toBeInstanceOf(OpenAIResponsesProvider);
    expect(criarLLM({ ...base, llmApi: "" })).toBeInstanceOf(OpenAIProvider);
    expect(criarLLM({ ...base, llmApi: "chat" })).toBeInstanceOf(OpenAIProvider);
  });

  it("valor desconhecido recusa com a explicação", () => {
    expect(() => criarLLM({ ...base, llmApi: "assistants" })).toThrow(/LLM_API/);
  });
});
