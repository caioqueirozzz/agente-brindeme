import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "@/lib/access";
import { callPonte } from "@/lib/whatsapp";

/** Desvincula o aparelho atual e gera um QR novo (só o admin). */
export async function POST() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const result = await callPonte("/nova-vinculacao", {});
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true });
}
