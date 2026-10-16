import type {
  Product,
  ProductListResponse,
  Budget,
  CreateBudgetBody,
  Order,
  Admin,
} from "./types.js";
import type {
  BrindeMeClient,
  ListProductsParams,
  CreateBudgetOptions,
  ListOrdersParams,
  OrderListResponse,
} from "./client.js";
import { ApiError, NetworkError } from "./errors.js";
import {
  mapProduct,
  mapOrder,
  mapBudget,
  mapAdmin,
  unwrapCollection,
  unwrapResource,
} from "./mappers.js";
import { config } from "../../config.js";
import { CircuitBreaker, CircuitOpenError } from "./circuitBreaker.js";
import { FileApiLogger, MemoryApiLogger, sanitizeUrl, type ApiLogger } from "./apiLogger.js";

export { CircuitOpenError } from "./circuitBreaker.js";

export interface HttpClientOptions {
  baseUrl: string;
  token: string;
  authScheme?: "bearer" | "header";
  authHeader?: string;
  timeoutMs?: number;
  maxRetries?: number;
  apiLogger?: ApiLogger;
  circuitBreaker?: CircuitBreaker;
  /** Espaça as chamadas deste cliente; vazio = sem limite. A API corta em 60/min por chave. */
  reqPorMinuto?: number;
  /** Retry-After acima disto devolve o 429 na hora em vez de segurar a conversa. */
  maxEsperaRetryMs?: number;
  relogio?: Relogio;
}

export interface Relogio {
  agora(): number;
  dormir(ms: number): Promise<void>;
}

const relogioReal: Relogio = { agora: () => Date.now(), dormir: (ms) => sleep(ms) };

/**
 * Caminhos dos endpoints, conferidos contra a spec OpenAPI em
 * https://api.brinde.me/docs.json e exercitados com a chave real.
 */
export const ENDPOINTS = {
  products: "/product",
  product: (id: string) => `/product/${encodeURIComponent(id)}`,
  budgets: "/budget",
  budget: (id: string) => `/budget/${encodeURIComponent(id)}`,
  orders: "/order",
  order: (id: string) => `/order/${encodeURIComponent(id)}`,
  admins: "/admin",
} as const;

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class HttpBrindeMeClient implements BrindeMeClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly authScheme: "bearer" | "header";
  private readonly authHeader: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly apiLogger: ApiLogger;
  private readonly intervaloMs: number;
  private readonly maxEsperaRetryMs: number;
  private readonly relogio: Relogio;
  private proximaVez = 0;
  readonly circuito: CircuitBreaker;

  constructor(options?: Partial<HttpClientOptions>) {
    const base = options?.baseUrl ?? config.brindeMe.baseUrl;
    const token = options?.token ?? config.brindeMe.token;

    if (!base) throw new Error("BRINDEME_BASE_URL não configurada");
    if (!token) throw new Error("BRINDEME_TOKEN não configurado");

    this.baseUrl = base.replace(/\/+$/, "");
    this.token = token;
    this.authScheme = options?.authScheme ?? config.brindeMe.authScheme;
    this.authHeader = options?.authHeader ?? config.brindeMe.authHeader;
    this.timeoutMs = options?.timeoutMs ?? config.brindeMe.timeoutMs;
    this.maxRetries = options?.maxRetries ?? config.brindeMe.maxRetries;
    this.apiLogger =
      options?.apiLogger ?? (config.brindeMe.logarChamadas ? new FileApiLogger() : new MemoryApiLogger());
    this.circuito = options?.circuitBreaker ?? new CircuitBreaker();
    const rpm = options?.reqPorMinuto ?? 0;
    this.intervaloMs = rpm > 0 ? 60_000 / rpm : 0;
    this.maxEsperaRetryMs = options?.maxEsperaRetryMs ?? config.brindeMe.maxEsperaRetryMs;
    this.relogio = options?.relogio ?? relogioReal;
  }

  /** Reserva a vez antes de esperar: chamadas paralelas ficam enfileiradas, não juntas. */
  private async aguardarVez(): Promise<void> {
    if (this.intervaloMs === 0) return;
    const agora = this.relogio.agora();
    const vez = Math.max(agora, this.proximaVez);
    this.proximaVez = vez + this.intervaloMs;
    if (vez > agora) await this.relogio.dormir(vez - agora);
  }

  private authHeaders(): Record<string, string> {
    return this.authScheme === "bearer"
      ? { Authorization: `Bearer ${this.token}` }
      : { [this.authHeader]: this.token };
  }

  private url(path: string, query?: Record<string, string | number | undefined>): string {
    const u = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  /**
   * Uma tentativa de request. Converte qualquer resposta não-2xx em ApiError e
   * qualquer falha de transporte em NetworkError, para translateApiError tratar.
   */
  private async once(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
    attempt = 0
  ): Promise<unknown> {
    await this.aguardarVez();
    const inicio = Date.now();
    const registrar = (status: number | undefined, error?: string) =>
      this.apiLogger.log({
        method,
        path: sanitizeUrl(url),
        status,
        duration_ms: Date.now() - inicio,
        attempt,
        error,
        circuito: this.circuito.estado,
      });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...this.authHeaders(),
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        registrar(408, "timeout");
        throw new ApiError(408, { message: `timeout após ${this.timeoutMs}ms` });
      }
      registrar(undefined, "network");
      throw new NetworkError("Falha de conexão com a API da loja", err);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text.slice(0, 500) };
      }
    }

    if (!response.ok) {
      // 412 sem descrição na spec: grava o corpo completo para diagnóstico.
      registrar(response.status, response.status === 412 ? `412 body=${text.slice(0, 1000)}` : "http");
      throw new ApiError(
        response.status,
        (parsed as object) ?? { message: response.statusText },
        lerRetryAfter(response.headers.get("retry-after"), this.relogio.agora())
      );
    }
    registrar(response.status);
    return parsed;
  }

  /**
   * Request com disjuntor + retry exponencial.
   * O retry só vale para métodos idempotentes — ver createBudget.
   */
  private async request(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
    retries = this.maxRetries
  ): Promise<unknown> {
    this.circuito.verificar();

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resultado = await this.once(method, url, body, extraHeaders, attempt);
        this.circuito.registrarSucesso();
        return resultado;
      } catch (err) {
        lastErr = err;
        this.circuito.registrarFalha(err);

        const retryable =
          err instanceof NetworkError ||
          (err instanceof ApiError && RETRYABLE_STATUS.has(err.status));
        if (!retryable || attempt === retries) throw err;

        // Não insiste se o disjuntor abriu no meio das tentativas.
        if (this.circuito.estado === "aberto") throw err;
        const pedida = err instanceof ApiError ? err.retryAfterMs : undefined;
        if (pedida !== undefined && pedida > this.maxEsperaRetryMs) throw err;
        await this.relogio.dormir(pedida ?? 2 ** attempt * 250);
      }
    }
    throw lastErr;
  }

  async listProducts(params?: ListProductsParams): Promise<ProductListResponse> {
    const payload = await this.request(
      "GET",
      this.url(ENDPOINTS.products, {
        per_page: params?.per_page,
        page: params?.page,
        order_param: params?.order_param,
        order_sort: params?.order_sort,
      })
    );
    const { items, paginacao } = unwrapCollection(payload);
    return {
      data: items.map(mapProduct),
      total: paginacao.total,
      per_page: paginacao.per_page,
      current_page: paginacao.current_page,
      last_page: paginacao.last_page,
    };
  }

  async getProduct(id: string): Promise<Product> {
    return mapProduct(unwrapResource(await this.request("GET", this.url(ENDPOINTS.product(id)))));
  }

  async createBudget(body: CreateBudgetBody, options?: CreateBudgetOptions): Promise<Budget> {
    // Sem retry, e isto NÃO é precaução: testado contra a API em 12/10/2026,
    // o header Idempotency-Key é ignorado e cada POST cria um orçamento novo.
    // Um retry aqui duplicaria de verdade.
    const headers = options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined;
    const payload = await this.request("POST", this.url(ENDPOINTS.budgets), body, headers, 0);
    return mapBudget(unwrapResource(payload));
  }

  async getBudget(id: string): Promise<Budget> {
    return mapBudget(unwrapResource(await this.request("GET", this.url(ENDPOINTS.budget(id)))));
  }

  async getOrder(id: string): Promise<Order> {
    return mapOrder(unwrapResource(await this.request("GET", this.url(ENDPOINTS.order(id)))));
  }

  async listOrders(params?: ListOrdersParams): Promise<OrderListResponse> {
    const payload = await this.request(
      "GET",
      this.url(ENDPOINTS.orders, {
        per_page: params?.per_page,
        page: params?.page,
        admin_id: params?.admin_id,
        admin_email: params?.admin_email,
        start_date: params?.start_date,
        end_date: params?.end_date,
      })
    );
    const { items, paginacao } = unwrapCollection(payload);
    return {
      data: items.map(mapOrder),
      total: paginacao.total,
      per_page: paginacao.per_page,
      current_page: paginacao.current_page,
      last_page: paginacao.last_page,
    };
  }

  async listAdmins(): Promise<Admin[]> {
    const { items } = unwrapCollection(await this.request("GET", this.url(ENDPOINTS.admins)));
    return items.map(mapAdmin);
  }

  /**
   * Checagem de acesso: confirma base URL, token e esquema de auth com o
   * endpoint mais barato disponível. Não lança — devolve o diagnóstico.
   */
  async validarAcesso(): Promise<
    | { ok: true; produtos: number }
    | { ok: false; status?: number; motivo: string }
  > {
    try {
      const r = await this.listProducts({ per_page: 1 });
      return { ok: true, produtos: r.total };
    } catch (err) {
      if (err instanceof ApiError) {
        const motivo =
          err.status === 401 || err.status === 403
            ? "token rejeitado ou esquema de auth errado"
            : err.status === 404
              ? "endpoint não encontrado — base URL ou caminho errado"
              : `HTTP ${err.status}`;
        return { ok: false, status: err.status, motivo };
      }
      if (err instanceof NetworkError) {
        return { ok: false, motivo: "não foi possível conectar — base URL ou rede" };
      }
      return { ok: false, motivo: String(err) };
    }
  }
}

/** Retry-After vem em segundos ou como data HTTP. */
function lerRetryAfter(valor: string | null, agora: number): number | undefined {
  if (!valor) return undefined;
  const segundos = Number(valor);
  if (Number.isFinite(segundos)) return Math.max(0, segundos * 1000);
  const data = Date.parse(valor);
  return Number.isNaN(data) ? undefined : Math.max(0, data - agora);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
