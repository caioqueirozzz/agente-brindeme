import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { LLMContentBlock, LLMMessage, LLMProvider, LLMResponse, LLMTool } from "./types.js";

export interface ClienteResponses {
  responses: {
    create(body: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Response>;
  };
}

/** /v1/responses: a API em que raciocínio e ferramentas funcionam juntos (issue #8). */
export class OpenAIResponsesProvider implements LLMProvider {
  constructor(
    private readonly client: ClienteResponses,
    private readonly opcoes: { esforco?: ReasoningEffort } = {}
  ) {}

  static comChave(apiKey: string, opcoes: { esforco?: ReasoningEffort } = {}): OpenAIResponsesProvider {
    return new OpenAIResponsesProvider(new OpenAI({ apiKey }), opcoes);
  }

  async chat(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMTool[];
    model: string;
    signal?: AbortSignal;
  }): Promise<LLMResponse> {
    const body: ResponseCreateParamsNonStreaming = {
      model: params.model,
      instructions: params.system,
      input: params.messages.flatMap(paraItens),
      max_output_tokens: 4096,
      // Conversa de cliente não fica guardada na OpenAI; o histórico vai inteiro a cada chamada.
      store: false,
    };
    if (this.opcoes.esforco) body.reasoning = { effort: this.opcoes.esforco };
    if (params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.input_schema as Record<string, unknown>,
        strict: false,
      }));
    }
    return deResponses(await this.client.responses.create(body, { signal: params.signal }));
  }
}

function paraItens(m: LLMMessage): ResponseInputItem[] {
  if (typeof m.content === "string") return [{ role: m.role, content: m.content }];
  const textos = m.content.filter((b) => b.type === "text").map((b) => b.text ?? "");
  if (m.role === "assistant") {
    // Sem o id do item: a OpenAI exigiria junto o item de raciocínio, que não guardamos.
    const chamadas: ResponseInputItem[] = m.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ type: "function_call", call_id: b.id ?? "", name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) }));
    return [...(textos.length > 0 ? [{ role: "assistant" as const, content: textos.join("\n") }] : []), ...chamadas];
  }
  const resultados: ResponseInputItem[] = m.content
    .filter((b) => b.type === "tool_result")
    .map((b) => ({ type: "function_call_output", call_id: b.tool_use_id ?? "", output: b.content ?? "" }));
  return textos.length > 0 ? [...resultados, { role: "user", content: textos.join("\n") }] : resultados;
}

function deResponses(r: Response): LLMResponse {
  const content: LLMContentBlock[] = [];
  for (const item of r.output) {
    if (item.type === "message") {
      const texto = item.content.map((c) => (c.type === "output_text" ? c.text : "")).join("");
      if (texto) content.push({ type: "text", text: texto });
    } else if (item.type === "function_call") {
      content.push({ type: "tool_use", id: item.call_id, name: item.name, input: lerArgumentos(item.arguments) });
    }
  }
  const temFerramenta = content.some((b) => b.type === "tool_use");
  const cortado = r.status === "incomplete" && r.incomplete_details?.reason === "max_output_tokens";
  return {
    id: r.id,
    stop_reason: temFerramenta ? "tool_use" : cortado ? "max_tokens" : "end_turn",
    content,
    usage: { input_tokens: r.usage?.input_tokens ?? 0, output_tokens: r.usage?.output_tokens ?? 0 },
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
