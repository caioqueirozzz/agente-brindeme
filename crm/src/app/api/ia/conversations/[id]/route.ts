import { NextResponse } from "next/server";
import { isUuid, jsonError, requireUser, serverError } from "@/lib/access";
import { deleteConversation, getConversation, getMessages } from "@/lib/ia/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Conversa não encontrada.", 404);
  try {
    const conversation = await getConversation(id, guard.user.id);
    if (!conversation) return jsonError("Conversa não encontrada.", 404);
    return NextResponse.json({ conversation, messages: await getMessages(id, guard.user.id) });
  } catch (err) {
    return serverError(err, "conversa da IA");
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Conversa não encontrada.", 404);
  try {
    await deleteConversation(id, guard.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "apagar conversa da IA");
  }
}
