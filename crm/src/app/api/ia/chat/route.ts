import { NextResponse } from "next/server";
import { isUuid, jsonError, readJson, requireUser, serverError } from "@/lib/access";
import { askIa, IA_CONTEXT_MESSAGES, IA_MAX_LENGTH } from "@/lib/ia/assistant";
import { appendMessage, createConversation, getConversation, getMessages } from "@/lib/ia/store";

export const maxDuration = 120;

/**
 * Envia uma pergunta. Sem `conversation_id`, cria a conversa. O histórico vem
 * do banco (nunca do navegador), então ninguém injeta respostas falsas da IA.
 */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const user = guard.user;
  const body = await readJson(request);
  const content = typeof body.message === "string" ? body.message.trim() : "";
  if (!content || content.length > IA_MAX_LENGTH) return jsonError(`Escreva uma pergunta de até ${IA_MAX_LENGTH} caracteres.`, 400);

  try {
    let conversationId: string;
    if (body.conversation_id !== undefined && body.conversation_id !== null) {
      if (!isUuid(body.conversation_id) || !(await getConversation(body.conversation_id, user.id))) {
        return jsonError("Conversa não encontrada.", 404);
      }
      conversationId = body.conversation_id;
      await appendMessage(conversationId, "user", content);
    } else {
      conversationId = (await createConversation(user.id, content)).id;
    }

    const history = (await getMessages(conversationId, user.id))
      .slice(-IA_CONTEXT_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }));
    const answer = await askIa(user, history);
    const message = answer.available ? await appendMessage(conversationId, "assistant", answer.reply) : null;

    return NextResponse.json({
      conversation: await getConversation(conversationId, user.id),
      reply: answer.reply,
      available: answer.available,
      message,
    });
  } catch (err) {
    return serverError(err, "PresentesIA");
  }
}
