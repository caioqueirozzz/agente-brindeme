/*
 * Cliente do servidor de controle da ponte do WhatsApp (processo do agente, `npm run whatsapp`).
 * Só o servidor do Next fala com ela; o navegador passa pelas rotas /api/whatsapp/*.
 */

export type ConnectionState = "INICIANDO" | "QR" | "AUTENTICANDO" | "CONECTADO" | "RECONECTANDO" | "DESVINCULADO";

export interface PonteStatus {
  estado: ConnectionState;
  qr: string | null;
  telefone: string | null;
  nome: string | null;
  conectadoEm: string | null;
  ultimoErro: string | null;
}

const PONTE_URL = (process.env.PONTE_URL || "http://127.0.0.1:3040").replace(/\/$/, "");

export type PonteResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; offline: boolean };

export async function callPonte<T>(path: string, body?: unknown, timeoutMs = 20_000): Promise<PonteResult<T>> {
  const secret = process.env.CRM_INTEGRATION_SECRET ?? "";
  let res: Response;
  try {
    res = await fetch(`${PONTE_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "x-ponte-secret": secret },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, status: 503, error: "A ponte do WhatsApp não está rodando.", offline: true };
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: data as T };
  if (res.status === 401) {
    return { ok: false, status: 502, error: "A ponte recusou a chamada: CRM_INTEGRATION_SECRET precisa ser igual no .env do CRM e no do agente.", offline: false };
  }
  return { ok: false, status: res.status, error: (data as { erro?: string }).erro || "Erro na ponte do WhatsApp.", offline: false };
}

export type LiaModo = "ligada" | "teste" | "desligada";

export interface LiaMode {
  modo: LiaModo;
  /** Formato da ponte: com 55 e o nono dígito */
  numerosTeste: string[];
  atualizadoEm: string | null;
}
