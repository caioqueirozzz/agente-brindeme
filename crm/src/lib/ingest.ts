import { createHash } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { autoAssignLead, logEvent, notify } from "@/lib/leads";
import type { LeadQualification, QualificationStatus } from "@/lib/types";

/*
 * Converte a conversa gravada pelo agente (data/conversas/<telefone>.json,
 * formato `Conversa` de src/conversas/repositorio.ts) em lead do CRM.
 * Idempotente: rodar de novo com o mesmo arquivo não duplica mensagens.
 */

interface FichaResumo {
  tipo?: "PF" | "PJ";
  nome?: string;
  email?: string;
  itens?: Array<{ nome_produto: string; cor?: string; quantidade: number; preco_unitario?: number; subtotal?: number }>;
  total_estimado?: number;
  prazo_desejado?: string;
  personalizacao?: string;
}

export interface AgentState {
  conversaId?: string;
  telefone: string;
  modo?: "ia" | "humano";
  cliente?: { tipo?: "PF" | "PJ"; nome?: string; email?: string; nomeWhatsapp?: string; empresa?: string };
  necessidade?: {
    ocasiao?: string;
    quantidade?: number;
    precoMaxUnitario?: number;
    orcamentoTotal?: number;
    dataLimite?: string;
  };
  produtosDiscutidos?: string[];
  artes?: unknown[];
  fichaPedido?: { resumo?: FichaResumo };
  /** Estimativa confirmada e transferida para a equipe. A fichaPedido some na transferência; esta fica. */
  orcamentoEnviado?: FichaResumo & { enviado_em?: string };
  memoria?: { fatos?: string[] };
  historico?: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>;
}

export interface AgentConversation {
  estado: AgentState;
  transferenciaPendente?: { resumo?: { motivo?: string; observacao?: string } };
}

export interface Scoring {
  score: number;
  status: QualificationStatus;
  summary: string | null;
  qualification: LeadQualification;
  estimatedValue: number | null;
}

/** Lead em triagem que não responde a Lia há este tempo esfria. */
export const HORAS_PARA_ESFRIAR = 24;

// Faixas de lead_score (as mesmas de leadTemperature): frio < 40 ≤ morno < 70 ≤ quente
const FAIXA = { frio: 10, morno: 40, quente: 70 } as const;
const LARGURA = { frio: 29, morno: 29, quente: 30 } as const;
export const MORNO_MIN = FAIXA.morno;
export const QUENTE_MIN = FAIXA.quente;
/** Quanto o lead desce ao esfriar (e sobe ao reaquecer): mantém o ponto dentro da faixa. */
export const ESFRIAMENTO = FAIXA.morno - FAIXA.frio;

/**
 * Régua da Presentes. A temperatura diz em que pé está o lead; o ponto dentro da faixa,
 * quanto do pedido a Lia já apurou.
 * - quente: terminou a triagem e foi para orçamento (estimativa confirmada) — confirmou interesse;
 * - morno: em triagem e respondendo;
 * - frio: parou de responder (a Lia falou por último há mais de HORAS_PARA_ESFRIAR) ou nunca respondeu.
 * Quem já esquentou não esfria pelo silêncio: a partir daí o lead é da equipe comercial.
 */
export function scoreConversation(state: AgentState, now = Date.now()): Scoring {
  const n = state.necessidade ?? {};
  const c = state.cliente ?? {};
  const ficha = state.fichaPedido?.resumo ?? state.orcamentoEnviado;
  const produtos = state.produtosDiscutidos ?? [];
  const historico = state.historico ?? [];
  const msgsCliente = historico.filter((m) => m.role === "user").length;

  // Completude do que foi apurado, de 0 a 1
  let pontos = 0;
  if (c.nome) pontos += 8;
  if (c.email) pontos += 5;
  if (c.tipo ?? ficha?.tipo) pontos += 10;
  if (n.ocasiao) pontos += 8;
  if (n.quantidade) pontos += 10 + (n.quantidade >= 100 ? 5 : 0) + (n.quantidade >= 500 ? 5 : 0);
  if (n.orcamentoTotal || n.precoMaxUnitario) pontos += 8;
  if (n.dataLimite || ficha?.prazo_desejado) pontos += 8;
  if (produtos.length > 0 || ficha?.itens?.length) pontos += 8;
  if ((state.artes ?? []).length > 0) pontos += 6;
  if (msgsCliente >= 4) pontos += 4;
  const completude = Math.min(1, pontos / 80);

  const ultima = historico[historico.length - 1];
  const parado =
    ultima?.role === "assistant" && now - Date.parse(ultima.timestamp) >= HORAS_PARA_ESFRIAR * 3_600_000;
  const temperatura = ficha ? "quente" : msgsCliente === 0 || parado ? "frio" : "morno";
  const score = FAIXA[temperatura] + Math.round(completude * LARGURA[temperatura]);

  const total = ficha?.total_estimado ?? (n.orcamentoTotal || (n.quantidade && n.precoMaxUnitario ? n.quantidade * n.precoMaxUnitario : null));

  const qualification: LeadQualification = {
    ocasiao: n.ocasiao ?? null,
    quantidade: n.quantidade ?? null,
    preco_max_unitario: n.precoMaxUnitario ?? null,
    orcamento_total: n.orcamentoTotal ?? null,
    data_limite: n.dataLimite ?? ficha?.prazo_desejado ?? null,
    produtos,
    itens: ficha?.itens?.map((i) => ({
      nome_produto: i.nome_produto,
      cor: i.cor,
      quantidade: i.quantidade,
      preco_unitario: i.preco_unitario,
      subtotal: i.subtotal,
    })),
    total_estimado: ficha?.total_estimado ?? null,
    personalizacao: ficha?.personalizacao ?? null,
    artes: (state.artes ?? []).length,
  };

  const status: QualificationStatus = ficha ? "QUALIFIED" : msgsCliente > 0 ? "IN_PROGRESS" : "NONE";

  const parts: string[] = [];
  if (n.quantidade) parts.push(`${n.quantidade} un.`);
  if (n.ocasiao) parts.push(n.ocasiao);
  if (produtos.length) parts.push(produtos.slice(0, 3).join(", "));
  if (n.dataLimite || ficha?.prazo_desejado) parts.push(`prazo ${n.dataLimite ?? ficha?.prazo_desejado}`);
  if (ficha?.total_estimado) parts.push(`estimativa ${ficha.total_estimado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);

  return {
    score,
    status,
    summary: parts.length ? parts.join(" · ") : null,
    qualification,
    estimatedValue: typeof total === "number" && total > 0 ? Math.round(total * 100) / 100 : null,
  };
}

/** Intervalo mínimo entre duas passadas de esfriamento (é chamado de várias leituras). */
const ESFRIAR_A_CADA_MS = 5 * 60_000;
const esfriamento = globalThis as unknown as { __crmUltimoEsfriamento?: number };

/**
 * Lead em triagem (morno) cujo cliente parou de responder vira frio. O sync só roda quando a
 * conversa muda, e silêncio não muda nada: por isso o tempo é conferido aqui, na leitura.
 * Sem cron: as telas que mostram temperatura chamam isto antes de ler (no máximo a cada 5 min).
 */
export async function esfriarLeadsParados(): Promise<void> {
  const agora = Date.now();
  if (agora - (esfriamento.__crmUltimoEsfriamento ?? 0) < ESFRIAR_A_CADA_MS) return;
  esfriamento.__crmUltimoEsfriamento = agora;
  await query(
    `UPDATE leads SET lead_score = lead_score - $3
     WHERE NOT score_locked AND qualification_status <> 'QUALIFIED' AND stage IN ('NOVO', 'ATENDIMENTO')
       AND lead_score >= $1 AND lead_score < $2
       AND last_message_from_client = false
       AND last_message_at < NOW() - make_interval(hours => $4)`,
    [MORNO_MIN, QUENTE_MIN, ESFRIAMENTO, HORAS_PARA_ESFRIAR]
  ).catch((err) => {
    esfriamento.__crmUltimoEsfriamento = 0;
    console.error("Falha ao esfriar leads parados", err);
  });
}

/** Motivos de src/tools/transferirHumano.ts do agente, em português para a equipe */
const TRANSFER_REASONS: Record<string, string> = {
  orcamento_para_emitir: "Estimativa confirmada: emitir o orçamento",
  pedido_cliente: "Cliente pediu para falar com uma pessoa",
  reclamacao: "Reclamação",
  desconto: "Pedido de desconto",
  pagamento: "Dúvida de pagamento",
  frete_prazo: "Frete ou prazo",
  ajuste_mockup: "Ajuste no mockup",
  falha_sistema: "Falha no sistema",
  nao_entendido: "A Lia não entendeu o pedido",
  arte_problematica: "Problema com a arte",
  lacuna_conhecimento: "Pergunta sem resposta na base",
  outro: "Outro motivo",
};

export function transferReason(motivo?: string, observacao?: string): string {
  const base = (motivo && TRANSFER_REASONS[motivo]) || motivo || "Transferido para atendimento humano";
  return observacao ? `${base} — ${observacao}` : base;
}

function digits(phone: string) {
  return phone.replace(/\D/g, "");
}

function messageId(role: string, timestamp: string, content: string) {
  return createHash("sha256").update(`${role}|${timestamp}|${content}`).digest("hex").slice(0, 32);
}

export interface IngestResult {
  leadId: string;
  created: boolean;
  newMessages: number;
  assignedTo: string | null;
}

export async function ingestConversation(conversation: AgentConversation): Promise<IngestResult> {
  const state = conversation.estado;
  const phone = digits(state.telefone ?? "");
  if (phone.length < 8) throw new Error("Conversa sem telefone válido.");

  const scoring = scoreConversation(state);
  const history = (state.historico ?? []).filter((m) => m.content?.trim());
  const last = history[history.length - 1];
  const transfer = conversation.transferenciaPendente?.resumo;
  const humanMode = state.modo === "humano";
  const ficha = state.fichaPedido?.resumo ?? state.orcamentoEnviado;
  const name = state.cliente?.nome ?? ficha?.nome ?? state.cliente?.nomeWhatsapp ?? null;

  const result = await transaction(async (tx) => {
    const [existing] = await tx.query<{
      id: string;
      score_locked: boolean;
      qualification_status: QualificationStatus;
      qualification_source: string | null;
      assigned_to: string | null;
      agent_mode: string;
      stage: string;
    }>("SELECT id, score_locked, qualification_status, qualification_source, assigned_to, agent_mode, stage FROM leads WHERE phone = $1 FOR UPDATE", [phone]);

    // Decisão manual do admin (qualificar/desqualificar) não é desfeita pelo sync, e lead que
    // terminou a triagem não volta a "em qualificação" (agentes antigos apagavam a ficha ao transferir)
    const manual = existing?.qualification_source === "MANUAL";
    const status = manual || existing?.qualification_status === "QUALIFIED" ? existing!.qualification_status : scoring.status;

    let leadId: string;
    if (!existing) {
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO leads (phone, name, email, customer_type, source, agent_conversation_id, qualification_status,
           qualification_source, lead_score, qualification, qualification_summary, qualified_at, estimated_value,
           agent_mode, needs_attention, attention_reason, stage, company)
         VALUES ($1,$2,$3,$4,'AGENTE',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [
          phone,
          name,
          state.cliente?.email ?? ficha?.email ?? null,
          state.cliente?.tipo ?? ficha?.tipo ?? null,
          state.conversaId ?? null,
          status,
          status === "QUALIFIED" ? "AGENTE" : null,
          scoring.score,
          JSON.stringify(scoring.qualification),
          scoring.summary,
          status === "QUALIFIED" ? new Date().toISOString() : null,
          scoring.estimatedValue,
          humanMode ? "humano" : "ia",
          humanMode,
          humanMode ? transferReason(transfer?.motivo, transfer?.observacao) : null,
          ficha ? "ORCAMENTO" : "NOVO",
          state.cliente?.empresa ?? null,
        ]
      );
      leadId = row.id;
      await logEvent(tx, leadId, null, "CRIADO", { origem: "agente" });
    } else {
      leadId = existing.id;
      await tx.query(
        `UPDATE leads SET
           name = COALESCE(name, $2), email = COALESCE(email, $3), customer_type = COALESCE(customer_type, $4),
           company = COALESCE(company, $14),
           agent_conversation_id = COALESCE($5, agent_conversation_id),
           qualification_status = $6,
           qualification_source = CASE WHEN qualification_source = 'MANUAL' THEN 'MANUAL' WHEN $6 = 'QUALIFIED' THEN 'AGENTE' ELSE qualification_source END,
           qualified_at = CASE WHEN $6 = 'QUALIFIED' AND qualified_at IS NULL THEN NOW() ELSE qualified_at END,
           -- Quente não regride: quem terminou a triagem ou já está com a equipe (orçamento em diante) segue quente
           lead_score = CASE
             WHEN score_locked THEN lead_score
             WHEN lead_score >= 70 OR stage IN ('ORCAMENTO', 'ARTE', 'NEGOCIACAO', 'GANHO') THEN GREATEST(lead_score, $7, 70)
             ELSE $7 END,
           qualification = $8, qualification_summary = $9,
           estimated_value = COALESCE($10, estimated_value),
           agent_mode = $11,
           needs_attention = CASE WHEN $11 = 'humano' AND agent_mode = 'ia' THEN true ELSE needs_attention END,
           attention_reason = CASE WHEN $11 = 'humano' AND agent_mode = 'ia' THEN $12 ELSE attention_reason END,
           stage = CASE WHEN $13 AND stage IN ('NOVO', 'ATENDIMENTO') THEN 'ORCAMENTO' ELSE stage END
         WHERE id = $1`,
        [
          leadId,
          name,
          state.cliente?.email ?? ficha?.email ?? null,
          state.cliente?.tipo ?? ficha?.tipo ?? null,
          state.conversaId ?? null,
          status,
          scoring.score,
          JSON.stringify(scoring.qualification),
          scoring.summary,
          scoring.estimatedValue,
          humanMode ? "humano" : "ia",
          transferReason(transfer?.motivo, transfer?.observacao),
          Boolean(ficha),
          state.cliente?.empresa ?? null,
        ]
      );
      if (status === "QUALIFIED" && existing.qualification_status !== "QUALIFIED") {
        await logEvent(tx, leadId, null, "QUALIFICACAO", { status, origem: "agente", score: scoring.score });
      }
    }

    // Mensagens novas (idempotente por hash). Se a ponte já manda a conversa ao vivo, o
    // histórico do arquivo é a mesma conversa com outros ids: não entra, para não duplicar.
    let newMessages = 0;
    let newFromClient = 0;
    const [live] = await tx.query("SELECT 1 FROM messages WHERE lead_id = $1 AND source = 'WHATSAPP' LIMIT 1", [leadId]);
    for (const m of live ? [] : history) {
      const inserted = await tx.query(
        `INSERT INTO messages (lead_id, external_id, author, body, sent_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (lead_id, external_id) DO NOTHING RETURNING id`,
        [leadId, messageId(m.role, m.timestamp, m.content), m.role === "user" ? "CLIENTE" : "AGENTE", m.content, m.timestamp]
      );
      if (inserted.length) {
        newMessages++;
        if (m.role === "user") newFromClient++;
      }
    }
    if (last && !live) {
      await tx.query(
        `UPDATE leads SET last_message_text = left($2, 200), last_message_at = $3, last_message_from_client = $4,
           unread_count = unread_count + $5
         WHERE id = $1 AND (last_message_at IS NULL OR last_message_at <= $3)`,
        [leadId, last.content, last.timestamp, last.role === "user", newFromClient]
      );
    }

    // Avisa os admins quando o agente transfere para uma pessoa
    if (humanMode && (!existing || existing.agent_mode === "ia")) {
      const admins = await tx.query<{ id: string }>("SELECT id FROM users WHERE role = 'ADMIN' AND is_active");
      for (const a of admins) {
        await notify(tx, a.id, "Lia transferiu uma conversa", `${name || phone}: ${transferReason(transfer?.motivo, transfer?.observacao)}`, `/admin/crm?lead=${leadId}`);
      }
    }

    return { leadId, created: !existing, newMessages, assignedTo: existing?.assigned_to ?? null };
  });

  if (!result.assignedTo) result.assignedTo = await autoAssignLead(result.leadId);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Mensagem ao vivo (ponte do WhatsApp → CRM)                         */
/* ------------------------------------------------------------------ */

export interface LiveMessage {
  id: string;
  telefone: string;
  autor: "CLIENTE" | "AGENTE" | "ATENDENTE";
  tipo?: string;
  texto: string;
  timestamp: string;
}

const KIND_LABEL: Record<string, string> = {
  midia: "📎 Arquivo enviado",
  audio: "🎤 Áudio",
  nao_suportada: "📎 Arquivo não suportado",
};

/**
 * Grava uma mensagem que a ponte acabou de ver. Idempotente pelo id do WhatsApp: o eco de uma
 * mensagem enviada pelo CRM chega com o mesmo id e não duplica. Lead novo nasce aqui.
 */
export async function ingestLiveMessage(m: LiveMessage): Promise<{ leadId: string; created: boolean; inserted: boolean }> {
  const phone = digits(m.telefone);
  if (phone.length < 8) throw new Error("Mensagem sem telefone válido.");
  const kind = m.tipo && m.tipo !== "texto" ? m.tipo : "texto";
  const body = m.texto?.trim() || KIND_LABEL[kind] || "Mensagem";
  const author = m.autor === "CLIENTE" ? "CLIENTE" : m.autor === "AGENTE" ? "AGENTE" : "COLABORADOR";
  const sentAt = Number.isNaN(Date.parse(m.timestamp)) ? new Date().toISOString() : m.timestamp;

  const result = await transaction(async (tx) => {
    const created = await tx.query<{ id: string }>(
      `INSERT INTO leads (phone, source, qualification_status) VALUES ($1, 'AGENTE', 'IN_PROGRESS')
       ON CONFLICT (phone) DO NOTHING RETURNING id`,
      [phone]
    );
    const [lead] = await tx.query<{ id: string; assigned_to: string | null; unread_count: number; agent_mode: string; name: string | null }>(
      "SELECT id, assigned_to, unread_count, agent_mode, name FROM leads WHERE phone = $1 FOR UPDATE",
      [phone]
    );
    if (created.length) await logEvent(tx, lead.id, null, "CRIADO", { origem: "whatsapp" });

    const inserted = await tx.query(
      `INSERT INTO messages (lead_id, external_id, author, body, sent_at, source, kind)
       VALUES ($1, $2, $3, $4, $5, 'WHATSAPP', $6) ON CONFLICT (lead_id, external_id) DO NOTHING RETURNING id`,
      [lead.id, m.id, author, body, sentAt, kind]
    );
    if (!inserted.length) return { leadId: lead.id, created: false, inserted: false, notifySeller: null as string | null };

    const fromClient = author === "CLIENTE";
    await tx.query(
      `UPDATE leads SET
         last_message_text = CASE WHEN last_message_at IS NULL OR last_message_at <= $3 THEN left($2, 200) ELSE last_message_text END,
         last_message_from_client = CASE WHEN last_message_at IS NULL OR last_message_at <= $3 THEN $4 ELSE last_message_from_client END,
         last_message_at = GREATEST(COALESCE(last_message_at, $3), $3),
         unread_count = CASE WHEN $4 THEN unread_count + 1 ELSE 0 END,
         -- Alguém da equipe escreveu (celular ou CRM): a IA pausa nesta conversa, como na ponte
         agent_mode = CASE WHEN $5 THEN 'humano' ELSE agent_mode END,
         -- Cliente em triagem respondeu: está conversando, então é no mínimo morno (frio volta a morno)
         lead_score = CASE
           WHEN $4 AND NOT score_locked AND stage IN ('NOVO', 'ATENDIMENTO') AND COALESCE(lead_score, 0) < $6
             THEN COALESCE(lead_score + $7, $6)
           ELSE lead_score END
       WHERE id = $1`,
      [lead.id, body, sentAt, fromClient, author === "COLABORADOR", MORNO_MIN, ESFRIAMENTO]
    );

    // Cliente escreveu numa conversa que está com uma pessoa: avisa o vendedor (uma vez por rodada de não lidas)
    const notifySeller = fromClient && lead.agent_mode === "humano" && lead.assigned_to && lead.unread_count === 0 ? lead.assigned_to : null;
    if (notifySeller) {
      await notify(tx, notifySeller, "Cliente respondeu", `${lead.name || phone}: ${body.slice(0, 120)}`, `/app/crm?lead=${lead.id}`);
    }
    return { leadId: lead.id, created: created.length > 0, inserted: true, notifySeller };
  });

  if (result.created) await autoAssignLead(result.leadId);
  return { leadId: result.leadId, created: result.created, inserted: result.inserted };
}
