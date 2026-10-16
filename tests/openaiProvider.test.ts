import { describe, it, expect } from "vitest";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { OpenAIProvider, type ClienteOpenAI } from "../src/llm/openai.js";
import { criarLLM } from "../src/llm/index.js";
import type { LLMMessage } from "../src/llm/types.js";

function completion(message: Partial<ChatCompletion.Choice["message"]>, finish: ChatCompletion.Choice["finish_reason"]): ChatCompletion {
  return {
    id: "cmpl-1",
    object: "chat.completion",
    created: 0,
    model: "modelo-teste",
    choices: [{ index: 0, logprobs: null, finish_reason: finish, message: { role: "assistant", content: null, refusal: null, ...message } }],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  };
}

function clienteFalso(resposta: ChatCompletion) {
  const chamadas: Array<{ body: Record<string, unknown>; options?: { signal?: AbortSignal } }> = [];
  const cliente: ClienteOpenAI = {
    chat: {
      completions: {
        create: async (body, options) => {
          chamadas.push({ body: body as unknown as Record<string, unknown>, options });
          return resposta;
        },
      },
    },
  };
  return { cliente, chamadas };
}

const TOOL = { name: "buscar_produtos", description: "Busca no catálogo", input_schema: { type: "object", properties: { termo: { type: "string" } } } };

describe("OpenAIProvider", () => {
  it("traduz histórico com ferramenta para o formato da OpenAI e repassa o cancelamento", async () => {
    const { cliente, chamadas } = clienteFalso(completion({ content: "ok" }, "stop"));
    const historico: LLMMessage[] = [
      { role: "user", content: "quero canecas" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Vou buscar." },
          { type: "tool_use", id: "call_1", name: "buscar_produtos", input: { termo: "caneca" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"total":2}' }] },
    ];
    const controle = new AbortController();
    await new OpenAIProvider(cliente).chat({ system: "prompt", messages: historico, tools: [TOOL], model: "modelo-teste", signal: controle.signal });

    expect(chamadas[0].body).toMatchObject({
      model: "modelo-teste",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: "prompt" },
        { role: "user", content: "quero canecas" },
        {
          role: "assistant",
          content: "Vou buscar.",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "buscar_produtos", arguments: '{"termo":"caneca"}' } }],
        },
        { role: "tool", tool_call_id: "call_1", content: '{"total":2}' },
      ],
      tools: [{ type: "function", function: { name: "buscar_produtos", description: "Busca no catálogo", parameters: TOOL.input_schema } }],
    });
    expect(chamadas[0].options?.signal).toBe(controle.signal);
  });

  it("resultado de ferramenta e texto na mesma mensagem: as respostas das ferramentas vêm antes do texto", async () => {
    const { cliente, chamadas } = clienteFalso(completion({ content: "ok" }, "stop"));
    await new OpenAIProvider(cliente).chat({
      system: "prompt",
      model: "m",
      tools: [TOOL],
      messages: [
        { role: "user", content: "oi" },
        { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "buscar_produtos", input: {} }] },
        { role: "user", content: [{ type: "text", text: "[Atendente]: oi" }, { type: "tool_result", tool_use_id: "c1", content: "[]" }] },
      ],
    });
    const msgs = chamadas[0].body.messages as Array<Record<string, unknown>>;
    expect(msgs.slice(2)).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "buscar_produtos", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "[]" },
      { role: "user", content: "[Atendente]: oi" },
    ]);
  });

  it("nível de raciocínio configurado vai na chamada; sem configuração, não vai", async () => {
    const com = clienteFalso(completion({ content: "ok" }, "stop"));
    await new OpenAIProvider(com.cliente, { esforco: "low" }).chat({ system: "s", model: "m", tools: [], messages: [{ role: "user", content: "oi" }] });
    expect(com.chamadas[0].body.reasoning_effort).toBe("low");

    const sem = clienteFalso(completion({ content: "ok" }, "stop"));
    await new OpenAIProvider(sem.cliente).chat({ system: "s", model: "m", tools: [], messages: [{ role: "user", content: "oi" }] });
    expect(sem.chamadas[0].body).not.toHaveProperty("reasoning_effort");
  });

  it("sem ferramentas, não manda a lista vazia", async () => {
    const { cliente, chamadas } = clienteFalso(completion({ content: "ok" }, "stop"));
    await new OpenAIProvider(cliente).chat({ system: "s", model: "m", tools: [], messages: [{ role: "user", content: "oi" }] });
    expect(chamadas[0].body).not.toHaveProperty("tools");
  });

  it("chamada de ferramenta volta como tool_use, com os argumentos já lidos", async () => {
    const { cliente } = clienteFalso(
      completion(
        { content: null, tool_calls: [{ id: "call_9", type: "function", function: { name: "buscar_produtos", arguments: '{"termo":"copo"}' } }] },
        "tool_calls"
      )
    );
    const r = await new OpenAIProvider(cliente).chat({ system: "s", model: "m", tools: [TOOL], messages: [{ role: "user", content: "copo" }] });
    expect(r).toEqual({
      id: "cmpl-1",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "call_9", name: "buscar_produtos", input: { termo: "copo" } }],
      usage: { input_tokens: 120, output_tokens: 30 },
    });
  });

  it("texto final vira end_turn; corte por tamanho vira max_tokens", async () => {
    const fim = await new OpenAIProvider(clienteFalso(completion({ content: "Olá!" }, "stop")).cliente).chat({
      system: "s", model: "m", tools: [], messages: [{ role: "user", content: "oi" }],
    });
    expect(fim.stop_reason).toBe("end_turn");
    expect(fim.content).toEqual([{ type: "text", text: "Olá!" }]);

    const cortado = await new OpenAIProvider(clienteFalso(completion({ content: "Olá, tudo" }, "length")).cliente).chat({
      system: "s", model: "m", tools: [], messages: [{ role: "user", content: "oi" }],
    });
    expect(cortado.stop_reason).toBe("max_tokens");
  });

  it("argumentos que não são JSON válido viram objeto vazio (a validação da ferramenta devolve o erro ao modelo)", async () => {
    const { cliente } = clienteFalso(
      completion({ tool_calls: [{ id: "c", type: "function", function: { name: "buscar_produtos", arguments: '{"termo": "cop' } }] }, "tool_calls")
    );
    const r = await new OpenAIProvider(cliente).chat({ system: "s", model: "m", tools: [TOOL], messages: [{ role: "user", content: "x" }] });
    expect(r.content).toEqual([{ type: "tool_use", id: "c", name: "buscar_produtos", input: {} }]);
  });
});

describe("criarLLM", () => {
  it("sem OPENAI_API_KEY ou sem LLM_MODEL, recusa com a explicação", () => {
    expect(() => criarLLM({ openaiApiKey: "", llmModel: "m", llmRaciocinio: "" })).toThrow(/OPENAI_API_KEY/);
    expect(() => criarLLM({ openaiApiKey: "chave", llmModel: "", llmRaciocinio: "" })).toThrow(/LLM_MODEL/);
  });

  it("LLM_REASONING com valor que a OpenAI não aceita: recusa com os valores válidos", () => {
    expect(() => criarLLM({ openaiApiKey: "chave", llmModel: "m", llmRaciocinio: "baixo" })).toThrow(/none, minimal, low, medium, high, xhigh, max/);
  });

  it("com chave e modelo, devolve o provedor da OpenAI", () => {
    expect(criarLLM({ openaiApiKey: "chave-falsa", llmModel: "m", llmRaciocinio: "low" })).toBeInstanceOf(OpenAIProvider);
  });
});
