import type { LLMMessage, LLMProvider, LLMResponse } from "../../src/llm/types.js";

/** Devolve as respostas na ordem; um Error no roteiro é lançado. Guarda os messages de cada chamada. */
export class ScriptedLLM implements LLMProvider {
  public seen: LLMMessage[][] = [];

  constructor(
    private readonly script: Array<LLMResponse | Error> = [],
    private readonly atrasoMs = 0
  ) {}

  async chat(params: { messages: LLMMessage[] }): Promise<LLMResponse> {
    this.seen.push(JSON.parse(JSON.stringify(params.messages)));
    if (this.atrasoMs) await new Promise((r) => setTimeout(r, this.atrasoMs));
    const proximo = this.script.shift() ?? endTurn("fim");
    if (proximo instanceof Error) throw proximo;
    return proximo;
  }
}

export function toolUse(name: string, input: unknown = {}, id = `tu-${Math.random()}`): LLMResponse {
  return {
    id: "msg",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id, name, input }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

export function endTurn(text: string): LLMResponse {
  return {
    id: "msg",
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}
