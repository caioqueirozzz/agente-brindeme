import { NextResponse } from "next/server";
import { jsonError, serverError } from "@/lib/access";
import { query, transaction } from "@/lib/db";
import { notify } from "@/lib/leads";
import { integrationAuthorized as authorized } from "@/lib/integration";
import { ORDER_COLUMNS, ORDER_STAGES, phoneVariants } from "@/lib/orders";
import type { Order } from "@/lib/orders";

/** Entregues continuam aparecendo para o cliente por este tempo. */
const DELIVERED_DAYS = 60;
/** O mesmo pedido atrasado avisa a equipe no máximo uma vez neste intervalo. */
const ALERT_EVERY_HOURS = 24;

const TZ = "America/Sao_Paulo";
/** AAAA-MM-DD de hoje no horário da loja */
const todaySP = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

function brDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Andamento dos pedidos de um cliente, para a Lia responder no WhatsApp.
 * O telefone da conversa é a autenticação: só volta o que é daquele número,
 * e nunca a observação interna da equipe.
 *
 * Pedido atrasado consultado = cliente perguntou por um pedido fora do prazo: a gestão e o vendedor
 * do lead recebem um aviso e o card ganha o "*" (late_alert_at) até alguém resolver.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return jsonError("Não autorizado.", 401);
  const phone = (new URL(request.url).searchParams.get("telefone") ?? "").replace(/\D/g, "");
  if (phone.length < 10) return jsonError("Telefone inválido.", 400);
  try {
    const orders = await query<Order>(
      `SELECT ${ORDER_COLUMNS} FROM orders o
       WHERE o.phone = ANY($1) AND (o.stage <> 'ENTREGUE' OR o.stage_changed_at > NOW() - make_interval(days => $2))
       ORDER BY (o.stage = 'ENTREGUE'), o.created_at DESC LIMIT 10`,
      [phoneVariants(phone), DELIVERED_DAYS]
    );
    const today = todaySP();
    const isLate = (o: Order) => Boolean(o.due_date && o.stage !== "ENTREGUE" && o.due_date < today);
    await alertLate(orders.filter(isLate));
    const pedidos = orders.map((o) => {
      const index = ORDER_STAGES.findIndex((s) => s.value === o.stage);
      const stage = ORDER_STAGES[index];
      return {
        codigo: o.code,
        descricao: o.title,
        etapa_atual: stage.label,
        o_que_significa: stage.client,
        passo: `${index + 1} de ${ORDER_STAGES.length}`,
        etapa_desde: new Date(o.stage_changed_at).toLocaleDateString("pt-BR", { timeZone: TZ }),
        etapas: ORDER_STAGES.map((s, i) => ({ etapa: s.label, situacao: i < index ? "concluida" : i === index ? "atual" : "pendente" })),
        previsao_entrega: brDate(o.due_date),
        atrasado: isLate(o),
        // Atrasado: a equipe já foi avisada agora (ou nas últimas 24h); a Lia diz isso ao cliente
        ...(isLate(o) ? { equipe_avisada: true } : {}),
        recado_da_equipe: o.client_note,
      };
    });
    return NextResponse.json({ pedidos });
  } catch (err) {
    return serverError(err, "andamento de pedidos (integração)");
  }
}

async function alertLate(orders: Order[]): Promise<void> {
  for (const order of orders) {
    await transaction(async (tx) => {
      // Marca e decide numa só instrução: duas consultas juntas não avisam duas vezes
      const marked = await tx.query<{ lead_id: string | null }>(
        `UPDATE orders SET late_alert_at = NOW()
         WHERE id = $1 AND (late_alert_at IS NULL OR late_alert_at < NOW() - make_interval(hours => $2))
         RETURNING lead_id`,
        [order.id, ALERT_EVERY_HOURS]
      );
      if (!marked.length) return;
      const [lead] = marked[0].lead_id
        ? await tx.query<{ assigned_to: string | null; name: string | null }>("SELECT assigned_to, name FROM leads WHERE id = $1", [marked[0].lead_id])
        : [];
      const who = order.customer_name || lead?.name || order.phone;
      const title = `Pedido atrasado: ${order.code}`;
      const message = `${who} perguntou à Lia pelo pedido "${order.title}". Previsão era ${brDate(order.due_date)} e a etapa atual é "${ORDER_STAGES.find((s) => s.value === order.stage)?.label}". Passe uma nova previsão ao cliente.`;
      const admins = await tx.query<{ id: string }>("SELECT id FROM users WHERE role = 'ADMIN' AND is_active");
      for (const a of admins) await notify(tx, a.id, title, message, `/admin/quadros?view=pedidos&pedido=${order.id}`);
      const seller = lead?.assigned_to;
      if (seller && !admins.some((a) => a.id === seller)) await notify(tx, seller, title, message, `/app/quadros?view=pedidos&pedido=${order.id}`);
    });
  }
}
