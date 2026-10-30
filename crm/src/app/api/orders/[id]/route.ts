import { NextResponse } from "next/server";
import { isAdmin, isUuid, jsonError, readJson, requireAdmin, requireUser, serverError } from "@/lib/access";
import { one, query, transaction } from "@/lib/db";
import { ORDER_COLUMNS, isOrderStage, orderDate, orderText } from "@/lib/orders";
import type { Order, OrderEvent } from "@/lib/orders";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Pedido não encontrado.", 404);
  const scopeParams: unknown[] = [id];
  let scope = "TRUE";
  if (!isAdmin(guard.user)) {
    scopeParams.push(guard.user.id);
    scope = "l.assigned_to = $2";
  }
  try {
    const order = await one<Order>(`SELECT ${ORDER_COLUMNS} FROM orders o LEFT JOIN leads l ON l.id = o.lead_id WHERE o.id = $1 AND ${scope}`, scopeParams);
    if (!order) return jsonError("Pedido não encontrado.", 404);
    const events = await query<OrderEvent>(
      `SELECT e.id, e.from_stage, e.to_stage, u.name AS user_name, e.created_at
       FROM order_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.order_id = $1 ORDER BY e.created_at DESC LIMIT 50`,
      [id]
    );
    // O colaborador não vê a observação interna da gestão
    return NextResponse.json({ order: isAdmin(guard.user) ? order : { ...order, internal_note: null }, events });
  } catch (err) {
    return serverError(err, "abrir pedido");
  }
}

/** Edita o pedido ou move de etapa. Só a gestão. */
export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Pedido não encontrado.", 404);
  const body = await readJson(request);

  const sets: string[] = [];
  const values: unknown[] = [id];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if ("title" in body) {
    const title = orderText(body.title, 200);
    if (!title) return jsonError("O pedido precisa de uma descrição.", 400);
    set("title", title);
  }
  if ("customer_name" in body) set("customer_name", orderText(body.customer_name, 120));
  if ("client_note" in body) set("client_note", orderText(body.client_note, 500));
  if ("internal_note" in body) set("internal_note", orderText(body.internal_note, 1000));
  if ("due_date" in body) {
    const due = orderDate(body.due_date);
    if (due === undefined) return jsonError("Data de entrega inválida.", 400);
    set("due_date", due);
  }
  // O "*" de atraso sai quando a gestão resolve: marca à mão, muda a previsão ou a etapa
  let clearLate = body.clear_late_alert === true;
  const stage = body.stage;
  if (stage !== undefined && !isOrderStage(stage)) return jsonError("Etapa inválida.", 400);

  try {
    const found = await transaction(async (tx) => {
      const [current] = await tx.query<{ stage: string; due_date: string | null }>(
        "SELECT stage, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM orders WHERE id = $1 FOR UPDATE",
        [id]
      );
      if (!current) return false;
      if ("due_date" in body && (orderDate(body.due_date) ?? null) !== current.due_date) clearLate = true;
      if (stage && stage !== current.stage) {
        clearLate = true;
        set("stage", stage);
        sets.push("stage_changed_at = NOW()");
        await tx.query("INSERT INTO order_events (order_id, user_id, from_stage, to_stage) VALUES ($1, $2, $3, $4)", [id, guard.user.id, current.stage, stage]);
      }
      if (clearLate) sets.push("late_alert_at = NULL");
      if (sets.length) await tx.query(`UPDATE orders SET ${sets.join(", ")} WHERE id = $1`, values);
      return true;
    });
    if (!found) return jsonError("Pedido não encontrado.", 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "atualizar pedido");
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Pedido não encontrado.", 404);
  try {
    const deleted = await query("DELETE FROM orders WHERE id = $1 RETURNING id", [id]);
    if (!deleted.length) return jsonError("Pedido não encontrado.", 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "excluir pedido");
  }
}
