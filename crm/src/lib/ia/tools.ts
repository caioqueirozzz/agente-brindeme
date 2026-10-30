import { isUuid, leadScope } from "@/lib/access";
import type { SessionUser } from "@/lib/auth/session";
import { query, one } from "@/lib/db";
import { esfriarLeadsParados } from "@/lib/ingest";
import { dayStart, monthStart } from "@/lib/metrics";
import { STAGE_LABELS, leadTemperature } from "@/lib/types";
import type { Role, Stage } from "@/lib/types";

/*
 * Ferramentas de consulta do PresentesIA.
 *
 * O isolamento entre colaboradores NÃO depende do modelo obedecer ao prompt:
 *  1. Cada ferramenta declara os papéis que podem usá-la. O colaborador nem
 *     recebe as ferramentas de gestão, e `runIaTool` recusa a chamada mesmo
 *     que o nome venha forjado.
 *  2. O dono dos dados sai da sessão (`ownerScope`). Para o colaborador,
 *     `colaborador_id` não existe no schema e é ignorado se aparecer.
 *  3. Toda consulta de lead passa por `leadScope`, o mesmo filtro das telas.
 *  4. Nenhuma ferramenta do colaborador lê a tabela de usuários além dele
 *     mesmo: dados pessoais e números de outros vendedores não chegam ao modelo.
 */

type Args = Record<string, unknown>;

interface IaTool {
  name: string;
  description: string;
  roles: readonly Role[];
  properties: Record<string, object>;
  /** O admin ganha `colaborador_id` para recortar por vendedor */
  bySeller?: boolean;
  run: (user: SessionUser, args: Args) => Promise<unknown>;
}

const BOTH: readonly Role[] = ["ADMIN", "COLABORADOR"];
const ADMIN: readonly Role[] = ["ADMIN"];
const MAX_LIST = 30;

function str(args: Args, key: string, max = 80): string | null {
  const v = args[key];
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

function int(args: Args, key: string, fallback: number, min: number, max: number): number {
  const v = Number(args[key]);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

function period(args: Args, defaultDays = 30) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const de = str(args, "de", 10);
  const ate = str(args, "ate", 10);
  if (de && re.test(de)) {
    const to = ate && re.test(ate) ? ate : new Date().toISOString().slice(0, 10);
    return { from: `${de}T00:00:00-03:00`, to: `${to}T23:59:59.999-03:00`, label: `${de} a ${to}` };
  }
  const days = int(args, "dias", defaultDays, 1, 730);
  return { from: dayStart(days - 1).toISOString(), to: new Date().toISOString(), label: `últimos ${days} dias` };
}

/**
 * Condição SQL de quem são os leads desta chamada. Colaborador: sempre ele
 * mesmo. Admin: o colaborador pedido ou a operação inteira.
 */
function ownerScope(user: SessionUser, args: Args, params: unknown[]): string {
  const base = leadScope(user, params);
  if (user.role === "ADMIN" && isUuid(args.colaborador_id)) {
    params.push(args.colaborador_id);
    return `${base} AND l.assigned_to = $${params.length}`;
  }
  return base;
}

function clip(text: unknown, max: number): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Busca por nome/telefone sem curingas do usuário */
function searchTerm(args: Args, key: string): string | null {
  const v = str(args, key, 60);
  return v ? v.replace(/[%_\\]/g, " ").trim() || null : null;
}

const PERIOD_PROPS = {
  dias: { type: "integer", description: "Janela em dias até hoje (padrão 30). Ignorado se `de` vier." },
  de: { type: "string", description: "Início, AAAA-MM-DD" },
  ate: { type: "string", description: "Fim, AAAA-MM-DD (padrão: hoje)" },
};

const STAGE_ENUM = ["NOVO", "ATENDIMENTO", "ORCAMENTO", "ARTE", "NEGOCIACAO", "GANHO", "PERDIDO"];

export const IA_TOOLS: IaTool[] = [
  {
    name: "resumo_desempenho",
    description:
      "Números do período: leads recebidos, qualificados, pedidos fechados, perdidos, valor fechado, ticket médio, pipeline aberto por etapa e (para o colaborador) a meta do mês. Use para perguntas gerais de resultado.",
    roles: BOTH,
    bySeller: true,
    properties: { ...PERIOD_PROPS },
    async run(user, args) {
      const range = period(args);
      const params: unknown[] = [];
      const where = ownerScope(user, args, params);
      const n = params.length;
      const totals = await one<Record<string, number>>(
        `SELECT
           COUNT(*) FILTER (WHERE created_at BETWEEN $${n + 1} AND $${n + 2})::int AS leads_recebidos,
           COUNT(*) FILTER (WHERE qualified_at BETWEEN $${n + 1} AND $${n + 2})::int AS qualificados,
           COUNT(*) FILTER (WHERE stage = 'GANHO' AND won_at BETWEEN $${n + 1} AND $${n + 2})::int AS pedidos_fechados,
           COUNT(*) FILTER (WHERE stage = 'PERDIDO' AND lost_at BETWEEN $${n + 1} AND $${n + 2})::int AS perdidos,
           COALESCE(SUM(won_value) FILTER (WHERE stage = 'GANHO' AND won_at BETWEEN $${n + 1} AND $${n + 2}), 0)::float8 AS valor_fechado
         FROM leads l WHERE ${where}`,
        [...params, range.from, range.to]
      );
      const pipeline = await query<{ stage: Stage; leads: number; valor: number }>(
        `SELECT stage, COUNT(*)::int AS leads, COALESCE(SUM(estimated_value), 0)::float8 AS valor
         FROM leads l WHERE ${where} AND stage NOT IN ('GANHO','PERDIDO') GROUP BY stage`,
        params
      );
      let meta: unknown = undefined;
      if (user.role === "COLABORADOR") {
        const row = await one<{ meta: number | null; fechado: number }>(
          `SELECT (SELECT monthly_goal::float8 FROM users WHERE id = $1) AS meta,
             COALESCE((SELECT SUM(won_value) FROM leads WHERE assigned_to = $1 AND stage = 'GANHO' AND won_at >= $2), 0)::float8 AS fechado`,
          [user.id, monthStart().toISOString()]
        );
        meta = { meta_mensal: row?.meta ?? null, fechado_no_mes: row?.fechado ?? 0 };
      }
      const fechados = totals?.pedidos_fechados ?? 0;
      return {
        periodo: range.label,
        ...totals,
        ticket_medio: fechados ? Math.round((totals!.valor_fechado / fechados) * 100) / 100 : null,
        pipeline_aberto: pipeline.map((p) => ({ etapa: STAGE_LABELS[p.stage], leads: p.leads, valor_estimado: p.valor })),
        ...(meta ? { meta } : {}),
      };
    },
  },
  {
    name: "listar_leads",
    description:
      "Lista leads com filtros: etapa do funil, temperatura (quente/morno/frio), busca por nome/telefone/empresa, só os que aguardam resposta, só com retorno vencido. Devolve nome, etapa, temperatura, resumo do pedido, valor estimado e próximo passo.",
    roles: BOTH,
    bySeller: true,
    properties: {
      etapa: { type: "string", enum: STAGE_ENUM },
      temperatura: { type: "string", enum: ["quente", "morno", "frio"] },
      busca: { type: "string", description: "Nome, telefone ou empresa" },
      aguardando_resposta: { type: "boolean", description: "Última mensagem foi do cliente" },
      retorno_vencido: { type: "boolean", description: "Próximo passo com data já passada (ou hoje)" },
      limite: { type: "integer", description: `1 a ${MAX_LIST} (padrão 15)` },
    },
    async run(user, args) {
      await esfriarLeadsParados();
      const params: unknown[] = [];
      const conds = [ownerScope(user, args, params)];
      const etapa = typeof args.etapa === "string" && STAGE_ENUM.includes(args.etapa) ? args.etapa : null;
      if (etapa) {
        params.push(etapa);
        conds.push(`l.stage = $${params.length}`);
      } else {
        conds.push("l.stage NOT IN ('GANHO','PERDIDO')");
      }
      if (args.temperatura === "quente") conds.push("l.lead_score >= 70");
      if (args.temperatura === "morno") conds.push("l.lead_score >= 40 AND l.lead_score < 70");
      if (args.temperatura === "frio") conds.push("l.lead_score < 40");
      const busca = searchTerm(args, "busca");
      if (busca) {
        params.push(`%${busca}%`);
        conds.push(`(l.name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR l.company ILIKE $${params.length})`);
      }
      if (args.aguardando_resposta === true) conds.push("l.last_message_from_client");
      if (args.retorno_vencido === true) {
        params.push(dayStart(-1).toISOString());
        conds.push(`l.next_action_at < $${params.length}`);
      }
      const rows = await query<Record<string, unknown>>(
        `SELECT l.name, l.phone, l.company, l.stage, l.lead_score, l.qualification_summary, l.estimated_value::float8 AS estimated_value,
           l.next_action, l.next_action_at, l.last_message_at, l.last_message_from_client, u.name AS vendedor
         FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
         WHERE ${conds.join(" AND ")}
         ORDER BY l.lead_score DESC NULLS LAST, l.last_message_at DESC NULLS LAST
         LIMIT ${int(args, "limite", 15, 1, MAX_LIST)}`,
        params
      );
      return {
        total: rows.length,
        leads: rows.map((r) => ({
          cliente: r.name ?? r.phone,
          empresa: r.company,
          etapa: STAGE_LABELS[r.stage as Stage],
          temperatura: leadTemperature(r.lead_score as number | null),
          score: r.lead_score,
          resumo: r.qualification_summary,
          valor_estimado: r.estimated_value,
          proximo_passo: r.next_action,
          proximo_passo_em: r.next_action_at,
          ultima_mensagem_em: r.last_message_at,
          aguardando_resposta: r.last_message_from_client,
          ...(user.role === "ADMIN" ? { vendedor: r.vendedor ?? "sem vendedor" } : {}),
        })),
      };
    },
  },
  {
    name: "detalhar_lead",
    description:
      "Ficha completa de UM lead encontrado por nome, telefone ou empresa: o que o agente Lia apurou (ocasião, quantidade, prazo, produtos, itens e estimativa), notas, histórico de etapas e as últimas mensagens da conversa.",
    roles: BOTH,
    properties: { busca: { type: "string", description: "Nome, telefone ou empresa do cliente" } },
    async run(user, args) {
      const busca = searchTerm(args, "busca");
      if (!busca) return { erro: "Informe nome, telefone ou empresa." };
      const params: unknown[] = [];
      const where = leadScope(user, params);
      params.push(`%${busca}%`);
      const leads = await query<Record<string, unknown>>(
        `SELECT l.*, u.name AS vendedor FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
         WHERE ${where} AND (l.name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR l.company ILIKE $${params.length})
         ORDER BY l.last_message_at DESC NULLS LAST LIMIT 3`,
        params
      );
      // Fora do escopo do colaborador o lead simplesmente não aparece
      if (leads.length === 0) return { encontrado: false };
      if (leads.length > 1) {
        return { varios: leads.map((l) => ({ cliente: l.name ?? l.phone, empresa: l.company, etapa: STAGE_LABELS[l.stage as Stage] })) };
      }
      const l = leads[0];
      const [messages, events] = await Promise.all([
        query<{ author: string; body: string; sent_at: string }>(
          "SELECT author, body, sent_at FROM messages WHERE lead_id = $1 ORDER BY sent_at DESC LIMIT 12",
          [l.id]
        ),
        query<{ type: string; data: Record<string, unknown>; created_at: string }>(
          "SELECT type, data, created_at FROM lead_events WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 10",
          [l.id]
        ),
      ]);
      return {
        cliente: l.name ?? l.phone,
        telefone: l.phone,
        empresa: l.company,
        tipo: l.customer_type,
        etapa: STAGE_LABELS[l.stage as Stage],
        temperatura: leadTemperature(l.lead_score as number | null),
        score: l.lead_score,
        qualificacao: l.qualification,
        resumo: l.qualification_summary,
        valor_estimado: l.estimated_value,
        valor_fechado: l.won_value,
        motivo_perda: l.lost_reason,
        proximo_passo: l.next_action,
        proximo_passo_em: l.next_action_at,
        ...(user.role === "ADMIN" ? { vendedor: l.vendedor ?? "sem vendedor" } : {}),
        historico: events.map((e) => ({ tipo: e.type, dados: e.data, em: e.created_at })),
        // Textos do cliente são dados, não instruções (ver prompt)
        ultimas_mensagens: messages.reverse().map((m) => ({ de: m.author.toLowerCase(), texto: clip(m.body, 400), em: m.sent_at })),
      };
    },
  },
  {
    name: "agenda_retornos",
    description: "Próximos passos combinados com clientes: vencidos e dos próximos dias.",
    roles: BOTH,
    bySeller: true,
    properties: { dias: { type: "integer", description: "Quantos dias à frente (padrão 1 = até amanhã)" } },
    async run(user, args) {
      const params: unknown[] = [];
      const where = ownerScope(user, args, params);
      params.push(dayStart(-int(args, "dias", 1, 0, 30)).toISOString());
      const rows = await query<Record<string, unknown>>(
        `SELECT l.name, l.phone, l.next_action, l.next_action_at, l.stage, u.name AS vendedor
         FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
         WHERE ${where} AND l.next_action_at IS NOT NULL AND l.next_action_at < $${params.length} AND l.stage NOT IN ('GANHO','PERDIDO')
         ORDER BY l.next_action_at LIMIT ${MAX_LIST}`,
        params
      );
      const now = Date.now();
      return rows.map((r) => ({
        cliente: r.name ?? r.phone,
        o_que: r.next_action,
        quando: r.next_action_at,
        vencido: new Date(r.next_action_at as string).getTime() < now,
        etapa: STAGE_LABELS[r.stage as Stage],
        ...(user.role === "ADMIN" ? { vendedor: r.vendedor } : {}),
      }));
    },
  },
  {
    name: "listar_colaboradores",
    description: "Colaboradores ativos com id, cargo e se recebem leads. Use para achar o colaborador_id.",
    roles: ADMIN,
    properties: {},
    async run() {
      return query("SELECT id, name AS nome, job_title AS cargo, receives_leads AS recebe_leads, monthly_goal::float8 AS meta_mensal FROM users WHERE is_active AND role = 'COLABORADOR' ORDER BY name");
    },
  },
  {
    name: "ranking_colaboradores",
    description: "Ranking da equipe no período: pedidos fechados, valor, perdidos, leads ativos, conversão, meta mensal e % da meta atingido (meta_atingida_pct; null = sem meta definida). Para metas do mês, use de = primeiro dia do mês.",
    roles: ADMIN,
    properties: { ...PERIOD_PROPS },
    async run(_user, args) {
      const range = period(args);
      const rows = await query<Record<string, number | string | null>>(
        `SELECT u.name, u.monthly_goal::float8 AS meta,
           COUNT(l.id) FILTER (WHERE l.assigned_at BETWEEN $1 AND $2)::int AS recebidos,
           COUNT(l.id) FILTER (WHERE l.stage = 'GANHO' AND l.won_at BETWEEN $1 AND $2)::int AS fechados,
           COUNT(l.id) FILTER (WHERE l.stage = 'PERDIDO' AND l.lost_at BETWEEN $1 AND $2)::int AS perdidos,
           COALESCE(SUM(l.won_value) FILTER (WHERE l.stage = 'GANHO' AND l.won_at BETWEEN $1 AND $2), 0)::float8 AS valor,
           COUNT(l.id) FILTER (WHERE l.stage IN ('NOVO','ATENDIMENTO','ORCAMENTO','ARTE','NEGOCIACAO'))::int AS ativos
         FROM users u LEFT JOIN leads l ON l.assigned_to = u.id
         WHERE u.is_active AND u.role = 'COLABORADOR' GROUP BY u.id ORDER BY valor DESC`,
        [range.from, range.to]
      );
      return {
        periodo: range.label,
        ranking: rows.map((r) => {
          const decididos = Number(r.fechados) + Number(r.perdidos);
          const meta = r.meta === null ? null : Number(r.meta);
          return {
            ...r,
            conversao_pct: decididos ? Math.round((Number(r.fechados) / decididos) * 100) : null,
            // Pronto para o modelo não errar a conta; null = sem meta (não entra em "longe da meta")
            meta_atingida_pct: meta ? Math.round((Number(r.valor) / meta) * 100) : null,
          };
        }),
      };
    },
  },
  {
    name: "fila_da_operacao",
    description: "Leads qualificados aguardando vendedor e conversas que a Lia transferiu e pedem atenção.",
    roles: ADMIN,
    properties: {},
    async run() {
      const [fila, atencao] = await Promise.all([
        query("SELECT name, phone, lead_score, qualification_summary, estimated_value::float8 AS estimated_value, qualified_at FROM leads WHERE qualification_status = 'QUALIFIED' AND assigned_to IS NULL AND stage NOT IN ('GANHO','PERDIDO') ORDER BY lead_score DESC NULLS LAST LIMIT 30"),
        query("SELECT l.name, l.phone, l.attention_reason, l.last_message_at, u.name AS vendedor FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.needs_attention ORDER BY l.last_message_at DESC NULLS LAST LIMIT 30"),
      ]);
      return { aguardando_vendedor: fila, pedem_atencao: atencao };
    },
  },
  {
    name: "analise_ocasioes_e_perdas",
    description: "Leads e fechamentos por ocasião (fim de ano, eventos, onboarding...) e principais motivos de perda no período.",
    roles: ADMIN,
    properties: { ...PERIOD_PROPS },
    async run(_user, args) {
      const range = period(args, 90);
      const [ocasioes, perdas] = await Promise.all([
        query(
          `SELECT COALESCE(NULLIF(qualification->>'ocasiao',''),'não informada') AS ocasiao, COUNT(*)::int AS leads,
             COUNT(*) FILTER (WHERE stage='GANHO')::int AS fechados, COALESCE(SUM(won_value),0)::float8 AS valor
           FROM leads WHERE created_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY leads DESC LIMIT 12`,
          [range.from, range.to]
        ),
        query(
          `SELECT COALESCE(NULLIF(lost_reason,''),'sem motivo') AS motivo, COUNT(*)::int AS total
           FROM leads WHERE stage='PERDIDO' AND lost_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY total DESC LIMIT 10`,
          [range.from, range.to]
        ),
      ]);
      return { periodo: range.label, ocasioes, motivos_de_perda: perdas };
    },
  },
];

const SELLER_PROP = {
  colaborador_id: { type: "string", description: "Restringe a um colaborador (id de listar_colaboradores). Sem ele, a operação inteira." },
};

/** Ferramentas do papel, no formato de function calling da OpenAI */
export function iaToolsFor(role: Role) {
  return IA_TOOLS.filter((t) => t.roles.includes(role)).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: { ...t.properties, ...(role === "ADMIN" && t.bySeller ? SELLER_PROP : {}) },
        additionalProperties: false,
      },
    },
  }));
}

/** Executa a chamada do modelo. Ferramenta fora do papel é recusada aqui. */
export async function runIaTool(user: SessionUser, name: string, rawArgs: string): Promise<unknown> {
  const tool = IA_TOOLS.find((t) => t.name === name);
  if (!tool || !tool.roles.includes(user.role)) return { erro: "Consulta não permitida para o seu perfil." };
  let args: Args = {};
  try {
    const parsed = JSON.parse(rawArgs || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
  } catch {
    return { erro: "Argumentos inválidos." };
  }
  // Colaborador nunca escolhe de quem são os dados
  if (user.role !== "ADMIN") delete args.colaborador_id;
  try {
    return await tool.run(user, args);
  } catch (err) {
    console.error(`PresentesIA: ferramenta ${name}:`, err);
    return { erro: "Não foi possível consultar esses dados agora." };
  }
}
