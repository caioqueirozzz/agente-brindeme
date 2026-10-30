import { SignJWT, jwtVerify } from "jose";

/*
 * Token da sessão (cookie httpOnly). Só depende de `jose`, então serve tanto
 * para o proxy quanto para as rotas. O proxy confia no token para rotear;
 * as rotas da API conferem também o usuário no banco (ativo, versão da sessão).
 */

export type Role = "ADMIN" | "COLABORADOR";

export const SESSION_COOKIE = "pe_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionClaims {
  sub: string;
  role: Role;
  /** users.session_version no momento do login */
  v: number;
  /** Troca de senha pendente */
  pwd?: boolean;
}

let warned = false;
function secret(): Uint8Array {
  let value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET ausente ou curto (mínimo 32 caracteres).");
    if (!warned) {
      console.warn("AUTH_SECRET ausente: usando segredo de desenvolvimento. Nunca use assim em produção.");
      warned = true;
    }
    value = "dev-only-secret-presentes-especiais-crm-000";
  }
  return new TextEncoder().encode(value);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, v: claims.v, ...(claims.pwd ? { pwd: true } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    if (payload.role !== "ADMIN" && payload.role !== "COLABORADOR") return null;
    return { sub: payload.sub, role: payload.role, v: Number(payload.v) || 0, pwd: payload.pwd === true };
  } catch {
    return null;
  }
}

/** Página inicial de cada papel */
export function homeFor(role: Role): string {
  return role === "ADMIN" ? "/admin/inicio" : "/app/inicio";
}
