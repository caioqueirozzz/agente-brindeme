import { NextResponse } from "next/server";
import { jsonError, readJson, requireAdmin } from "@/lib/access";
import { callPonte } from "@/lib/whatsapp";
import type { LiaMode } from "@/lib/whatsapp";

/** Modo de atendimento da Lia (ligada, teste, desligada), guardado pela ponte. Só o admin. */
export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const result = await callPonte<LiaMode>("/lia", undefined, 8_000);
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json(result.data);
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const body = await readJson(request);
  const result = await callPonte<LiaMode>("/lia", { modo: body.modo, numerosTeste: body.numerosTeste });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json(result.data);
}
