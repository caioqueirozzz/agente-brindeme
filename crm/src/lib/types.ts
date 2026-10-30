/*
 * Tipos e réguas compartilhados entre servidor e navegador (sem imports de servidor).
 */

export type Role = "ADMIN" | "COLABORADOR";
export type QualificationStatus = "NONE" | "IN_PROGRESS" | "QUALIFIED" | "DISQUALIFIED";
export type Stage = "NOVO" | "ATENDIMENTO" | "ORCAMENTO" | "ARTE" | "NEGOCIACAO" | "GANHO" | "PERDIDO";
export type LeadTemperature = "quente" | "morno" | "frio";
export type MessageAuthor = "CLIENTE" | "AGENTE" | "COLABORADOR";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  jobTitle: string | null;
  mustChangePassword: boolean;
}

/** O que o agente Lia apurou na conversa (leads.qualification) */
export interface LeadQualification {
  ocasiao?: string | null;
  quantidade?: number | null;
  preco_max_unitario?: number | null;
  orcamento_total?: number | null;
  data_limite?: string | null;
  produtos?: string[];
  itens?: Array<{ nome_produto: string; cor?: string; quantidade: number; preco_unitario?: number; subtotal?: number }>;
  total_estimado?: number | null;
  personalizacao?: string | null;
  artes?: number;
  motivo_transferencia?: string | null;
}

export interface Lead {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  customer_type: "PF" | "PJ" | null;
  source: "AGENTE" | "MANUAL";
  assigned_to: string | null;
  assigned_name: string | null;
  assigned_at: string | null;
  qualification_status: QualificationStatus;
  qualification_source: "AGENTE" | "MANUAL" | null;
  lead_score: number | null;
  qualification: LeadQualification;
  qualification_summary: string | null;
  disqualification_reason: string | null;
  qualified_at: string | null;
  stage: Stage;
  estimated_value: number | null;
  won_value: number | null;
  won_at: string | null;
  lost_reason: string | null;
  next_action: string | null;
  next_action_at: string | null;
  agent_mode: "ia" | "humano";
  needs_attention: boolean;
  attention_reason: string | null;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string | null;
  last_message_from_client: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  author: MessageAuthor;
  sent_by_name: string | null;
  body: string;
  sent_at: string;
  /** texto | midia | audio | nao_suportada */
  kind?: string;
}

export interface LeadEvent {
  id: string;
  type: string;
  user_name: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface TeamMember {
  id: string;
  name: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Réguas                                                             */
/* ------------------------------------------------------------------ */

/** Mesma régua do dcimob */
export function leadTemperature(score: number | null | undefined): LeadTemperature | null {
  if (score === null || score === undefined) return null;
  if (score >= 70) return "quente";
  if (score >= 40) return "morno";
  return "frio";
}

export const TEMPERATURE_STYLES: Record<LeadTemperature, { label: string; className: string; icon: string }> = {
  quente: { label: "Quente", className: "bg-red-50 text-red-700 border-red-200", icon: "local_fire_department" },
  morno: { label: "Morno", className: "bg-amber-50 text-amber-800 border-amber-200", icon: "device_thermostat" },
  frio: { label: "Frio", className: "bg-sky-50 text-sky-800 border-sky-200", icon: "ac_unit" },
};

export const QUALIFICATION_LABELS: Record<QualificationStatus, string> = {
  NONE: "Sem qualificação",
  IN_PROGRESS: "Em qualificação",
  QUALIFIED: "Qualificado",
  DISQUALIFIED: "Desqualificado",
};

export const STAGES: { value: Stage; label: string; icon: string }[] = [
  { value: "NOVO", label: "Novo contato", icon: "fiber_new" },
  { value: "ATENDIMENTO", label: "Em atendimento", icon: "support_agent" },
  { value: "ORCAMENTO", label: "Orçamento enviado", icon: "request_quote" },
  { value: "ARTE", label: "Arte / aprovação", icon: "palette" },
  { value: "NEGOCIACAO", label: "Negociação", icon: "handshake" },
  { value: "GANHO", label: "Pedido fechado", icon: "verified" },
  { value: "PERDIDO", label: "Perdido", icon: "block" },
];

export const STAGE_LABELS = Object.fromEntries(STAGES.map((s) => [s.value, s.label])) as Record<Stage, string>;
export const OPEN_STAGES: Stage[] = ["NOVO", "ATENDIMENTO", "ORCAMENTO", "ARTE", "NEGOCIACAO"];

/** Qualificado e sem vendedor: a fila que o admin precisa esvaziar */
export function isAwaitingSeller(lead: Pick<Lead, "qualification_status" | "assigned_to">): boolean {
  return lead.qualification_status === "QUALIFIED" && !lead.assigned_to;
}

/* ------------------------------------------------------------------ */
/*  Formatação                                                         */
/* ------------------------------------------------------------------ */

export function formatMoney(value: number | null | undefined, compact = false): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (compact) {
    if (Math.abs(value) >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
    if (Math.abs(value) >= 10_000) return `R$ ${Math.round(value / 1_000)}K`;
  }
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: value >= 1000 ? 0 : 2 });
}

/** 5583999998888 → (83) 99999-8888 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const local = d.slice(4);
    return `(${d.slice(2, 4)}) ${local.slice(0, local.length - 4)}-${local.slice(-4)}`;
  }
  return d ? `+${d}` : "";
}

export function leadDisplayName(lead: Pick<Lead, "name" | "phone">): string {
  return lead.name?.trim() || formatPhone(lead.phone) || "Contato sem nome";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
