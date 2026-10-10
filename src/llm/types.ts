export interface LLMTool {
  name: string;
  description: string;
  input_schema: object;
}

export interface LLMMessage {
  role: "user" | "assistant";
  content: string | LLMContentBlock[];
}

export interface LLMContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

export interface LLMResponse {
  id: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | string;
  content: LLMContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
}

export interface LLMProvider {
  chat(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMTool[];
    model: string;
  }): Promise<LLMResponse>;
}
