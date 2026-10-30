import { NextResponse } from "next/server";
import { getLeadForUser, isAdmin, jsonError, readJson, requireUser, serverError } from "@/lib/access";
import { query, transaction } from "@/lib/db";
import { logEvent } from "@/lib/leads";
import { STAGE_LABELS } from "@/lib/types";
import type { LeadEvent, Message, Stage } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };
const STAGES = Object.keys(STAGE_LABELS) as Stage[];

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const { id } = await params;
  try {
    const lead = await getLeadForUser(id, guard.user);
    if (!lead) return jsonError("Lead não encontrado.", 404);
    const [messages, events] = await Promise.all([
      query<Message>(
        `SELECT m.id, m.author, u.name AS sent_by_name, m.body, m.sent_at, m.kind
         FROM messages m LEFT JOIN users u ON u.id = m.sent_by WHERE m.lead_id = $1 ORDER BY m.sent_at ASC LIMIT 500`,
        [id]
      ),
      query<LeadEvent>(
        `SELECT e.id, e.type, u.name AS user_name, e.data, e.created_at
         FROM lead_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.lead_id = $1 ORDER BY e.created_at DESC LIMIT 100`,
        [id]
      ),
    ]);
    // Abrir a conversa zera as não lidas para quem é dono dela
    if (lead.unread_count > 0 && (lead.assigned_to === guard.user.id || (!lead.assigned_to && isAdmin(guard.user)))) {
      await query("UPDATE leads SET unread_count = 0 WHERE id = $1", [id]);
    }
    return NextResponse.json({ lead, messages, events });
  } catch (err) {
    return serverError(err, "abrir lead");
  }
}

function text(v: unknown, max: number): string | null {
  return typeof v === "string" ? v.trim().slice(0, max) || null : null;
}

function money(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/\./g, "").replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * Atualiza um lead visível ao usuário. Qualificar/desqualificar é do admin;
 * o resto (etapa, valores, próximo passo, dados do cliente, temperatura)
 * o dono do lead também pode.
 */
export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const user = guard.user;
  const { id } = await params;
  const body = await readJson(request);

  try {
    const lead = await getLeadForUser(id, user);
    if (!lead) return jsonError("Lead não encontrado.", 404);

    const sets: string[] = [];
    const values: unknown[] = [id];
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    for (const [key, max] of [["name", 120], ["email", 160], ["company", 120]] as const) {
      if (key in body) set(key, text(body[key], max));
    }
    if ("customer_type" in body) set("customer_type", body.customer_type === "PF" || body.customer_type === "PJ" ? body.customer_type : null);
    if ("estimated_value" in body) set("estimated_value", money(body.estimated_value));

    if ("lead_score" in body) {
      const score = body.lead_score === null ? null : Math.round(Number(body.lead_score));
      if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) return jsonError("Score deve ficar entre 0 e 100.", 400);
      set("lead_score", score);
      set("score_locked", score !== null);
      events.push({ type: "QUALIFICACAO", data: { score } });
    }

    if ("next_action" in body || "next_action_at" in body) {
      const action = text(body.next_action, 200);
      const at = typeof body.next_action_at === "string" && !Number.isNaN(Date.parse(body.next_action_at)) ? new Date(body.next_action_at).toISOString() : null;
      set("next_action", action);
      set("next_action_at", action ? at : null);
      events.push({ type: "PROXIMO_PASSO", data: { acao: action, em: action ? at : null } });
    }

    if (body.needs_attention === false) {
      set("needs_attention", false);
      set("attention_reason", null);
    }

    if ("stage" in body) {
      const stage = body.stage as Stage;
      if (!STAGES.includes(stage)) return jsonError("Etapa inválida.", 400);
      if (stage !== lead.stage) {
        set("stage", stage);
        if (stage === "GANHO") {
          const won = money(body.won_value) ?? lead.estimated_value;
          if (!won) return jsonError("Informe o valor do pedido fechado.", 400);
          set("won_value", won);
          set("won_at", new Date().toISOString());
          set("next_action", null);
          set("next_action_at", null);
        } else if (stage === "PERDIDO") {
          const reason = text(body.lost_reason, 200);
          if (!reason) return jsonError("Informe o motivo da perda.", 400);
          set("lost_reason", reason);
          set("lost_at", new Date().toISOString());
          set("next_action", null);
          set("next_action_at", null);
        }
        if (lead.stage === "GANHO" && stage !== "GANHO") {
          set("won_value", null);
          set("won_at", null);
        }
        if (lead.stage === "PERDIDO" && stage !== "PERDIDO") {
          set("lost_reason", null);
          set("lost_at", null);
        }
        events.push({ type: "ETAPA", data: { de: lead.stage, para: stage, ...(stage === "PERDIDO" ? { motivo: text(body.lost_reason, 200) } : {}) } });
      }
    } else if ("won_value" in body && lead.stage === "GANHO") {
      const won = money(body.won_value);
      if (!won) return jsonError("Valor inválido.", 400);
      set("won_value", won);
    }

    if ("qualification_status" in body) {
      if (!isAdmin(user)) return jsonError("Só a administração qualifica ou desqualifica leads.", 403);
      const status = body.qualification_status;
      if (status !== "QUALIFIED" && status !== "DISQUALIFIED" && status !== "IN_PROGRESS") return jsonError("Status inválido.", 400);
      if (status === "DISQUALIFIED" && !text(body.disqualification_reason, 200)) return jsonError("Informe o motivo da desqualificação.", 400);
      set("qualification_status", status);
      set("qualification_source", "MANUAL");
      set("disqualification_reason", status === "DISQUALIFIED" ? text(body.disqualification_reason, 200) : null);
      if (status === "QUALIFIED" && !lead.qualified_at) set("qualified_at", new Date().toISOString());
      events.push({ type: "QUALIFICACAO", data: { status, motivo: text(body.disqualification_reason, 200) } });
    }

    if (sets.length === 0) return jsonError("Nada para atualizar.", 400);

    await transaction(async (tx) => {
      await tx.query(`UPDATE leads SET ${sets.join(", ")} WHERE id = $1`, values);
      for (const e of events) await logEvent(tx, id, user.id, e.type, e.data);
    });
    return NextResponse.json({ lead: await getLeadForUser(id, user) });
  } catch (err) {
    return serverError(err, "atualizar lead");
  }
}
