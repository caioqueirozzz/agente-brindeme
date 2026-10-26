import "dotenv/config";

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function digitos(lista: string | undefined): string[] {
  return (lista ?? "")
    .split(",")
    .map((s) => s.replace(/\D/g, ""))
    .filter(Boolean);
}

/** Depois do teto, o agente ainda grava o estado e responde antes de a ponte desistir da chamada. */
export const FOLGA_PRAZOS_MS = 10_000;

export function conferirPrazos(tetoMs: number, agenteTimeoutMs: number): string | null {
  if (tetoMs + FOLGA_PRAZOS_MS <= agenteTimeoutMs) return null;
  return `TURNO_TETO_MS (${tetoMs}) precisa ficar pelo menos ${FOLGA_PRAZOS_MS / 1000}s abaixo de AGENTE_TIMEOUT_MS (${agenteTimeoutMs}); sem essa folga a ponte desiste antes de o agente transferir.`;
}

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  /** Sem padrão de propósito: o id do modelo da OpenAI vem do .env. */
  llmModel: process.env.LLM_MODEL ?? "",
  /** reasoning_effort da OpenAI; vazio = padrão do modelo. */
  llmRaciocinio: process.env.LLM_REASONING ?? "",
  /** chat = /v1/chat/completions (validada nos evals) | responses = /v1/responses (raciocínio + ferramentas). */
  llmApi: process.env.LLM_API ?? "chat",
  assistantName: process.env.ASSISTANT_NAME ?? "Lia",
  storeName: process.env.STORE_NAME ?? "Presentes Especiais",

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
    maxEsperaRetryMs: int(process.env.BRINDEME_MAX_ESPERA_RETRY_MS, 10_000),
    /** Orçamentos TESTE da escrita simulada (removida em 25/10, R5): o arquivo antigo ainda passa pelo limpar:dados. */
    orcamentosTesteArquivo: process.env.ORCAMENTOS_TESTE_ARQUIVO ?? "data/orcamentos-teste.json",
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
    maxIdadeHoras: int(process.env.CATALOGO_MAX_IDADE_HORAS, 24),
    /** Ritmo do sync: metade da cota da API (60/min), a outra metade fica para as conversas. */
    reqPorMinuto: int(process.env.CATALOGO_REQ_POR_MINUTO, 30),
  },

  agente: {
    porta: int(process.env.AGENTE_PORTA, 3030),
    url: (process.env.AGENTE_URL ?? "http://127.0.0.1:3030").replace(/\/+$/, ""),
    conversasDir: process.env.CONVERSAS_DIR ?? "data/conversas",
    /** Precisa ficar FOLGA_PRAZOS_MS abaixo de AGENTE_TIMEOUT_MS da ponte (120s): ver conferirPrazos. */
    tetoMs: int(process.env.TURNO_TETO_MS, 90_000),
    respostasPorHora: int(process.env.RESPOSTAS_POR_HORA, 30),
    /** Ferramentas desligadas no startup (requer restart para mudar; use #desligar para runtime). */
    ferramentasDesligadas: (process.env.FERRAMENTAS_DESLIGADAS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  whatsapp: {
    sessaoDir: process.env.WHATSAPP_SESSAO_DIR ?? "data/whatsapp-sessao",
    estadoArquivo: process.env.PONTE_ESTADO_ARQUIVO ?? "data/ponte-estado.json",
    parearTelefone: (process.env.WHATSAPP_PAREAR_TELEFONE ?? "").replace(/\D/g, ""),
    versaoWeb: process.env.WHATSAPP_WEB_VERSAO ?? "",
    liberados: digitos(process.env.WHATSAPP_LIBERADOS),
    artesDir: process.env.ARTES_DIR ?? "data/artes",
    loteSilencioMs: int(process.env.LOTE_SILENCIO_MS, 5_000),
    loteMaxMs: int(process.env.LOTE_MAX_MS, 30_000),
    /** O contrato aceita no máximo 10 mensagens por lote. */
    loteMaxMensagens: Math.min(10, int(process.env.LOTE_MAX_MENSAGENS, 10)),
    agenteTimeoutMs: int(process.env.AGENTE_TIMEOUT_MS, 120_000),
    avisoInstabilidadeMin: int(process.env.AVISO_INSTABILIDADE_MIN, 10),
    enviosPorMinuto: int(process.env.ENVIOS_POR_MINUTO, 20),
    varreduraMs: int(process.env.VARREDURA_MS, 120_000),
  },
};
