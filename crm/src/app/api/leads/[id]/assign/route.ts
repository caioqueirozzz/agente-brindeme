import { NextResponse } from "next/server";
import { getLeadForUser, isUuid, jsonError, readJson, requireAdmin, serverError } from "@/lib/access";
import { assignLead, LeadError } from "@/lib/leads";

type Context = { params: Promise<{ id: string }> };

/** Distribui o lead (só o admin). `seller_id: null` devolve à fila. */
export async function POST(request: Request, { params }: Context) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const { id } = await params;
  const body = await readJson(request);
  const sellerId = body.seller_id === null ? null : isUuid(body.seller_id) ? body.seller_id : undefined;
  if (sellerId === undefined) return jsonError("Colaborador inválido.", 400);

  try {
    const lead = await getLeadForUser(id, guard.user);
    if (!lead) return jsonError("Lead não encontrado.", 404);
    // Mesma regra do dcimob: só lead qualificado vai para um vendedor
    if (sellerId && lead.qualification_status !== "QUALIFIED" && body.force !== true) {
      return jsonError("Qualifique o lead antes de distribuir.", 409);
    }
    await assignLead(id, sellerId, guard.user.id);
    return NextResponse.json({ lead: await getLeadForUser(id, guard.user) });
  } catch (err) {
    if (err instanceof LeadError) return jsonError(err.message, 400);
    return serverError(err, "atribuir lead");
  }
}
