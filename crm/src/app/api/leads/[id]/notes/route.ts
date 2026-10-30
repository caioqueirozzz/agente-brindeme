import { NextResponse } from "next/server";
import { getLeadForUser, jsonError, readJson, requireUser, serverError } from "@/lib/access";
import { query } from "@/lib/db";
import { logEvent } from "@/lib/leads";

type Context = { params: Promise<{ id: string }> };

/** Nota interna no lead (não vai para o cliente). */
export async function POST(request: Request, { params }: Context) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const { id } = await params;
  const body = await readJson(request);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  if (!note) return jsonError("Escreva a nota.", 400);

  try {
    const lead = await getLeadForUser(id, guard.user);
    if (!lead) return jsonError("Lead não encontrado.", 404);
    await logEvent({ query }, id, guard.user.id, "NOTA", { texto: note });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return serverError(err, "nota do lead");
  }
}
