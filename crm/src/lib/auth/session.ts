import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { one } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "./token";
import type { Role } from "./token";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  jobTitle: string | null;
  mustChangePassword: boolean;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  job_title: string | null;
  is_active: boolean;
  must_change_password: boolean;
  session_version: number;
  password_hash: string;
}

/**
 * Usuário da sessão, conferido no banco a cada chamada: desativar alguém ou
 * trocar a senha (session_version) derruba as sessões abertas na hora.
 * O papel vem da tabela, nunca do token.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const row = await one<UserRow>(
    "SELECT id, name, email, role, job_title, is_active, must_change_password, session_version FROM users WHERE id = $1",
    [claims.sub]
  );
  if (!row || !row.is_active || row.session_version !== claims.v) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    jobTitle: row.job_title,
    mustChangePassword: row.must_change_password,
  };
}

const MIN_PASSWORD = 8;

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) return `A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`;
  if (password.length > 200) return "Senha longa demais.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use letras e números na senha.";
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 11);
}

// Hash fixo para comparar quando o e-mail não existe: o tempo de resposta não revela contas
let dummyHash: Promise<string> | null = null;

export async function checkCredentials(email: string, password: string): Promise<UserRow | null> {
  const row = await one<UserRow>(
    "SELECT id, name, email, role, job_title, is_active, must_change_password, session_version, password_hash FROM users WHERE lower(email) = lower($1)",
    [email.trim()]
  );
  dummyHash ??= bcrypt.hash("senha-que-nao-existe", 11);
  const ok = await bcrypt.compare(password, row?.password_hash ?? (await dummyHash));
  if (!row || !ok || !row.is_active) return null;
  return row;
}

export async function setSessionCookie(
  response: NextResponse,
  user: { id: string; role: Role; session_version: number; must_change_password: boolean }
) {
  const token = await signSession({ sub: user.id, role: user.role, v: user.session_version, pwd: user.must_change_password });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Gera uma senha provisória legível: troca obrigatória no primeiro acesso */
export function temporaryPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz";
  const bytes = randomBytes(10);
  const letters = Array.from(bytes.subarray(0, 6), (b) => alphabet[b % alphabet.length]).join("");
  const numbers = Array.from(bytes.subarray(6), (b) => String(b % 10)).join("");
  return `${letters[0].toUpperCase()}${letters.slice(1)}${numbers}`;
}
