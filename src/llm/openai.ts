import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { LLMContentBlock, LLMMessage, LLMProvider, LLMResponse, LLMTool } from "./types.js";

/** Só o que o adaptador usa do SDK: permite testar a tradução sem rede. */
export interface ClienteOpenAI {
  chat: {
    completions: {
      create(body: ChatCompletionCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<ChatCompletion>;
    };
  };
}

/** O agente fala no formato de blocos (text / tool_use / tool_result); aqui ele vira o da Chat Completions e volta. */
export class OpenAIProvider implements LLMProvider {
  constructor(
    private readonly client: ClienteOpenAI,
    private readonly opcoes: { esforco?: ReasoningEffort } = {}
  ) {}

  static comChave(apiKey: string, opcoes: { esforco?: ReasoningEffort } = {}): OpenAIProvider {
    return new OpenAIProvider(new OpenAI({ apiKey }), opcoes);
  }

  async chat(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMTool[];
    model: string;
    signal?: AbortSignal;
  }): Promise<LLMResponse> {
    const body: ChatCompletionCreateParamsNonStreaming = {
      model: params.model,
      max_completion_tokens: 4096,
      messages: [{ role: "system", content: params.system }, ...params.messages.flatMap(paraOpenAI)],
    };
    if (this.opcoes.esforco) body.reasoning_effort = this.opcoes.esforco;
    if (params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema as Record<string, unknown> },
      }));
    }
    const resposta = await this.client.chat.completions.create(body, { signal: params.signal });
    return deOpenAI(resposta);
  }
}

function paraOpenAI(m: LLMMessage): ChatCompletionMessageParam[] {
  if (typeof m.content === "string") return [{ role: m.role, content: m.content }];
  const textos = m.content.filter((b) => b.type === "text").map((b) => b.text ?? "");
  if (m.role === "assistant") {
    const chamadas = m.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        id: b.id ?? "",
        type: "function" as const,
        function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
      }));
    return [{ role: "assistant", content: textos.length > 0 ? textos.join("\n") : null, ...(chamadas.length > 0 ? { tool_calls: chamadas } : {}) }];
  }
  // A OpenAI exige as respostas das ferramentas logo depois da mensagem que as chamou.
  const resultados: ChatCompletionMessageParam[] = m.content
    .filter((b) => b.type === "tool_result")
    .map((b) => ({ role: "tool", tool_call_id: b.tool_use_id ?? "", content: b.content ?? "" }));
  return textos.length > 0 ? [...resultados, { role: "user", content: textos.join("\n") }] : resultados;
}

function deOpenAI(resposta: ChatCompletion): LLMResponse {
  const escolha = resposta.choices[0];
  const content: LLMContentBlock[] = [];
  if (escolha?.message.content) content.push({ type: "text", text: escolha.message.content });
  for (const chamada of escolha?.message.tool_calls ?? []) {
    if (chamada.type !== "function") continue;
    content.push({ type: "tool_use", id: chamada.id, name: chamada.function.name, input: lerArgumentos(chamada.function.arguments) });
  }
  const temFerramenta = content.some((b) => b.type === "tool_use");
  return {
    id: resposta.id,
    stop_reason: temFerramenta ? "tool_use" : escolha?.finish_reason === "length" ? "max_tokens" : "end_turn",
    content,
    usage: { input_tokens: resposta.usage?.prompt_tokens ?? 0, output_tokens: resposta.usage?.completion_tokens ?? 0 },
  };
}

function lerArgumentos(bruto: string): unknown {
  try {
    const lido: unknown = JSON.parse(bruto);
    return typeof lido === "object" && lido !== null ? lido : {};
  } catch {
    return {};
  }
}
