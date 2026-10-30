import { NextResponse } from "next/server";
import { isUuid, readJson, requireUser, serverError } from "@/lib/access";
import { query } from "@/lib/db";

export async function GET() {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  try {
    const notifications = await query(
      "SELECT id, title, message, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30",
      [guard.user.id]
    );
    return NextResponse.json({ notifications });
  } catch (err) {
    return serverError(err, "notificações");
  }
}

/** Marca como lida: `{ id }` ou `{ all: true }` (sempre só as do próprio usuário) */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const body = await readJson(request);
  try {
    if (body.all === true) {
      await query("UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL", [guard.user.id]);
    } else if (isUuid(body.id)) {
      await query("UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2", [body.id, guard.user.id]);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "notificações");
  }
}
