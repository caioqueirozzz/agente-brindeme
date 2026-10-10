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

export interface OrcamentoPendente {
  token: string;
  expiraEm: string;
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
  cliente: {
    tipo?: "PF" | "PJ";
    nome?: string;
    email?: string;
  };
  necessidade: {
    ocasiao?: string;
    quantidade?: number;
    precoMaxUnitario?: number;
    dataLimite?: string;
  };
  produtosDiscutidos: string[];
  artes: ArteRegistrada[];
  orcamentoPendente?: OrcamentoPendente;
  orcamentos: string[];
  falhasConsecutivas: number;
  falhasValidacaoPedido: number;
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
    artes: [],
    orcamentos: [],
    falhasConsecutivas: 0,
    falhasValidacaoPedido: 0,
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
