import { NextResponse } from "next/server";
import { readJson, requireAdmin, serverError } from "@/lib/access";
import { query } from "@/lib/db";
import { getSettings, listSellers } from "@/lib/leads";

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ settings: await getSettings(), sellers: await listSellers() });
  } catch (err) {
    return serverError(err, "configurações");
  }
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const body = await readJson(request);
  try {
    if (body.distribution_mode === "MANUAL" || body.distribution_mode === "ROUND_ROBIN") {
      await query("UPDATE crm_settings SET distribution_mode = $1, updated_at = NOW() WHERE id", [body.distribution_mode]);
    }
    if (typeof body.distribute_only_qualified === "boolean") {
      await query("UPDATE crm_settings SET distribute_only_qualified = $1, updated_at = NOW() WHERE id", [body.distribute_only_qualified]);
    }
    return NextResponse.json({ settings: await getSettings() });
  } catch (err) {
    return serverError(err, "salvar configurações");
  }
}
