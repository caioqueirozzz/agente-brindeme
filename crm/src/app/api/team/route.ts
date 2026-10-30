import { NextResponse } from "next/server";
import { jsonError, readJson, requireAdmin, requireUser, serverError } from "@/lib/access";
import { hashPassword, temporaryPassword } from "@/lib/auth/session";
import { one, query } from "@/lib/db";

/**
 * Equipe. Admin: lista completa. Colaborador: só nomes (para exibir quem
 * atende cada lead), sem e-mail, telefone, meta ou qualquer dado pessoal.
 */
export async function GET() {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  try {
    if (guard.user.role !== "ADMIN") {
      return NextResponse.json({ members: [] });
    }
    const members = await query(
      `SELECT u.id, u.name, u.email, u.role, u.job_title, u.phone, u.is_active, u.receives_leads, u.must_change_password,
         u.monthly_goal::float8 AS monthly_goal, u.last_login_at, u.created_at,
         (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to = u.id AND l.stage NOT IN ('GANHO','PERDIDO')) AS active_leads
       FROM users u ORDER BY u.is_active DESC, u.role, u.name`
    );
    return NextResponse.json({ members });
  } catch (err) {
    return serverError(err, "listar equipe");
  }
}

/** Libera o acesso de um colaborador (ou outro admin). Devolve a senha provisória uma única vez. */
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const body = await readJson(request);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 160) : "";
  const role = body.role === "ADMIN" ? "ADMIN" : "COLABORADOR";
  if (name.length < 2) return jsonError("Informe o nome.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("E-mail inválido.", 400);
  const goal = Number(body.monthly_goal);

  try {
    if (await one("SELECT 1 FROM users WHERE lower(email) = $1", [email])) return jsonError("Já existe um acesso com este e-mail.", 409);
    const password = temporaryPassword();
    const member = await one(
      `INSERT INTO users (name, email, password_hash, role, job_title, phone, monthly_goal, receives_leads, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, name, email, role`,
      [
        name,
        email,
        await hashPassword(password),
        role,
        typeof body.job_title === "string" ? body.job_title.trim().slice(0, 80) || null : null,
        typeof body.phone === "string" ? body.phone.replace(/\D/g, "").slice(0, 15) || null : null,
        Number.isFinite(goal) && goal > 0 ? goal : null,
        role === "COLABORADOR" && body.receives_leads !== false,
        guard.user.id,
      ]
    );
    return NextResponse.json({ member, temporaryPassword: password }, { status: 201 });
  } catch (err) {
    return serverError(err, "criar acesso");
  }
}
