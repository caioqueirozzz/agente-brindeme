import { NextResponse } from "next/server";
import { requireUser, serverError } from "@/lib/access";
import { listConversations } from "@/lib/ia/store";

export async function GET() {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ conversations: await listConversations(guard.user.id) });
  } catch (err) {
    return serverError(err, "conversas da IA");
  }
}
