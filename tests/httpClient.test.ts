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

describe("HttpBrindeMeClient — limite de 60 req/min da API", () => {
  beforeEach(() => { calls = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

  /** Relógio que não espera de verdade: anota cada espera e avança o tempo. */
  function relogioFalso() {
    let t = 1_000_000;
    const esperas: number[] = [];
    return {
      esperas,
      relogio: { agora: () => t, dormir: async (ms: number) => { esperas.push(ms); t += ms; } },
    };
  }

  function stubComHeaders(respostas: Array<{ status: number; headers?: Record<string, string> }>, instantes: number[] = [], agora = () => 0) {
    const fila = [...respostas];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      instantes.push(agora());
      calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers as Record<string, string> });
      const r = fila.shift() ?? { status: 200 };
      return new Response(JSON.stringify(r.status === 200 ? { data: { id: "p1", name: "X", status: true } } : { message: "Too Many Attempts." }), {
        status: r.status,
        headers: { "Content-Type": "application/json", ...r.headers },
      });
    });
  }

  it("429 com Retry-After: espera o que a API pediu e tenta de novo", async () => {
    stubComHeaders([{ status: 429, headers: { "Retry-After": "6" } }, { status: 200 }]);
    const { relogio, esperas } = relogioFalso();
    await client({ relogio }).getProduct("p1");
    expect(calls).toHaveLength(2);
    expect(esperas).toEqual([6000]);
  });

  it("Retry-After em formato de data também vale", async () => {
    const { relogio, esperas } = relogioFalso();
    const daqui3s = new Date(relogio.agora() + 3000).toUTCString();
    stubComHeaders([{ status: 429, headers: { "Retry-After": daqui3s } }, { status: 200 }]);
    await client({ relogio }).getProduct("p1");
    expect(esperas).toEqual([3000]);
  });

  it("Retry-After acima do teto: não segura a conversa, devolve o 429 na hora", async () => {
    stubComHeaders([{ status: 429, headers: { "Retry-After": "60" } }]);
    const { relogio, esperas } = relogioFalso();
    await expect(client({ relogio, maxEsperaRetryMs: 10_000 }).getProduct("p1")).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(1);
    expect(esperas).toEqual([]);
  });

  it("com reqPorMinuto, espaça as chamadas mesmo em paralelo", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const inicio = Date.now();
      const instantes: number[] = [];
      stubComHeaders([], instantes, () => Date.now() - inicio);
      const c = client({ reqPorMinuto: 30 });
      const todas = Promise.all([c.getProduct("a"), c.getProduct("b"), c.getProduct("c")]);
      await vi.advanceTimersByTimeAsync(5000);
      await todas;
      expect(instantes).toEqual([0, 2000, 4000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sem reqPorMinuto (cliente das conversas), não espera nada", async () => {
    stubComHeaders([]);
    const { relogio, esperas } = relogioFalso();
    const c = client({ relogio });
    await Promise.all([c.getProduct("a"), c.getProduct("b")]);
    expect(esperas).toEqual([]);
  });
});
