import { isAdmin, leadScope, LEAD_COLUMNS } from "@/lib/access";
import type { SessionUser } from "@/lib/auth/session";
import { one, query } from "@/lib/db";
import { esfriarLeadsParados } from "@/lib/ingest";
import type { Lead, Stage } from "@/lib/types";

/*
 * Números da central do dia e dos relatórios. Tudo passa por leadScope:
 * o colaborador só soma o que é dele; dados de equipe saem só para o admin.
 */

// Brasil sem horário de verão desde 2019: o dia comercial é UTC-3
const OFFSET_MS = 3 * 3_600_000;

export function dayStart(daysAgo = 0): Date {
  const local = new Date(Date.now() - OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + OFFSET_MS - daysAgo * 86_400_000);
}

export function monthStart(): Date {
  const local = new Date(Date.now() - OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + OFFSET_MS);
}

function scoped(user: SessionUser) {
  const params: unknown[] = [];
  const where = leadScope(user, params);
  return { params, where };
}

async function leadList(user: SessionUser, extra: string, extraParams: unknown[], order: string, limit = 6): Promise<Lead[]> {
  const { params, where } = scoped(user);
  const offset = params.length;
  const sql = extra.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
  return query<Lead>(
    `SELECT ${LEAD_COLUMNS} FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
     WHERE ${where} AND ${sql} ORDER BY ${order} LIMIT ${limit}`,
    [...params, ...extraParams]
  );
}

export async function stageCounts(user: SessionUser): Promise<Record<Stage, { count: number; value: number }>> {
  const { params, where } = scoped(user);
  const rows = await query<{ stage: Stage; count: number; value: number }>(
    `SELECT stage, COUNT(*)::int AS count, COALESCE(SUM(CASE WHEN stage = 'GANHO' THEN won_value ELSE estimated_value END), 0)::float8 AS value
     FROM leads l WHERE ${where} GROUP BY stage`,
    params
  );
  const out = {} as Record<Stage, { count: number; value: number }>;
  for (const s of ["NOVO", "ATENDIMENTO", "ORCAMENTO", "ARTE", "NEGOCIACAO", "GANHO", "PERDIDO"] as Stage[]) {
    out[s] = { count: 0, value: 0 };
  }
  for (const r of rows) out[r.stage] = { count: r.count, value: r.value };
  return out;
}

/** Leads recebidos por dia (últimos `days`) */
async function dailySeries(user: SessionUser, days: number, column: "created_at" | "won_at") {
  const { params, where } = scoped(user);
  params.push(dayStart(days - 1).toISOString());
  const rows = await query<{ day: string; count: number; value: number }>(
    `SELECT to_char(${column} - INTERVAL '3 hours', 'YYYY-MM-DD') AS day, COUNT(*)::int AS count,
            COALESCE(SUM(won_value), 0)::float8 AS value
     FROM leads l WHERE ${where} AND ${column} >= $${params.length} ${column === "won_at" ? "AND stage = 'GANHO'" : ""}
     GROUP BY 1`,
    params
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(dayStart(days - 1 - i).getTime() - OFFSET_MS).toISOString().slice(0, 10);
    return { day: d, count: byDay.get(d)?.count ?? 0, value: byDay.get(d)?.value ?? 0 };
  });
}

/* ------------------------------------------------------------------ */
/*  Central do dia                                                     */
/* ------------------------------------------------------------------ */

export async function adminDashboard(user: SessionUser) {
  await esfriarLeadsParados();
  const today = dayStart().toISOString();
  const tomorrow = dayStart(-1).toISOString();
  const month = monthStart().toISOString();

  const [kpi, awaiting, attention, ranking, stages, series, temps, dueToday] = await Promise.all([
    one<{
      novos_hoje: number;
      aguardando: number;
      atencao: number;
      pipeline: number;
      ganho_mes: number;
      pedidos_mes: number;
      recebidos_mes: number;
      nao_lidas: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= $1)::int AS novos_hoje,
         COUNT(*) FILTER (WHERE qualification_status = 'QUALIFIED' AND assigned_to IS NULL AND stage NOT IN ('GANHO','PERDIDO'))::int AS aguardando,
         COUNT(*) FILTER (WHERE needs_attention)::int AS atencao,
         COALESCE(SUM(estimated_value) FILTER (WHERE stage IN ('NOVO','ATENDIMENTO','ORCAMENTO','ARTE','NEGOCIACAO')), 0)::float8 AS pipeline,
         COALESCE(SUM(won_value) FILTER (WHERE stage = 'GANHO' AND won_at >= $2), 0)::float8 AS ganho_mes,
         COUNT(*) FILTER (WHERE stage = 'GANHO' AND won_at >= $2)::int AS pedidos_mes,
         COUNT(*) FILTER (WHERE created_at >= $2)::int AS recebidos_mes,
         COALESCE(SUM(unread_count), 0)::int AS nao_lidas
       FROM leads`,
      [today, month]
    ),
    leadList(user, "l.qualification_status = 'QUALIFIED' AND l.assigned_to IS NULL AND l.stage NOT IN ('GANHO','PERDIDO')", [], "l.lead_score DESC NULLS LAST, l.last_message_at DESC NULLS LAST"),
    leadList(user, "l.needs_attention", [], "l.last_message_at DESC NULLS LAST"),
    query<{ id: string; name: string; ganho: number; pedidos: number; ativos: number; meta: number | null; atrasados: number }>(
      `SELECT u.id, u.name, u.monthly_goal::float8 AS meta,
         COALESCE(SUM(l.won_value) FILTER (WHERE l.stage = 'GANHO' AND l.won_at >= $1), 0)::float8 AS ganho,
         COUNT(l.id) FILTER (WHERE l.stage = 'GANHO' AND l.won_at >= $1)::int AS pedidos,
         COUNT(l.id) FILTER (WHERE l.stage IN ('NOVO','ATENDIMENTO','ORCAMENTO','ARTE','NEGOCIACAO'))::int AS ativos,
         COUNT(l.id) FILTER (WHERE l.next_action_at < NOW() AND l.stage NOT IN ('GANHO','PERDIDO'))::int AS atrasados
       FROM users u LEFT JOIN leads l ON l.assigned_to = u.id
       WHERE u.is_active AND u.role = 'COLABORADOR'
       GROUP BY u.id ORDER BY ganho DESC, pedidos DESC, u.name`,
      [month]
    ),
    stageCounts(user),
    dailySeries(user, 14, "created_at"),
    temperatureCounts(user),
    one<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM leads WHERE next_action_at < $1 AND stage NOT IN ('GANHO','PERDIDO')",
      [tomorrow]
    ),
  ]);

  return { kpi, awaiting, attention, ranking, stages, series, temps, dueToday: dueToday?.count ?? 0 };
}

export async function sellerDashboard(user: SessionUser) {
  await esfriarLeadsParados();
  const tomorrow = dayStart(-1).toISOString();
  const today = dayStart().toISOString();
  const month = monthStart().toISOString();
  const { params, where } = scoped(user);

  const [kpi, agenda, waiting, recent, stages, goal, temps] = await Promise.all([
    one<{ ativos: number; retornos: number; atrasados: number; nao_lidas: number; ganho_mes: number; pedidos_mes: number; pipeline: number; novos_hoje: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE stage IN ('NOVO','ATENDIMENTO','ORCAMENTO','ARTE','NEGOCIACAO'))::int AS ativos,
         COUNT(*) FILTER (WHERE next_action_at < $${params.length + 1} AND stage NOT IN ('GANHO','PERDIDO'))::int AS retornos,
         COUNT(*) FILTER (WHERE next_action_at < NOW() AND stage NOT IN ('GANHO','PERDIDO'))::int AS atrasados,
         COALESCE(SUM(unread_count), 0)::int AS nao_lidas,
         COALESCE(SUM(won_value) FILTER (WHERE stage = 'GANHO' AND won_at >= $${params.length + 3}), 0)::float8 AS ganho_mes,
         COUNT(*) FILTER (WHERE stage = 'GANHO' AND won_at >= $${params.length + 3})::int AS pedidos_mes,
         COALESCE(SUM(estimated_value) FILTER (WHERE stage IN ('NOVO','ATENDIMENTO','ORCAMENTO','ARTE','NEGOCIACAO')), 0)::float8 AS pipeline,
         COUNT(*) FILTER (WHERE assigned_at >= $${params.length + 2})::int AS novos_hoje
       FROM leads l WHERE ${where}`,
      [...params, tomorrow, today, month]
    ),
    leadList(user, "l.next_action_at < $1 AND l.stage NOT IN ('GANHO','PERDIDO')", [tomorrow], "l.next_action_at ASC", 8),
    leadList(user, "l.last_message_from_client AND l.stage NOT IN ('GANHO','PERDIDO')", [], "l.lead_score DESC NULLS LAST, l.last_message_at ASC", 6),
    leadList(user, "l.assigned_at IS NOT NULL", [], "l.assigned_at DESC", 5),
    stageCounts(user),
    one<{ meta: number | null }>("SELECT monthly_goal::float8 AS meta FROM users WHERE id = $1", [user.id]),
    temperatureCounts(user),
  ]);

  return { kpi, agenda, waiting, recent, stages, goal: goal?.meta ?? null, temps };
}

async function temperatureCounts(user: SessionUser) {
  const { params, where } = scoped(user);
  return (
    (await one<{ quente: number; morno: number; frio: number; sem: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE lead_score >= 70)::int AS quente,
         COUNT(*) FILTER (WHERE lead_score >= 40 AND lead_score < 70)::int AS morno,
         COUNT(*) FILTER (WHERE lead_score < 40)::int AS frio,
         COUNT(*) FILTER (WHERE lead_score IS NULL)::int AS sem
       FROM leads l WHERE ${where} AND stage NOT IN ('GANHO','PERDIDO')`,
      params
    )) ?? { quente: 0, morno: 0, frio: 0, sem: 0 }
  );
}

/* ------------------------------------------------------------------ */
/*  Relatórios                                                         */
/* ------------------------------------------------------------------ */

export async function report(user: SessionUser, days: number) {
  const from = dayStart(days - 1).toISOString();
  const s = scoped(user);
  const p = (extra: unknown[]) => [...s.params, ...extra];
  const n = s.params.length;

  const [totals, byOccasion, lost, received, won, bySeller, assignTime] = await Promise.all([
    one<{ recebidos: number; qualificados: number; ganhos: number; perdidos: number; valor_ganho: number; desqualificados: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= $${n + 1})::int AS recebidos,
         COUNT(*) FILTER (WHERE qualified_at >= $${n + 1})::int AS qualificados,
         COUNT(*) FILTER (WHERE stage = 'GANHO' AND won_at >= $${n + 1})::int AS ganhos,
         COUNT(*) FILTER (WHERE stage = 'PERDIDO' AND lost_at >= $${n + 1})::int AS perdidos,
         COUNT(*) FILTER (WHERE qualification_status = 'DISQUALIFIED' AND updated_at >= $${n + 1})::int AS desqualificados,
         COALESCE(SUM(won_value) FILTER (WHERE stage = 'GANHO' AND won_at >= $${n + 1}), 0)::float8 AS valor_ganho
       FROM leads l WHERE ${s.where}`,
      p([from])
    ),
    query<{ ocasiao: string; leads: number; ganhos: number; valor: number }>(
      `SELECT COALESCE(NULLIF(qualification->>'ocasiao', ''), 'Não informada') AS ocasiao, COUNT(*)::int AS leads,
         COUNT(*) FILTER (WHERE stage = 'GANHO')::int AS ganhos, COALESCE(SUM(won_value), 0)::float8 AS valor
       FROM leads l WHERE ${s.where} AND created_at >= $${n + 1}
       GROUP BY 1 ORDER BY leads DESC LIMIT 8`,
      p([from])
    ),
    query<{ motivo: string; total: number }>(
      `SELECT COALESCE(NULLIF(lost_reason, ''), 'Sem motivo registrado') AS motivo, COUNT(*)::int AS total
       FROM leads l WHERE ${s.where} AND stage = 'PERDIDO' AND lost_at >= $${n + 1}
       GROUP BY 1 ORDER BY total DESC LIMIT 6`,
      p([from])
    ),
    dailySeries(user, days, "created_at"),
    dailySeries(user, days, "won_at"),
    isAdmin(user)
      ? query<{ id: string; name: string; recebidos: number; ganhos: number; perdidos: number; valor: number; ativos: number }>(
          `SELECT u.id, u.name,
             COUNT(l.id) FILTER (WHERE l.assigned_at >= $1)::int AS recebidos,
             COUNT(l.id) FILTER (WHERE l.stage = 'GANHO' AND l.won_at >= $1)::int AS ganhos,
             COUNT(l.id) FILTER (WHERE l.stage = 'PERDIDO' AND l.lost_at >= $1)::int AS perdidos,
             COALESCE(SUM(l.won_value) FILTER (WHERE l.stage = 'GANHO' AND l.won_at >= $1), 0)::float8 AS valor,
             COUNT(l.id) FILTER (WHERE l.stage IN ('NOVO','ATENDIMENTO','ORCAMENTO','ARTE','NEGOCIACAO'))::int AS ativos
           FROM users u LEFT JOIN leads l ON l.assigned_to = u.id
           WHERE u.is_active AND u.role = 'COLABORADOR' GROUP BY u.id ORDER BY valor DESC, ganhos DESC`,
          [from]
        )
      : Promise.resolve(null),
    isAdmin(user)
      ? one<{ horas: number | null }>(
          `SELECT (AVG(EXTRACT(EPOCH FROM (assigned_at - COALESCE(qualified_at, created_at)))) / 3600)::float8 AS horas
           FROM leads WHERE assigned_at >= $1 AND assigned_at >= COALESCE(qualified_at, created_at)`,
          [from]
        )
      : Promise.resolve(null),
  ]);

  return {
    days,
    totals,
    stages: await stageCounts(user),
    byOccasion,
    lost,
    received,
    won,
    bySeller,
    hoursToAssign: assignTime?.horas ?? null,
  };
}
