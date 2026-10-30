import { NextResponse } from "next/server";
import { isAdmin, isUuid, jsonError, readJson, requireAdmin, requireUser, serverError } from "@/lib/access";
import { one, transaction, query } from "@/lib/db";
import { ORDER_COLUMNS, isOrderStage, normalizeOrderPhone, orderDate, orderText, phoneVariants } from "@/lib/orders";
import type { Order } from "@/lib/orders";

/** Entregues somem do quadro depois deste tempo (continuam no banco e a Lia ainda os acha). */
const DELIVERED_VISIBLE_DAYS = 30;

/**
 * Quadro de Pedidos. O admin vê todos; o colaborador só os pedidos dos leads dele, e só para ler.
 */
export async function GET(request: Request) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const params: unknown[] = [DELIVERED_VISIBLE_DAYS];
  let scope = "TRUE";
  if (!isAdmin(guard.user)) {
    params.push(guard.user.id);
    scope = `l.assigned_to = $${params.length}`;
  }
  // ?lead=<id>: os pedidos de um lead (detalhes do pedido fechado), inclusive entregues antigos
  const lead = new URL(request.url).searchParams.get("lead");
  let visible = "(o.stage <> 'ENTREGUE' OR o.stage_changed_at > NOW() - make_interval(days => $1))";
  if (lead) {
    if (!isUuid(lead)) return jsonError("Lead inválido.", 400);
    params.push(lead);
    // $1 continua citado: o Postgres recusa parâmetro enviado e não usado ("could not determine data type")
    visible = `($1::int IS NOT NULL AND o.lead_id = $${params.length})`;
  }
  try {
    const orders = await query<Order>(
      `SELECT ${ORDER_COLUMNS} FROM orders o LEFT JOIN leads l ON l.id = o.lead_id
       WHERE ${scope} AND ${visible}
       ORDER BY o.due_date ASC NULLS LAST, o.created_at ASC`,
      params
    );
    return NextResponse.json({ orders });
  } catch (err) {
    return serverError(err, "listar pedidos");
  }
}

/** Cadastra um pedido no quadro. Liga ao lead do mesmo telefone, se houver. Só a gestão. */
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const body = await readJson(request);
  // Vindo de um pedido fechado no funil: telefone e nome saem do lead
  let fromLead: { id: string; phone: string; name: string | null } | null = null;
  if (body.lead_id !== undefined) {
    if (!isUuid(body.lead_id)) return jsonError("Lead inválido.", 400);
    fromLead = await one<{ id: string; phone: string; name: string | null }>("SELECT id, phone, name FROM leads WHERE id = $1", [body.lead_id]);
    if (!fromLead) return jsonError("Lead não encontrado.", 404);
  }
  const phone = normalizeOrderPhone(fromLead?.phone ?? (typeof body.phone === "string" ? body.phone : ""));
  if (!phone) return jsonError("Informe o WhatsApp do cliente com DDD.", 400);
  const title = orderText(body.title, 200);
  if (!title) return jsonError("Descreva o pedido (ex.: 200 canecas personalizadas).", 400);
  const dueDate = orderDate(body.due_date);
  if (dueDate === undefined) return jsonError("Data de entrega inválida.", 400);
  const stage = body.stage === undefined ? "CONFIRMADO" : body.stage;
  if (!isOrderStage(stage)) return jsonError("Etapa inválida.", 400);

  try {
    const lead = fromLead ?? (await one<{ id: string; name: string | null }>("SELECT id, name FROM leads WHERE phone = ANY($1) LIMIT 1", [phoneVariants(phone)]));
    const id = await transaction(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO orders (lead_id, phone, customer_name, title, stage, due_date, client_note, internal_note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          lead?.id ?? null,
          phone,
          orderText(body.customer_name, 120) ?? lead?.name ?? null,
          title,
          stage,
          dueDate,
          orderText(body.client_note, 500),
          orderText(body.internal_note, 1000),
          guard.user.id,
        ]
      );
      await tx.query("INSERT INTO order_events (order_id, user_id, from_stage, to_stage) VALUES ($1, $2, NULL, $3)", [row.id, guard.user.id, stage]);
      return row.id;
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return serverError(err, "cadastrar pedido");
  }
}
