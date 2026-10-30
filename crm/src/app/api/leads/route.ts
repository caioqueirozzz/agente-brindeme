import { NextResponse } from "next/server";
import { isAdmin, isUuid, jsonError, LEAD_COLUMNS, leadScope, readJson, requireUser, serverError } from "@/lib/access";
import { query, transaction } from "@/lib/db";
import { esfriarLeadsParados } from "@/lib/ingest";
import { assignLead, autoAssignLead, logEvent } from "@/lib/leads";
import type { Lead } from "@/lib/types";

const STAGES = ["NOVO", "ATENDIMENTO", "ORCAMENTO", "ARTE", "NEGOCIACAO", "GANHO", "PERDIDO"];

/**
 * Lista de leads do usuário. Filtros: q, stage, temp, status (qualificação),
 * owner (admin: "me" | "none" | id), attention, waiting.
 */
export async function GET(request: Request) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const user = guard.user;
  const url = new URL(request.url);
  await esfriarLeadsParados();

  const params: unknown[] = [];
  const conds = [leadScope(user, params)];

  const q = url.searchParams.get("q")?.trim().slice(0, 60).replace(/[%_\\]/g, " ");
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    conds.push(`(l.name ILIKE $${i} OR l.phone ILIKE $${i} OR l.company ILIKE $${i} OR l.email ILIKE $${i})`);
  }
  const stage = url.searchParams.get("stage");
  if (stage === "open") conds.push("l.stage NOT IN ('GANHO','PERDIDO')");
  else if (stage && STAGES.includes(stage)) {
    params.push(stage);
    conds.push(`l.stage = $${params.length}`);
  }
  const temp = url.searchParams.get("temp");
  if (temp === "quente") conds.push("l.lead_score >= 70");
  if (temp === "morno") conds.push("l.lead_score >= 40 AND l.lead_score < 70");
  if (temp === "frio") conds.push("l.lead_score < 40");
  const status = url.searchParams.get("status");
  if (status && ["NONE", "IN_PROGRESS", "QUALIFIED", "DISQUALIFIED"].includes(status)) {
    params.push(status);
    conds.push(`l.qualification_status = $${params.length}`);
  }
  // Filtro por dono só existe para o admin; o colaborador já está preso aos dele
  const owner = url.searchParams.get("owner");
  if (isAdmin(user) && owner) {
    if (owner === "none") conds.push("l.assigned_to IS NULL");
    else {
      params.push(owner === "me" ? user.id : isUuid(owner) ? owner : null);
      conds.push(`l.assigned_to = $${params.length}`);
    }
  }
  if (url.searchParams.get("attention") === "1") conds.push("l.needs_attention");
  if (url.searchParams.get("waiting") === "1") conds.push("l.last_message_from_client");

  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 300));
  try {
    const leads = await query<Lead>(
      `SELECT ${LEAD_COLUMNS} FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
       WHERE ${conds.join(" AND ")}
       ORDER BY l.needs_attention DESC, l.last_message_at DESC NULLS LAST, l.created_at DESC
       LIMIT ${limit}`,
      params
    );
    return NextResponse.json({ leads });
  } catch (err) {
    return serverError(err, "listar leads");
  }
}

/** Cadastro manual de lead. O colaborador cria já atribuído a si mesmo. */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const user = guard.user;
  const body = await readJson(request);

  const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";
  if (phone.length < 10) return jsonError("Informe um telefone com DDD.", 400);
  const normalized = phone.length <= 11 ? `55${phone}` : phone;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) || null : null;
  const company = typeof body.company === "string" ? body.company.trim().slice(0, 120) || null : null;
  const value = Number(body.estimated_value);

  try {
    const result = await transaction(async (tx) => {
      const [dup] = await tx.query<{ id: string; assigned_to: string | null }>("SELECT id, assigned_to FROM leads WHERE phone = $1", [normalized]);
      if (dup) return { duplicate: dup };
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO leads (phone, name, company, source, stage, estimated_value, qualification_status, qualification_source, qualified_at, lead_score)
         VALUES ($1, $2, $3, 'MANUAL', 'NOVO', $4, 'QUALIFIED', 'MANUAL', NOW(), 50) RETURNING id`,
        [normalized, name, company, Number.isFinite(value) && value > 0 ? value : null]
      );
      await logEvent(tx, row.id, user.id, "CRIADO", { origem: "manual" });
      return { id: row.id };
    });
    if ("duplicate" in result && result.duplicate) {
      const visible = isAdmin(user) || result.duplicate.assigned_to === user.id;
      return jsonError(visible ? "Já existe um lead com este telefone." : "Este telefone já está com outro colaborador. Fale com a administração.", 409);
    }
    const id = (result as { id: string }).id;
    if (isAdmin(user)) {
      if (isUuid(body.assigned_to)) await assignLead(id, body.assigned_to, user.id);
      else await autoAssignLead(id);
    } else {
      await assignLead(id, user.id, user.id);
    }
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return serverError(err, "criar lead");
  }
}
