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

/**
 * Estimativa que o cliente confirma e o atendente emite (requisito R5 da loja: o agente estima, quem emite
 * é pessoa). Fica no estado até a transferência com motivo orcamento_para_emitir.
 */
export interface FichaPedido {
  /**
   * Última mensagem do cliente quando o resumo foi gerado (hash do texto, ver marcaUltimaMensagemCliente).
   * A transferência só vale depois de uma mensagem nova do cliente: a confirmação.
   */
  mensagemDoResumo: string;
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
    prazo_desejado?: string;
    personalizacao?: string;
    observacoes?: string;
    arte_refs: string[];
  };
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
    /** Nome de perfil do WhatsApp, já limpo (ver limparNomeWhatsapp). É o "Olá, Fulano" da abertura. */
    nomeWhatsapp?: string;
    empresa?: string;
  };
  /**
   * Memória contextual: o que o cliente contou e precisa ser lembrado mesmo depois que a mensagem
   * sai da janela de histórico mandada ao modelo. Preenchida por registrar_contexto.
   */
  memoria?: {
    fatos: string[];
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
  /** A última lista de buscar_produtos, na ordem mostrada: é a que "a primeira opção" aponta. */
  ultimasOpcoes?: Array<{ id: string; nome: string }>;
  /** Os últimos de detalhar_produto, o mais recente primeiro: sem isto o subproduto_id da cor some no turno seguinte. */
  produtosDetalhados?: Array<{ id: string; nome: string; cores: Array<{ subproduto_id: string; cor: string }> }>;
  /**
   * subproduto_id → produto_id. GET /product (listagem) não traz subprodutos,
   * então só dá para resolver um subproduto via GET /product/{id}. O mapa é
   * preenchido por buscar_produtos e detalhar_produto.
   */
  subprodutoParaProduto: Record<string, string>;
  artes: ArteRegistrada[];
  /** Arquivos que chegaram pelo WhatsApp (gravados pela ponte). Ausente em estados salvos antes da Fase 4. */
  arquivosRecebidos?: ArquivoRecebido[];
  fichaPedido?: FichaPedido;
  /**
   * A estimativa que o cliente confirmou e foi para a equipe emitir. fichaPedido some na transferência;
   * isto fica: é o registro de que a triagem terminou (o CRM qualifica o lead como quente por ele).
   */
  orcamentoEnviado?: FichaPedido["resumo"] & { enviado_em: string };
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

/**
 * Nome de perfil do WhatsApp em condição de virar "Olá, Fulano": sem emoji nem símbolo,
 * espaços colapsados. Perfil só com número, ponto ou emoji não é nome: undefined.
 */
export function limparNomeWhatsapp(nome: string | undefined): string | undefined {
  if (!nome) return undefined;
  const limpo = nome
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\s'.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return /\p{L}{2,}/u.test(limpo) ? limpo : undefined;
}
