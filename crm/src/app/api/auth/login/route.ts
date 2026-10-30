import { NextResponse } from "next/server";
import { jsonError, readJson, serverError } from "@/lib/access";
import { checkCredentials, setSessionCookie } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/token";
import { query } from "@/lib/db";

// Freio simples contra força bruta, por e-mail (memória do processo)
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 6;
const LOCK_MS = 10 * 60_000;

export async function POST(request: Request) {
  const body = await readJson(request);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return jsonError("Informe e-mail e senha.", 400);

  const lock = attempts.get(email);
  if (lock && lock.count >= MAX_ATTEMPTS && lock.until > Date.now()) {
    return jsonError("Muitas tentativas. Aguarde alguns minutos e tente de novo.", 429);
  }

  try {
    const user = await checkCredentials(email, password);
    if (!user) {
      const current = attempts.get(email);
      attempts.set(email, { count: (current && current.until > Date.now() ? current.count : 0) + 1, until: Date.now() + LOCK_MS });
      return jsonError("E-mail ou senha incorretos.", 401);
    }
    attempts.delete(email);
    await query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
    const response = NextResponse.json({
      redirect: user.must_change_password ? "/trocar-senha" : homeFor(user.role),
    });
    await setSessionCookie(response, user);
    return response;
  } catch (err) {
    return serverError(err, "login");
  }
}
