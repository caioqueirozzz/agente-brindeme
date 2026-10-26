/**
 * Tradução de status da plataforma para a frase que o cliente vê.
 *
 * A spec não lista os valores possíveis de `status_id`/`status_name`, então
 * estes vieram de observação dos dados reais em 12/10/2026. **A lista completa
 * precisa ser confirmada com a loja** — por isso existe o fallback: um status
 * desconhecido nunca vira invenção, vira uma frase neutra.
 *
 * As frases ainda precisam de aprovação da loja (entregável da Fase 1).
 */

export interface StatusTraduzido {
  /** Frase para o cliente. */
  frase: string;
  /** true quando o status pede ação do cliente. */
  requer_acao_cliente?: boolean;
  /** true quando o assunto é melhor tratado por uma pessoa. */
  sugerir_atendente?: boolean;
}

const FALLBACK: StatusTraduzido = {
  frase: "Seu pedido está em andamento. Vou confirmar o status atual com a equipe.",
  sugerir_atendente: true,
};

/** Observados em GET /order (12/10/2026). */
export const STATUS_PEDIDO: Record<string, StatusTraduzido> = {
  aprovado: {
    frase: "Seu pedido foi aprovado e está na fila de produção.",
  },
};

/** Normaliza para comparar sem depender de acento, caixa ou espaço extra. */
export function chaveStatus(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function traduzir(
  tabela: Record<string, StatusTraduzido>,
  statusName: string | null | undefined
): StatusTraduzido & { conhecido: boolean; original: string } {
  const original = (statusName ?? "").trim();
  if (!original) return { ...FALLBACK, conhecido: false, original: "" };
  const achado = tabela[chaveStatus(original)];
  return achado
    ? { ...achado, conhecido: true, original }
    : { ...FALLBACK, conhecido: false, original };
}

export function traduzirStatusPedido(statusName?: string | null) {
  return traduzir(STATUS_PEDIDO, statusName);
}

/** Status vistos em produção mas ainda sem frase aprovada — alimenta a lista de lacunas. */
export function statusDesconhecidos(
  tabela: Record<string, StatusTraduzido>,
  nomes: Array<string | null | undefined>
): string[] {
  const faltando = new Set<string>();
  for (const n of nomes) {
    const original = (n ?? "").trim();
    if (original && !tabela[chaveStatus(original)]) faltando.add(original);
  }
  return [...faltando];
}
