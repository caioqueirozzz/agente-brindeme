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
  order_param?: "name" | "sku" | "code" | "created_at" | "updated_at";
  order_sort?: "asc" | "desc";
}

export interface BrindeMeClient {
  listProducts(params?: ListProductsParams): Promise<ProductListResponse>;
  getProduct(id: string): Promise<Product>;
  createBudget(body: CreateBudgetBody): Promise<Budget>;
  getBudget(id: string): Promise<Budget>;
  getOrder(id: string): Promise<Order>;
  listAdmins(): Promise<Admin[]>;

  /** Only used by MockBrindeMeClient — ignored by HttpBrindeMeClient */
  injectFault?(fault: FaultConfig): void;
}
