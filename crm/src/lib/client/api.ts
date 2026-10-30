"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Chamadas às rotas /api do próprio CRM. Sessão expirada (401) volta para o
 * login; troca de senha pendente (403 com essa mensagem) vai para a troca.
 */

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let redirecting = false;

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !redirecting) {
    // Um redirecionamento só, mesmo com várias chamadas falhando juntas. A resposta
    // 401 já apagou o cookie, então o /login não devolve para o portal.
    redirecting = true;
    window.location.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!res.ok) throw new ApiError(data.error || "Algo deu errado. Tente de novo.", res.status);
  return data as T;
}

/** GET com estado de carregamento, recarga manual e, opcionalmente, atualização periódica */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const current = useRef(path);
  current.current = path;

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const result = await api<T>(path);
      if (current.current === path) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (current.current === path) setError((err as Error).message);
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(Boolean(path));
    reload();
    if (!refreshMs || !path) return;
    const timer = setInterval(() => {
      if (!document.hidden) reload();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [path, refreshMs, reload]);

  return { data, error, loading, reload, setData };
}
