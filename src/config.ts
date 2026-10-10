import "dotenv/config";

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "claude-sonnet-4-5",
  assistantName: process.env.ASSISTANT_NAME ?? "Lia",
  storeName: process.env.STORE_NAME ?? "Brinde.me",
};
