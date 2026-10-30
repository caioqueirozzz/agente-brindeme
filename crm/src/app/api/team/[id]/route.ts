import { NextResponse } from "next/server";
import { isUuid, jsonError, readJson, requireAdmin, serverError } from "@/lib/access";
import { hashPassword, temporaryPassword } from "@/lib/auth/session";
import { one, query, transaction } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

/**
 * Edita um acesso: dados, papel, meta, se recebe leads, ativo/inativo e
 * redefinição de senha. Desativar derruba as sessões e devolve os leads
 * abertos à fila de distribuição.
 */
export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Acesso não encontrado.", 404);
  const body = await readJson(request);

  try {
    const member = await one<{ id: string; role: string; is_active: boolean }>("SELECT id, role, is_active FROM users WHERE id = $1", [id]);
    if (!member) return jsonError("Acesso não encontrado.", 404);
    const self = id === guard.user.id;

    const sets: string[] = [];
    const values: unknown[] = [id];
    const set = (col: string, v: unknown) => {
      values.push(v);
      sets.push(`${col} = $${values.length}`);
    };

    if (typeof body.name === "string" && body.name.trim().length >= 2) set("name", body.name.trim().slice(0, 120));
    if ("job_title" in body) set("job_title", typeof body.job_title === "string" ? body.job_title.trim().slice(0, 80) || null : null);
    if ("phone" in body) set("phone", typeof body.phone === "string" ? body.phone.replace(/\D/g, "").slice(0, 15) || null : null);
    if ("monthly_goal" in body) {
      const g = Number(body.monthly_goal);
      set("monthly_goal", Number.isFinite(g) && g > 0 ? g : null);
    }
    if (typeof body.receives_leads === "boolean") set("receives_leads", body.receives_leads);

    let revoke = false;
    if (body.role === "ADMIN" || body.role === "COLABORADOR") {
      if (self && body.role !== "ADMIN") return jsonError("Você não pode remover o seu próprio acesso de admin.", 400);
      if (body.role !== member.role) {
        set("role", body.role);
        revoke = true;
      }
    }
    if (typeof body.is_active === "boolean" && body.is_active !== member.is_active) {
      if (self) return jsonError("Você não pode desativar o seu próprio acesso.", 400);
      set("is_active", body.is_active);
      if (!body.is_active) revoke = true;
    }

    let password: string | null = null;
    if (body.reset_password === true) {
      password = temporaryPassword();
      set("password_hash", await hashPassword(password));
      set("must_change_password", true);
      revoke = true;
    }
    if (revoke) sets.push("session_version = session_version + 1");
    if (sets.length === 0) return jsonError("Nada para atualizar.", 400);

    // Nunca deixar a empresa sem admin ativo
    if ((body.role === "COLABORADOR" || body.is_active === false) && member.role === "ADMIN") {
      const admins = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM users WHERE role = 'ADMIN' AND is_active AND id <> $1", [id]);
      if (!admins?.n) return jsonError("É preciso manter pelo menos um admin ativo.", 400);
    }

    let returned = 0;
    await transaction(async (tx) => {
      await tx.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, values);
      if (body.is_active === false) {
        const rows = await tx.query(
          "UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE assigned_to = $1 AND stage NOT IN ('GANHO','PERDIDO') RETURNING id",
          [id]
        );
        returned = rows.length;
        for (const r of rows as Array<{ id: string }>) {
          await tx.query("INSERT INTO lead_events (lead_id, user_id, type, data) VALUES ($1, $2, 'ATRIBUICAO', $3)", [
            r.id,
            guard.user.id,
            JSON.stringify({ para: null, motivo: "colaborador desativado" }),
          ]);
        }
      }
    });

    const [updated] = await query("SELECT id, name, email, role, is_active, receives_leads FROM users WHERE id = $1", [id]);
    return NextResponse.json({ member: updated, temporaryPassword: password, leadsReturned: returned });
  } catch (err) {
    return serverError(err, "editar acesso");
  }
}
