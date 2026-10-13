import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "../src/integrations/brindeme/circuitBreaker.js";
import { HttpBrindeMeClient } from "../src/integrations/brindeme/httpClient.js";
import { MemoryApiLogger, sanitizeUrl } from "../src/integrations/brindeme/apiLogger.js";
import { ApiError, NetworkError, translateApiError } from "../src/integrations/brindeme/errors.js";

describe("CircuitBreaker", () => {
  let agora = 0;
  const breaker = () =>
    new CircuitBreaker({ limiteFalhas: 3, cooldownMs: 60_000, agora: () => agora });

  beforeEach(() => { agora = 1_000_000; });

  it("abre após 3 falhas de infraestrutura seguidas", () => {
    const c = breaker();
    c.registrarFalha(new ApiError(500, {}));
    c.registrarFalha(new ApiError(500, {}));
    expect(c.estado).toBe("fechado");
    c.registrarFalha(new ApiError(503, {}));
    expect(c.estado).toBe("aberto");
  });

  it("aberto rejeita na hora, sem chamar a API", () => {
    const c = breaker();
    for (let i = 0; i < 3; i++) c.registrarFalha(new NetworkError("fora"));
    expect(() => c.verificar()).toThrow(CircuitOpenError);
  });

  it("vai a meio_aberto depois do cooldown", () => {
    const c = breaker();
    for (let i = 0; i < 3; i++) c.registrarFalha(new ApiError(500, {}));
    expect(c.estado).toBe("aberto");
    agora += 60_001;
    expect(c.estado).toBe("meio_aberto");
    expect(() => c.verificar()).not.toThrow();
  });

  it("401 abre na hora — chave inválida não melhora com insistência", () => {
    const c = breaker();
    c.registrarFalha(new ApiError(401, {}));
    expect(c.estado).toBe("aberto");
  });

  it("403 abre na hora", () => {
    const c = breaker();
    c.registrarFalha(new ApiError(403, {}));
    expect(c.estado).toBe("aberto");
  });

  it("404 e 422 NÃO contam — são respostas válidas, a API está de pé", () => {
    const c = breaker();
    c.registrarFalha(new ApiError(404, {}));
    c.registrarFalha(new ApiError(422, {}));
    c.registrarFalha(new ApiError(404, {}));
    c.registrarFalha(new ApiError(422, {}));
    expect(c.estado).toBe("fechado");
  });

  it("sucesso zera a contagem", () => {
    const c = breaker();
    c.registrarFalha(new ApiError(500, {}));
    c.registrarFalha(new ApiError(500, {}));
    c.registrarSucesso();
    c.registrarFalha(new ApiError(500, {}));
    expect(c.estado).toBe("fechado");
  });
});

describe("tabela de tratamento de falhas da Fase 2", () => {
  it("401/403 → transferir imediato + alerta", () => {
    for (const status of [401, 403]) {
      const t = translateApiError(new ApiError(status, {}));
      expect(t.erro).toBe("acesso_negado");
      expect(t.transferir_imediato).toBe(true);
      expect(t.alerta).toBe(true);
      expect(t.tentar_novamente).toBe(false);
    }
  });

  it("412 é validação de parâmetro (confirmado contra a API), não precondição", () => {
    // Corpo real: {"message":"O campo per page deve ser um número inteiro."}
    const t = translateApiError(
      new ApiError(412, { message: "O campo per page deve ser um número inteiro." })
    );
    expect(t.erro).toBe("parametro_invalido");
    expect(t.transferir_imediato).toBe(true);
    expect(t.alerta).toBe(true);
    expect(t.detalhes).toContain("per page");
  });

  it("422 → pedir correção do dado, sem transferir", () => {
    const t = translateApiError(new ApiError(422, { errors: { email: ["inválido"] } }));
    expect(t.erro).toBe("dados_invalidos");
    expect(t.transferir_imediato).toBeUndefined();
    expect(t.detalhes).toContain("email");
  });

  it("404 → conferir o código, sem transferir", () => {
    const t = translateApiError(new ApiError(404, {}));
    expect(t.erro).toBe("nao_encontrado");
    expect(t.transferir_imediato).toBeUndefined();
  });

  it("timeout e 5xx → nova tentativa", () => {
    expect(translateApiError(new ApiError(408, {})).tentar_novamente).toBe(true);
    expect(translateApiError(new ApiError(500, {})).tentar_novamente).toBe(true);
    expect(translateApiError(new ApiError(503, {})).tentar_novamente).toBe(true);
  });

  it("disjuntor aberto → serviço indisponível + transferir", () => {
    const t = translateApiError(new CircuitOpenError(45_000));
    expect(t.erro).toBe("servico_indisponivel");
    expect(t.transferir_imediato).toBe(true);
    expect(t.detalhes).toContain("45s");
  });
});

describe("log de chamadas à API", () => {
  let calls = 0;
  afterEach(() => { vi.unstubAllGlobals(); });

  it("não grava a chave da API nem valores de query", () => {
    const url = "https://api.brinde.me/product?per_page=100&order_param=name";
    expect(sanitizeUrl(url)).toBe("/product?order_param&per_page");
    expect(sanitizeUrl(url)).not.toContain("100");
  });

  it("registra método, caminho, status e duração de cada tentativa", async () => {
    calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    const apiLogger = new MemoryApiLogger();
    const SEGREDO = "bm_chave_secreta_123";
    const c = new HttpBrindeMeClient({ baseUrl: "https://x.test", token: SEGREDO, apiLogger });
    await c.listProducts({ per_page: 10 });

    expect(apiLogger.entries).toHaveLength(1);
    const e = apiLogger.entries[0];
    expect(e.method).toBe("GET");
    expect(e.path).toBe("/product?per_page");
    expect(e.status).toBe(200);
    expect(typeof e.duration_ms).toBe("number");
    expect(JSON.stringify(e)).not.toContain(SEGREDO);
  });

  it("uma entrada por tentativa de retry", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      return new Response("{}", { status: n < 3 ? 500 : 200 });
    });
    const apiLogger = new MemoryApiLogger();
    const c = new HttpBrindeMeClient({ baseUrl: "https://x.test", token: "t", apiLogger, maxRetries: 2 });
    await c.listProducts();
    expect(apiLogger.entries.map((e) => e.status)).toEqual([500, 500, 200]);
    expect(apiLogger.entries.map((e) => e.attempt)).toEqual([0, 1, 2]);
  });

  it("grava o corpo completo do 412, que a spec não descreve", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ message: "precondition", pista: "campo X" }), { status: 412 })
    );
    const apiLogger = new MemoryApiLogger();
    const c = new HttpBrindeMeClient({ baseUrl: "https://x.test", token: "t", apiLogger, maxRetries: 0 });
    await expect(c.listProducts()).rejects.toThrow(ApiError);
    expect(apiLogger.entries[0].error).toContain("pista");
  });
});

describe("disjuntor no cliente HTTP", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("para de chamar a API depois que abre", async () => {
    let chamadas = 0;
    vi.stubGlobal("fetch", async () => {
      chamadas++;
      return new Response("{}", { status: 500 });
    });
    const c = new HttpBrindeMeClient({
      baseUrl: "https://x.test",
      token: "t",
      maxRetries: 3,
      apiLogger: new MemoryApiLogger(),
      circuitBreaker: new CircuitBreaker({ limiteFalhas: 2, cooldownMs: 60_000 }),
    });

    await expect(c.listProducts()).rejects.toThrow();
    const depoisDaPrimeira = chamadas;

    // Segunda chamada nem sai: o disjuntor já abriu.
    await expect(c.listProducts()).rejects.toThrow(CircuitOpenError);
    expect(chamadas).toBe(depoisDaPrimeira);
    expect(c.circuito.estado).toBe("aberto");
  });

  it("401 abre na primeira falha e desativa as chamadas seguintes", async () => {
    let chamadas = 0;
    vi.stubGlobal("fetch", async () => {
      chamadas++;
      return new Response("{}", { status: 401 });
    });
    const c = new HttpBrindeMeClient({
      baseUrl: "https://x.test",
      token: "ruim",
      apiLogger: new MemoryApiLogger(),
    });
    await expect(c.listProducts()).rejects.toThrow(ApiError);
    expect(chamadas).toBe(1);
    await expect(c.getProduct("p1")).rejects.toThrow(CircuitOpenError);
    expect(chamadas).toBe(1);
  });
});
