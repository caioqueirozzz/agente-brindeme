import { NextResponse } from "next/server";
import { jsonError, readJson, serverError } from "@/lib/access";
import { ingestLiveMessage } from "@/lib/ingest";
import { integrationAuthorized } from "@/lib/integration";

/** Uma mensagem vista pela ponte do WhatsApp agora (cliente, Lia ou equipe). */
export async function POST(request: Request) {
  if (!integrationAuthorized(request)) return jsonError("Não autorizado.", 401);
  const body = await readJson(request);
  const autor = body.autor;
  if (typeof body.id !== "string" || typeof body.telefone !== "string" || (autor !== "CLIENTE" && autor !== "AGENTE" && autor !== "ATENDENTE")) {
    return jsonError("Mensagem inválida.", 400);
  }
  try {
    const result = await ingestLiveMessage({
      id: body.id.slice(0, 200),
      telefone: body.telefone,
      autor,
      tipo: typeof body.tipo === "string" ? body.tipo : "texto",
      texto: typeof body.texto === "string" ? body.texto.slice(0, 8000) : "",
      timestamp: typeof body.timestamp === "string" ? body.timestamp : new Date().toISOString(),
    });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "integração de mensagem");
  }
}
