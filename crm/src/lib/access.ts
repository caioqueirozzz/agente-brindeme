import { NextResponse } from "next/server";
import { clearSessionCookie, getSessionUser } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/auth/session";
import { one } from "@/lib/db";
import type { Lead } from "@/lib/types";

/*
 * Controle de acesso. Toda leitura de dado comercial passa por aqui.
 *
 * Regra única: ADMIN enxerga a operação inteira; COLABORADOR enxerga apenas
 * leads (e as conversas deles) atribuídos a ele. O escopo sai da sessão,
 * nunca de parâmetros da requisição, e um lead fora do escopo responde 404
 * (nem a existência dele vaza).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type Guard = { user: SessionUser; error?: never } | { user?: never; error: NextResponse };

/** Usuário ativo da sessão. Com troca de senha pendente, só as rotas de senha passam. */
export async function requireUser(options: { allowPendingPassword?: boolean } = {}): Promise<Guard> {
  const user = await getSessionUser();
  if (!user) {
    // Token com assinatura válida mas usuário inexistente/inativo/versão antiga: apagar o
    // cookie. Sem isso o proxy (que só confere a assinatura) mandava de /login de volta
    // ao portal, a API respondia 401 de novo, e a página entrava em loop.
    const response = jsonError("Sessão expirada. Entre novamente.", 401);
    clearSessionCookie(response);
    return { error: response };
  }
  if (user.mustChangePassword && !options.allowPendingPassword) {
    return { error: jsonError("Defina uma nova senha para continuar.", 403) };
  }
  return { user };
}

export async function requireAdmin(): Promise<Guard> {
  const guard = await requireUser();
  if (guard.error) return guard;
  if (guard.user.role !== "ADMIN") return { error: jsonError("Acesso restrito à administração.", 403) };
  return guard;
}

export const isAdmin = (user: Pick<SessionUser, "role">) => user.role === "ADMIN";

/**
 * Filtro SQL de leads para o usuário. Acrescenta o parâmetro em `params` e
 * devolve a condição (com o alias da tabela de leads).
 */
export function leadScope(user: SessionUser, params: unknown[], alias = "l"): string {
  if (isAdmin(user)) return "TRUE";
  params.push(user.id);
  return `${alias}.assigned_to = $${params.length}`;
}

export const LEAD_COLUMNS = `
  l.*, u.name AS assigned_name
`;

/** Lead, se o usuário puder vê-lo. */
export async function getLeadForUser(id: string, user: SessionUser): Promise<Lead | null> {
  if (!isUuid(id)) return null;
  const params: unknown[] = [id];
  const scope = leadScope(user, params);
  return one<Lead>(
    `SELECT ${LEAD_COLUMNS} FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = $1 AND ${scope}`,
    params
  );
}

/** Lê o corpo JSON sem estourar com corpo vazio ou inválido */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

export function serverError(err: unknown, context: string) {
  console.error(`${context}:`, err);
  return jsonError("Erro interno. Tente de novo em instantes.", 500);
}
