import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HttpBrindeMeClient } from "../src/integrations/brindeme/httpClient.js";
import { ApiError, translateApiError } from "../src/integrations/brindeme/errors.js";

const BASE = "https://api.exemplo.test";

interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

let calls: FakeCall[] = [];

/** Encadeia respostas: cada chamada consome a próxima da fila. */
function stubFetch(responses: Array<{ status: number; body?: unknown } | "network">) {
  const queue = [...responses];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    const next = queue.shift() ?? { status: 200, body: {} };
    if (next === "network") throw new TypeError("fetch failed");
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function client(overrides = {}) {
  return new HttpBrindeMeClient({
    baseUrl: BASE,
    token: "tok-123",
    timeoutMs: 500,
    maxRetries: 2,
    ...overrides,
  });
}

describe("HttpBrindeMeClient — autenticação", () => {
  beforeEach(() => { calls = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("envia X-Api-Key por padrão — esquema que o painel da loja especifica", async () => {
    stubFetch([{ status: 200, body: { data: [] } }]);
    await client().listProducts();
    expect(calls[0].headers["X-Api-Key"]).toBe("tok-123");
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("envia Authorization: Bearer quando authScheme=bearer", async () => {
    stubFetch([{ status: 200, body: { data: [] } }]);
    await client({ authScheme: "bearer" }).listProducts();
    expect(calls[0].headers.Authorization).toBe("Bearer tok-123");
    expect(calls[0].headers["X-Api-Key"]).toBeUndefined();
  });

  it("401 vira acesso_negado sem retry", async () => {
    stubFetch([{ status: 401, body: { message: "Unauthenticated" } }]);
    await expect(client().listProducts()).rejects.toThrow(ApiError);
    expect(calls).toHaveLength(1);
  });

  it("recusa construção sem base URL ou token", () => {
    expect(() => new HttpBrindeMeClient({ baseUrl: "", token: "x" })).toThrow(/BASE_URL/);
    expect(() => new HttpBrindeMeClient({ baseUrl: BASE, token: "" })).toThrow(/TOKEN/);
  });
});

describe("HttpBrindeMeClient — tratamento de falhas", () => {
  beforeEach(() => { calls = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("faz retry em 500 e tem sucesso na terceira tentativa", async () => {
    stubFetch([
      { status: 500, body: { message: "boom" } },
      { status: 500, body: { message: "boom" } },
      { status: 200, body: { data: [], pagination: { total: 0 } } },
    ]);
    const r = await client().listProducts();
    expect(calls).toHaveLength(3);
    expect(r.data).toEqual([]);
  });

  it("desiste após esgotar os retries e traduz para instabilidade", async () => {
    stubFetch([
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
    ]);
    try {
      await client().listProducts();
      expect.unreachable("deveria lançar");
    } catch (err) {
      const t = translateApiError(err);
      expect(t.erro).toBe("instabilidade");
      expect(t.tentar_novamente).toBe(true);
      expect(t.falha_api).toBe(true);
    }
  });

  it("não faz retry em 422 (erro de dados)", async () => {
    stubFetch([{ status: 422, body: { errors: { items: ["inválido"] } } }]);
    await expect(client().getProduct("p1")).rejects.toThrow(ApiError);
    expect(calls).toHaveLength(1);
  });

  it("falha de rede vira indisponivel e é retentada", async () => {
    stubFetch(["network", "network", "network"]);
    try {
      await client().listAdmins();
      expect.unreachable("deveria lançar");
    } catch (err) {
      expect(translateApiError(err).erro).toBe("indisponivel");
    }
    expect(calls).toHaveLength(3);
  });

  it("timeout vira ApiError 408 → timeout", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      // Simula o abort do AbortController sem esperar o timer real.
      await new Promise((_r, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        );
      });
      throw new Error("unreachable");
    });
    const c = new HttpBrindeMeClient({ baseUrl: BASE, token: "t", timeoutMs: 20, maxRetries: 0 });
    try {
      await c.getProduct("p1");
      expect.unreachable("deveria lançar");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(408);
      expect(translateApiError(err).erro).toBe("timeout");
    }
  });
});

describe("HttpBrindeMeClient — createBudget", () => {
  beforeEach(() => { calls = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

  const body = {
    type: "PF" as const,
    customer_name: "João",
    customer_phone: "5583999990000",
    customer_email: "joao@teste.com",
    items: [{ subproduct_id: "sub-1", quantity: 50 }],
  };

  it("NUNCA faz retry — um POST repetido duplicaria o orçamento", async () => {
    stubFetch([{ status: 500, body: {} }, { status: 200, body: { code: "ORC-1" } }]);
    await expect(client().createBudget(body)).rejects.toThrow(ApiError);
    expect(calls).toHaveLength(1);
  });

  it("manda a chave de idempotência no header", async () => {
    stubFetch([{ status: 201, body: { resource: { code: "ORC-1042" } } }]);
    const b = await client().createBudget(body, { idempotencyKey: "tok-abc" });
    expect(calls[0].headers["Idempotency-Key"]).toBe("tok-abc");
    expect(calls[0].method).toBe("POST");
    expect(b.code).toBe("ORC-1042");
  });
});

describe("HttpBrindeMeClient — envelope e query", () => {
  beforeEach(() => { calls = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("desembrulha { data: ... } em recurso único", async () => {
    stubFetch([{ status: 200, body: { data: { id: "p1", name: "Caneca" } } }]);
    const p = await client().getProduct("p1");
    expect(p.name).toBe("Caneca");
  });

  it("aceita recurso não envelopado", async () => {
    stubFetch([{ status: 200, body: { id: "p1", name: "Caneca" } }]);
    const p = await client().getProduct("p1");
    expect(p.name).toBe("Caneca");
  });

  it("repassa per_page/order_param/order_sort na query", async () => {
    stubFetch([{ status: 200, body: { data: [] } }]);
    await client().listProducts({ per_page: 50, order_param: "name", order_sort: "asc" });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/product");
    expect(url.searchParams.get("per_page")).toBe("50");
    expect(url.searchParams.get("order_param")).toBe("name");
    expect(url.searchParams.get("order_sort")).toBe("asc");
  });

  it("escapa o id no path", async () => {
    stubFetch([{ status: 200, body: {} }]);
    await client().getOrder("PED 001/2024");
    expect(calls[0].url).toContain("/order/PED%20001%2F2024");
  });
});

describe("validarAcesso", () => {
  beforeEach(() => { calls = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("ok quando a API responde", async () => {
    stubFetch([{ status: 200, body: { data: [{ id: "p1" }], pagination: { total: 7, per_page: 1, current_page: 1, last_page: 7 } } }]);
    expect(await client().validarAcesso()).toEqual({ ok: true, produtos: 7 });
  });

  it("aponta token/esquema de auth em 403", async () => {
    stubFetch([{ status: 403, body: {} }]);
    const r = await client().validarAcesso();
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect((r as { motivo: string }).motivo).toMatch(/token|auth/);
  });

  it("aponta base URL em 404", async () => {
    stubFetch([{ status: 404, body: {} }]);
    const r = await client().validarAcesso();
    expect((r as { motivo: string }).motivo).toMatch(/base URL|caminho/);
  });
});
