import { NextResponse } from "next/server";
import { isAdmin, requireUser, serverError } from "@/lib/access";
import { adminDashboard, sellerDashboard } from "@/lib/metrics";

export async function GET() {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  try {
    const data = isAdmin(guard.user) ? await adminDashboard(guard.user) : await sellerDashboard(guard.user);
    return NextResponse.json(data);
  } catch (err) {
    return serverError(err, "central do dia");
  }
}
