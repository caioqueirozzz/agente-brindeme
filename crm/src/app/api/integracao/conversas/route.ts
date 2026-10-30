import { NextResponse } from "next/server";
import { jsonError } from "@/lib/access";
import { integrationAuthorized as authorized } from "@/lib/integration";
import { ingestConversation } from "@/lib/ingest";
import type { AgentConversation } from "@/lib/ingest";

export const maxDuration = 60;

/**
 * Recebe conversas do agente Lia (uma ou várias, no formato de
 * data/conversas/*.json). Usado por `npm run sync:agente` e, no futuro,
 * por um push direto da ponte do WhatsApp.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return jsonError("Não autorizado.", 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido.", 400);
  }
  const list = (Array.isArray(body) ? body : [body]) as AgentConversation[];
  if (list.length > 200) return jsonError("Envie no máximo 200 conversas por chamada.", 413);

  const results = [];
  for (const conversation of list) {
    if (!conversation?.estado?.telefone) {
      results.push({ ok: false, error: "sem estado.telefone" });
      continue;
    }
    try {
      results.push({ ok: true, ...(await ingestConversation(conversation)) });
    } catch (err) {
      console.error("integração:", err);
      results.push({ ok: false, telefone: conversation.estado.telefone, error: (err as Error).message });
    }
  }
  return NextResponse.json({ results });
}
