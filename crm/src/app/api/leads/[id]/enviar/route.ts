import { NextResponse } from "next/server";
import { getLeadForUser, jsonError, readJson, requireUser, serverError } from "@/lib/access";
import { transaction } from "@/lib/db";
import { logEvent } from "@/lib/leads";
import { callPonte } from "@/lib/whatsapp";

type Context = { params: Promise<{ id: string }> };

/**
 * Responde o cliente pelo WhatsApp da loja. Só quem pode ver o lead (o dono ou o admin).
 * Vale como atendente na ponte: a Lia pausa nesta conversa até alguém devolver.
 */
export async function POST(request: Request, { params }: Context) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const { id } = await params;
  const body = await readJson(request);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return jsonError("Escreva a mensagem.", 400);
  if (text.length > 4000) return jsonError("Mensagem longa demais (máximo 4.000 caracteres).", 400);

  try {
    const lead = await getLeadForUser(id, guard.user);
    if (!lead) return jsonError("Lead não encontrado.", 404);
    // Lead na fila: o admin pode responder; colaborador nunca chega aqui sem ser o dono
    const sent = await callPonte<{ id: string }>("/enviar", { telefone: lead.phone, texto: text });
    if (!sent.ok) return jsonError(sent.error, sent.status === 503 ? 503 : sent.status);

    const now = new Date().toISOString();
    await transaction(async (tx) => {
      // Mesmo id que o eco da ponte vai trazer: chega depois e não duplica
      await tx.query(
        `INSERT INTO messages (lead_id, external_id, author, sent_by, body, sent_at, source, kind)
         VALUES ($1, $2, 'COLABORADOR', $3, $4, $5, 'WHATSAPP', 'texto')
         ON CONFLICT (lead_id, external_id) DO UPDATE SET sent_by = EXCLUDED.sent_by`,
        [lead.id, sent.data.id, guard.user.id, text, now]
      );
      await tx.query(
        `UPDATE leads SET last_message_text = left($2, 200), last_message_at = $3, last_message_from_client = false,
           unread_count = 0, agent_mode = 'humano', needs_attention = false, attention_reason = NULL,
           stage = CASE WHEN stage = 'NOVO' THEN 'ATENDIMENTO' ELSE stage END
         WHERE id = $1`,
        [lead.id, text, now]
      );
      if (lead.agent_mode === "ia") await logEvent(tx, lead.id, guard.user.id, "ATENDIMENTO", { modo: "humano" });
    });
    return NextResponse.json({ ok: true, id: sent.data.id });
  } catch (err) {
    return serverError(err, "enviar mensagem");
  }
}
