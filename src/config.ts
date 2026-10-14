import "dotenv/config";

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "claude-sonnet-4-5",
  assistantName: process.env.ASSISTANT_NAME ?? "Lia",
  storeName: process.env.STORE_NAME ?? "Brinde.me",

  brindeMe: {
    /** "mock" usa os JSONs de mocks/; "http" bate na API real. */
    mode: (process.env.BRINDEME_MODE ?? "mock") as "mock" | "http",
    baseUrl: (process.env.BRINDEME_BASE_URL ?? "").replace(/\/+$/, ""),
    token: process.env.BRINDEME_TOKEN ?? "",
    /**
     * Como o token viaja. O painel da loja especifica o header X-Api-Key;
     * "bearer" (Authorization: Bearer <token>) fica como alternativa.
     */
    authScheme: (process.env.BRINDEME_AUTH_SCHEME ?? "header") as "bearer" | "header",
    authHeader: process.env.BRINDEME_AUTH_HEADER ?? "X-Api-Key",
    /** A API devolve valores monetários em centavos (price: 377 = R$ 3,77). */
    precoEmCentavos: (process.env.BRINDEME_PRECO_EM_CENTAVOS ?? "true") !== "false",
    /** Grava logs/api.jsonl com status e duração de cada chamada. */
    logarChamadas: (process.env.BRINDEME_LOG_CHAMADAS ?? "true") !== "false",
    timeoutMs: int(process.env.BRINDEME_TIMEOUT_MS, 10_000),
    maxRetries: int(process.env.BRINDEME_MAX_RETRIES, 2),
  },

  conhecimento: {
    /**
     * Só item `aprovado` chega ao cliente. Ligue apenas em desenvolvimento para
     * conversar com a base ainda em rascunho; item com [PLACEHOLDER] nunca é
     * servido, mesmo com a chave ligada.
     */
    incluirRascunhos: (process.env.KB_INCLUIR_RASCUNHOS ?? "false") === "true",
  },

  catalogo: {
    /** Chamadas simultâneas a GET /product/{id} durante a sincronização. */
    concorrencia: int(process.env.CATALOGO_CONCORRENCIA, 5),
    /** Idade máxima de um produto no índice antes de ser relido, mesmo sem mudança em updated_at. */
    maxIdadeHoras: int(process.env.CATALOGO_MAX_IDADE_HORAS, 6),
  },
};
