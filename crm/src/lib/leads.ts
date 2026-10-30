import { one, query, transaction } from "@/lib/db";
import type { Executor } from "@/lib/db";
import { leadDisplayName } from "@/lib/types";

/*
 * Operações de escrita sobre leads. Quem chama já conferiu a permissão
 * (rotas em src/app/api); aqui ficam as regras de negócio.
 */

export async function logEvent(
  db: Executor,
  leadId: string,
  userId: string | null,
  type: string,
  data: Record<string, unknown> = {}
) {
  await db.query("INSERT INTO lead_events (lead_id, user_id, type, data) VALUES ($1, $2, $3, $4)", [
    leadId,
    userId,
    type,
    JSON.stringify(data),
  ]);
}

export async function notify(db: Executor, userId: string, title: string, message: string, link: string | null) {
  await db.query("INSERT INTO notifications (user_id, title, message, link) VALUES ($1, $2, $3, $4)", [
    userId,
    title,
    message,
    link,
  ]);
}

/**
 * Atribui o lead a um colaborador (ou devolve à fila com `sellerId = null`).
 * O colaborador precisa estar ativo. Notifica quem recebeu.
 */
export async function assignLead(leadId: string, sellerId: string | null, byUserId: string | null): Promise<void> {
  await transaction(async (tx) => {
    const [lead] = await tx.query<{ id: string; name: string | null; phone: string; assigned_to: string | null }>(
      "SELECT id, name, phone, assigned_to FROM leads WHERE id = $1 FOR UPDATE",
      [leadId]
    );
    if (!lead) throw new LeadError("Lead não encontrado.");
    if (lead.assigned_to === sellerId) return;

    if (sellerId) {
      const [seller] = await tx.query<{ id: string; name: string; role: string }>(
        "SELECT id, name, role FROM users WHERE id = $1 AND is_active",
        [sellerId]
      );
      if (!seller) throw new LeadError("Colaborador inválido ou inativo.");
      await tx.query(
        "UPDATE leads SET assigned_to = $2, assigned_at = NOW(), stage = CASE WHEN stage = 'NOVO' THEN 'ATENDIMENTO' ELSE stage END WHERE id = $1",
        [leadId, sellerId]
      );
      await logEvent(tx, leadId, byUserId, "ATRIBUICAO", { para: seller.name, para_id: seller.id, automatica: !byUserId });
      await notify(
        tx,
        sellerId,
        "Novo lead para você",
        `${leadDisplayName(lead)} foi atribuído a você.`,
        `${seller.role === "ADMIN" ? "/admin" : "/app"}/crm?lead=${leadId}`
      );
    } else {
      await tx.query("UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE id = $1", [leadId]);
      await logEvent(tx, leadId, byUserId, "ATRIBUICAO", { para: null });
    }
  });
}

/**
 * Rodízio: entrega o lead ao próximo colaborador que recebe leads.
 * Devolve o id escolhido, ou null (modo manual, lead já atribuído, sem colaboradores).
 */
export async function autoAssignLead(leadId: string): Promise<string | null> {
  const chosen = await transaction(async (tx) => {
    // O lock na linha de configuração serializa o rodízio
    const [settings] = await tx.query<{
      distribution_mode: string;
      distribute_only_qualified: boolean;
      last_assigned_user_id: string | null;
    }>("SELECT * FROM crm_settings WHERE id FOR UPDATE");
    if (!settings || settings.distribution_mode !== "ROUND_ROBIN") return null;

    const [lead] = await tx.query<{ assigned_to: string | null; qualification_status: string }>(
      "SELECT assigned_to, qualification_status FROM leads WHERE id = $1",
      [leadId]
    );
    if (!lead || lead.assigned_to) return null;
    if (settings.distribute_only_qualified && lead.qualification_status !== "QUALIFIED") return null;

    const sellers = await tx.query<{ id: string }>(
      "SELECT id FROM users WHERE role = 'COLABORADOR' AND is_active AND receives_leads ORDER BY created_at, id"
    );
    if (sellers.length === 0) return null;
    const lastIndex = sellers.findIndex((s) => s.id === settings.last_assigned_user_id);
    const next = sellers[(lastIndex + 1) % sellers.length].id;
    await tx.query("UPDATE crm_settings SET last_assigned_user_id = $1, updated_at = NOW() WHERE id", [next]);
    return next;
  });
  if (chosen) await assignLead(leadId, chosen, null);
  return chosen;
}

export class LeadError extends Error {}

/** Colaboradores ativos (para os seletores de atribuição) */
export function listSellers() {
  return query<{ id: string; name: string; receives_leads: boolean }>(
    "SELECT id, name, receives_leads FROM users WHERE is_active AND role = 'COLABORADOR' ORDER BY name"
  );
}

export function getSettings() {
  return one<{
    distribution_mode: "MANUAL" | "ROUND_ROBIN";
    distribute_only_qualified: boolean;
    company_name: string;
  }>("SELECT distribution_mode, distribute_only_qualified, company_name FROM crm_settings WHERE id");
}
