import type { ReasoningEffort } from "openai/resources/shared";
import { config } from "../config.js";
import { OpenAIProvider } from "./openai.js";
import { OpenAIResponsesProvider } from "./openaiResponses.js";
import type { LLMProvider } from "./types.js";

const ESFORCOS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const APIS = ["chat", "responses"] as const;

/** Único lugar que escolhe o modelo: sem chave ou sem modelo, nada sobe. */
export function criarLLM(
  cfg: { openaiApiKey: string; llmModel: string; llmRaciocinio: string; llmApi?: string } = config
): LLMProvider {
  if (!cfg.openaiApiKey) throw new Error("OPENAI_API_KEY não configurada no .env.");
  if (!cfg.llmModel) throw new Error("LLM_MODEL não configurado no .env: coloque o id do modelo da OpenAI (ex.: gpt-6-luna).");
  const esforco = cfg.llmRaciocinio || undefined;
  if (esforco && !(ESFORCOS as readonly string[]).includes(esforco)) {
    throw new Error(`LLM_REASONING="${esforco}" não é aceito pela OpenAI. Use um de: ${ESFORCOS.join(", ")} (ou deixe vazio).`);
  }
  const api = cfg.llmApi || "chat";
  if (!(APIS as readonly string[]).includes(api)) {
    throw new Error(`LLM_API="${api}" não existe. Use chat (padrão) ou responses.`);
  }
  const opcoes = { esforco: esforco as ReasoningEffort | undefined };
  return api === "responses"
    ? OpenAIResponsesProvider.comChave(cfg.openaiApiKey, opcoes)
    : OpenAIProvider.comChave(cfg.openaiApiKey, opcoes);
}
