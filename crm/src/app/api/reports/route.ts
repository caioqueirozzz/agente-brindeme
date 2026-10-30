import { NextResponse } from "next/server";
import { requireUser, serverError } from "@/lib/access";
import { report } from "@/lib/metrics";

export async function GET(request: Request) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const days = Number(new URL(request.url).searchParams.get("dias"));
  try {
    return NextResponse.json(await report(guard.user, [7, 30, 90, 180, 365].includes(days) ? days : 30));
  } catch (err) {
    return serverError(err, "relatórios");
  }
}
