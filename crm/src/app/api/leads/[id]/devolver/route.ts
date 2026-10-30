import { NextResponse } from "next/server";
import { getLeadForUser, jsonError, readJson, requireUser, serverError } from "@/lib/access";
import { transaction } from "@/lib/db";
import { logEvent } from "@/lib/leads";
import { callPonte } from "@/lib/whatsapp";

type Context = { params: Promise<{ id: string }> };

/** Devolve a conversa para a Lia (como o #devolver do chip), com uma nota opcional para ela. */
export async function POST(request: Request, { params }: Context) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const { id } = await params;
  const body = await readJson(request);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

  try {
    const lead = await getLeadForUser(id, guard.user);
    if (!lead) return jsonError("Lead não encontrado.", 404);
    const result = await callPonte("/devolver", { telefone: lead.phone, ...(note ? { nota: note } : {}) });
    if (!result.ok) return jsonError(result.error, result.status);
    await transaction(async (tx) => {
      await tx.query("UPDATE leads SET agent_mode = 'ia', needs_attention = false, attention_reason = NULL WHERE id = $1", [lead.id]);
      await logEvent(tx, lead.id, guard.user.id, "ATENDIMENTO", { modo: "ia", ...(note ? { nota: note } : {}) });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "devolver para a Lia");
  }
}
