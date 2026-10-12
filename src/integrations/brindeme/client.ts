import type {
  Product,
  ProductListResponse,
  Budget,
  CreateBudgetBody,
  Order,
  Admin,
  FaultConfig,
} from "./types.js";

export interface ListProductsParams {
  per_page?: number;
  /** A API pagina com ?page=N (visto em pagination.next_page_url). */
  page?: number;
  order_param?: "name" | "sku" | "code" | "created_at" | "updated_at";
  order_sort?: "asc" | "desc";
}

export interface ListOrdersParams {
  per_page?: number;
  page?: number;
  admin_id?: string;
  admin_email?: string;
  /** YYYY-MM-DD */
  start_date?: string;
  end_date?: string;
}

export interface OrderListResponse {
  data: Order[];
  total: number;
  per_page: number;
  current_page: number;
  last_page?: number;
}

export interface CreateBudgetOptions {
  /**
   * Chave de idempotência (o token de confirmação da conversa). Evita orçamento
   * duplicado quando a resposta falha mas a criação aconteceu do outro lado.
   */
  idempotencyKey?: string;
}

export interface BrindeMeClient {
  listProducts(params?: ListProductsParams): Promise<ProductListResponse>;
  getProduct(id: string): Promise<Product>;
  createBudget(body: CreateBudgetBody, options?: CreateBudgetOptions): Promise<Budget>;
  getBudget(id: string): Promise<Budget>;
  getOrder(id: string): Promise<Order>;
  /** Único jeito de achar pedido por código: listar a janela e filtrar. */
  listOrders(params?: ListOrdersParams): Promise<OrderListResponse>;
  listAdmins(): Promise<Admin[]>;

  /** Only used by MockBrindeMeClient — ignored by HttpBrindeMeClient */
  injectFault?(fault: FaultConfig): void;
}
