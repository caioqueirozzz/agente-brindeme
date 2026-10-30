import { NextResponse } from "next/server";
import { requireUser } from "@/lib/access";

export async function GET() {
  const guard = await requireUser({ allowPendingPassword: true });
  if (guard.error) return guard.error;
  return NextResponse.json({ user: guard.user });
}
