import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMMessage, LLMTool, LLMResponse } from "./types.js";
import { config } from "../config.js";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async chat(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMTool[];
    model: string;
    signal?: AbortSignal;
  }): Promise<LLMResponse> {
    const response = await this.client.messages.create(
      {
        model: params.model,
        max_tokens: 4096,
        system: params.system,
        messages: params.messages as Anthropic.MessageParam[],
        tools: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool["input_schema"],
        })),
      },
      { signal: params.signal }
    );

    return {
      id: response.id,
      stop_reason: response.stop_reason ?? "end_turn",
      content: response.content as LLMResponse["content"],
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
