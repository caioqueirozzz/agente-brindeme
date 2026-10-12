/**
 * Erros da API da loja, compartilhados por MockBrindeMeClient e HttpBrindeMeClient.
 * Vive fora do mock porque as tools dependem do tradutor em produção também.
 */

import { CircuitOpenError } from "./circuitBreaker.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: object
  ) {
    super(`HTTP ${status}`);
    this.name = "ApiError";
  }
}

/** Erro de rede/transporte — sem resposta HTTP (DNS, conexão recusada, abort por timeout). */
export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

export interface FalhaApi {
  /** Marcador explícito: distingue falha de infraestrutura de erro de negócio. */
  falha_api: true;
  erro: string;
  tentar_novamente: boolean;
  detalhes?: string;
  /**
   * Transferir sem esperar a segunda falha. Vem da tabela de tratamento de
   * falhas da Fase 2: 401/403 e 412 vão direto para o atendente.
   */
  transferir_imediato?: boolean;
  /** Exige alerta operacional (Fase 5), não só log. */
  alerta?: boolean;
}

export function translateApiError(err: unknown): FalhaApi {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
      case 403:
        // Chave inválida/revogada: alerta imediato e ferramentas desativadas.
        return {
          falha_api: true,
          erro: "acesso_negado",
          tentar_novamente: false,
          transferir_imediato: true,
          alerta: true,
        };
      case 404:
        return { falha_api: true, erro: "nao_encontrado", tentar_novamente: false };
      case 408:
        return { falha_api: true, erro: "timeout", tentar_novamente: true };
      case 412:
        // Descoberto em 12/10/2026 sondando a API: 412 é falha de VALIDAÇÃO DE
        // PARÂMETRO de query (per_page não-inteiro, order_param inválido...),
        // não precondição HTTP. Ou seja, é bug do nosso lado — a mensagem vem
        // em português e pronta para log. Alerta porque exige correção de código.
        return {
          falha_api: true,
          erro: "parametro_invalido",
          tentar_novamente: false,
          transferir_imediato: true,
          alerta: true,
          detalhes: JSON.stringify(err.body).slice(0, 500),
        };
      case 422:
        return {
          falha_api: true,
          erro: "dados_invalidos",
          tentar_novamente: false,
          detalhes: JSON.stringify((err.body as { errors?: unknown }).errors),
        };
      case 429:
        return { falha_api: true, erro: "limite_excedido", tentar_novamente: true };
      case 500:
      case 502:
      case 503:
      case 504:
        return { falha_api: true, erro: "instabilidade", tentar_novamente: true };
      default:
        return { falha_api: true, erro: "erro_desconhecido", tentar_novamente: true };
    }
  }
  if (err instanceof CircuitOpenError) {
    return {
      falha_api: true,
      erro: "servico_indisponivel",
      tentar_novamente: false,
      transferir_imediato: true,
      detalhes: `Disjuntor aberto; reabre em ${Math.ceil(err.reabreEmMs / 1000)}s`,
    };
  }
  if (err instanceof NetworkError) {
    return { falha_api: true, erro: "indisponivel", tentar_novamente: true };
  }
  if (err instanceof Error && err.message.toLowerCase().includes("timeout")) {
    return { falha_api: true, erro: "timeout", tentar_novamente: true };
  }
  return { falha_api: true, erro: "erro_desconhecido", tentar_novamente: true };
}

/** True quando a falha pede transferência sem esperar a segunda ocorrência. */
export function exigeTransferenciaImediata(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const erro = (output as { erro?: unknown }).erro;
  return (
    !!erro && typeof erro === "object" && (erro as FalhaApi).transferir_imediato === true
  );
}

/** True quando o retorno de uma tool carrega uma falha de infraestrutura (não de negócio). */
export function isFalhaApi(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const erro = (output as { erro?: unknown }).erro;
  return !!erro && typeof erro === "object" && (erro as FalhaApi).falha_api === true;
}
