import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";

export interface Mensagem {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ArteRegistrada {
  ref: string;
  arquivo: string;
  posicao?: string;
  cores?: string;
}

export interface ArquivoRecebido {
  nome: string;
  caminho: string;
  mime: string;
  bytes: number;
}

export interface OrcamentoPendente {
  token: string;
  expiraEm: string;
  /**
   * Última mensagem do cliente quando o resumo foi gerado (hash do texto, ver marcaUltimaMensagemCliente).
   * criar_orcamento só vale depois de uma mensagem nova do cliente: a confirmação.
   * Ausente em pendências salvas antes da Fase 6.
   */
  mensagemDoResumo?: string;
  resumo: {
    tipo: "PF" | "PJ";
    nome: string;
    email: string;
    telefone: string;
    itens: Array<{
      subproduto_id: string;
      cor: string;
      nome_produto: string;
      quantidade: number;
      preco_unitario: number;
      subtotal: number;
    }>;
    total_estimado: number;
    observacoes?: string;
    arte_refs: string[];
  };
  body: import("../integrations/brindeme/types.js").CreateBudgetBody;
}

export interface ConversationState {
  conversaId: string;
  telefone: string;
  modo: "ia" | "humano";
  /** "whatsapp": arte só a partir de arquivo que chegou de verdade. Ausente no CLI e nos evals locais. */
  canal?: "whatsapp";
  cliente: {
    tipo?: "PF" | "PJ";
    nome?: string;
    email?: string;
  };
  necessidade: {
    ocasiao?: string;
    quantidade?: number;
    precoMaxUnitario?: number;
    /** Valor total que o cliente quer gastar (reais). */
    orcamentoTotal?: number;
    dataLimite?: string;
  };
  produtosDiscutidos: string[];
  /**
   * subproduto_id → produto_id. GET /product (listagem) não traz subprodutos,
   * então só dá para resolver um subproduto via GET /product/{id}. O mapa é
   * preenchido por buscar_produtos e detalhar_produto.
   */
  subprodutoParaProduto: Record<string, string>;
  artes: ArteRegistrada[];
  /** Arquivos que chegaram pelo WhatsApp (gravados pela ponte). Ausente em estados salvos antes da Fase 4. */
  arquivosRecebidos?: ArquivoRecebido[];
  orcamentoPendente?: OrcamentoPendente;
  orcamentos: string[];
  /**
   * código do orçamento → UUID. GET /budget/{id} só aceita o UUID, mas o
   * cliente (e o modelo) só conhecem o código. Guardado na criação.
   */
  orcamentoIds: Record<string, string>;
  /** token de confirmação → código do orçamento criado. Garante idempotência sem depender da implementação do client. */
  orcamentoTokens: Record<string, string>;
  falhasConsecutivas: number;
  falhasValidacaoPedido: number;
  /** Consultas de pedido nesta conversa — teto contra varredura de códigos. */
  consultasPedido: number;
  historico: Mensagem[];
}

export function createInitialState(telefone: string): ConversationState {
  return {
    conversaId: uuidv4(),
    telefone,
    modo: "ia",
    cliente: {},
    necessidade: {},
    produtosDiscutidos: [],
    subprodutoParaProduto: {},
    artes: [],
    arquivosRecebidos: [],
    orcamentos: [],
    orcamentoIds: {},
    orcamentoTokens: {},
    falhasConsecutivas: 0,
    falhasValidacaoPedido: 0,
    consultasPedido: 0,
    historico: [],
  };
}

export function addMessage(
  state: ConversationState,
  role: "user" | "assistant",
  content: string
): void {
  state.historico.push({ role, content, timestamp: new Date().toISOString() });
}

/**
 * Identifica a última mensagem do cliente no histórico (ou "" se ainda não houver) pelo CONTEÚDO.
 * Pelo timestamp não serve: o lote que falha e a ponte reenvia volta ao histórico com hora nova,
 * e a nova tentativa passaria por confirmação sem o cliente ter visto o resumo.
 * Efeito colateral aceito: confirmar com o mesmo texto exato da mensagem do resumo pede a confirmação de novo.
 */
export function marcaUltimaMensagemCliente(state: ConversationState): string {
  const m = [...state.historico].reverse().find((x) => x.role === "user");
  return m ? createHash("sha256").update(m.content.trim()).digest("hex").slice(0, 16) : "";
}

export function isTokenValid(state: ConversationState): boolean {
  if (!state.orcamentoPendente) return false;
  return new Date() < new Date(state.orcamentoPendente.expiraEm);
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function phoneMatches(phone1: string, phone2: string): boolean {
  const a = normalizePhone(phone1);
  const b = normalizePhone(phone2);
  if (a === b) return true;
  // compare with/without country code 55
  const strip55 = (p: string) => (p.startsWith("55") && p.length > 11 ? p.slice(2) : p);
  return strip55(a) === strip55(b);
}
