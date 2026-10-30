/*
 * Quadro de Pedidos: a sequência da operação depois da venda. Este arquivo não
 * acessa o banco: é usado pela tela, pelas rotas e pela integração com a Lia.
 */

export type OrderStage = "CONFIRMADO" | "ARTE" | "PRODUCAO" | "PERSONALIZACAO" | "CONFERENCIA" | "EXPEDICAO" | "ENTREGUE";

export interface OrderStageInfo {
  value: OrderStage;
  label: string;
  icon: string;
  /** Como a Lia explica a etapa ao cliente */
  client: string;
}

export const ORDER_STAGES: OrderStageInfo[] = [
  { value: "CONFIRMADO", label: "Pedido confirmado", icon: "task_alt", client: "Pedido confirmado e na fila da operação." },
  { value: "ARTE", label: "Arte e mockup", icon: "palette", client: "A equipe está preparando a arte e o mockup para a sua aprovação." },
  { value: "PRODUCAO", label: "Em produção", icon: "precision_manufacturing", client: "Os produtos estão em produção." },
  { value: "PERSONALIZACAO", label: "Personalização", icon: "brush", client: "Os produtos estão sendo personalizados com a sua arte." },
  { value: "CONFERENCIA", label: "Conferência e embalagem", icon: "inventory_2", client: "O pedido está na conferência de qualidade e sendo embalado." },
  { value: "EXPEDICAO", label: "Enviado / pronto para retirada", icon: "local_shipping", client: "O pedido já saiu para entrega ou está pronto para retirada." },
  { value: "ENTREGUE", label: "Entregue", icon: "verified", client: "O pedido foi entregue." },
];

export const ORDER_STAGE_LABELS = Object.fromEntries(ORDER_STAGES.map((s) => [s.value, s.label])) as Record<OrderStage, string>;
export const isOrderStage = (v: unknown): v is OrderStage => ORDER_STAGES.some((s) => s.value === v);

export interface Order {
  id: string;
  code: string;
  lead_id: string | null;
  phone: string;
  customer_name: string | null;
  title: string;
  stage: OrderStage;
  due_date: string | null;
  client_note: string | null;
  internal_note: string | null;
  stage_changed_at: string;
  /** Cliente perguntou pela Lia com o pedido atrasado: a equipe foi avisada e o card mostra "*" */
  late_alert_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Colunas do pedido para SELECT (alias "o"). A data sai como texto: DATE viraria Date com fuso no driver. */
export const ORDER_COLUMNS = `o.id, o.code, o.lead_id, o.phone, o.customer_name, o.title, o.stage,
  to_char(o.due_date, 'YYYY-MM-DD') AS due_date, o.client_note, o.internal_note,
  o.stage_changed_at, o.late_alert_at, o.created_at, o.updated_at`;

export interface OrderEvent {
  id: string;
  from_stage: OrderStage | null;
  to_stage: OrderStage;
  user_name: string | null;
  created_at: string;
}

/**
 * Telefone no formato da ponte do WhatsApp (55 + DDD + nono dígito), para o pedido
 * cadastrado à mão bater com o número que escreve para a Lia.
 */
export function normalizeOrderPhone(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12 || d.length > 13) return null;
  if (d.startsWith("55") && d.length === 12 && /[6-9]/.test(d.charAt(4))) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

/** Variantes do mesmo número (com e sem o nono dígito): pedidos antigos podem ter sido gravados sem ele. */
export function phoneVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, "");
  const variants = new Set([d]);
  if (d.startsWith("55") && d.length === 13 && d.charAt(4) === "9") variants.add(`${d.slice(0, 4)}${d.slice(5)}`);
  if (d.startsWith("55") && d.length === 12) variants.add(`${d.slice(0, 4)}9${d.slice(4)}`);
  return [...variants];
}

/** Texto opcional vindo do formulário: aparado, cortado e vazio vira null. */
export function orderText(v: unknown, max: number): string | null {
  return typeof v === "string" ? v.trim().slice(0, max) || null : null;
}

/** Data AAAA-MM-DD do formulário. null limpa; undefined é inválida. */
export function orderDate(v: unknown): string | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) return undefined;
  return v;
}

/**
 * Prazo que o cliente pediu ao agente ("12/12", "12/12/2026", "2026-12-12") como AAAA-MM-DD,
 * para virar a previsão sugerida do pedido. Texto livre ("até o Natal") não vira data.
 */
export function suggestedDueDate(text: string | null | undefined, now = new Date()): string {
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!br) return "";
  const day = Number(br[1]);
  const month = Number(br[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return "";
  let year = br[3] ? Number(br[3].length === 2 ? `20${br[3]}` : br[3]) : now.getFullYear();
  // Sem ano e já passou: é do ano que vem
  if (!br[3] && new Date(year, month - 1, day) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) year++;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Descrição sugerida do pedido a partir dos itens da estimativa da Lia. */
export function suggestedOrderTitle(items: Array<{ nome_produto: string; cor?: string; quantidade: number }> | undefined, fallback: string | null): string {
  if (items?.length) return items.map((i) => `${i.quantidade} × ${i.nome_produto}${i.cor ? ` (${i.cor})` : ""}`).join(", ").slice(0, 200);
  return (fallback ?? "").slice(0, 200);
}
