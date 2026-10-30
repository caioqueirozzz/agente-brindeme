import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { jsonError, readJson, requireUser, serverError } from "@/lib/access";
import { hashPassword, passwordProblem, setSessionCookie } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/token";
import { one } from "@/lib/db";
import type { Role } from "@/lib/types";

/** Troca a própria senha (obrigatória no primeiro acesso). Derruba as outras sessões. */
export async function POST(request: Request) {
  const guard = await requireUser({ allowPendingPassword: true });
  if (guard.error) return guard.error;
  const body = await readJson(request);
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.password === "string" ? body.password : "";

  const problem = passwordProblem(next);
  if (problem) return jsonError(problem, 400);

  try {
    const row = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [guard.user.id]);
    if (!row || !(await bcrypt.compare(current, row.password_hash))) return jsonError("Senha atual incorreta.", 400);
    if (await bcrypt.compare(next, row.password_hash)) return jsonError("A nova senha precisa ser diferente da atual.", 400);

    const updated = await one<{ id: string; role: Role; session_version: number; must_change_password: boolean }>(
      `UPDATE users SET password_hash = $2, must_change_password = false, session_version = session_version + 1
       WHERE id = $1 RETURNING id, role, session_version, must_change_password`,
      [guard.user.id, await hashPassword(next)]
    );
    const response = NextResponse.json({ redirect: homeFor(updated!.role) });
    await setSessionCookie(response, updated!);
    return response;
  } catch (err) {
    return serverError(err, "troca de senha");
  }
}
