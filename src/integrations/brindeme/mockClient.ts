import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import type {
  Product,
  ProductListResponse,
  Budget,
  CreateBudgetBody,
  Order,
  Admin,
  FaultConfig,
  FaultType,
} from "./types.js";
import type {
  BrindeMeClient,
  ListProductsParams,
  CreateBudgetOptions,
  ListOrdersParams,
  OrderListResponse,
} from "./client.js";
import { ApiError } from "./errors.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const mocksDir = join(__dir, "../../../mocks");

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(mocksDir, filename), "utf-8")) as T;
}

let budgetCounter = 1040;

export class MockBrindeMeClient implements BrindeMeClient {
  private fault: FaultConfig | null = null;
  private budgetStore: Map<string, Budget> = new Map();
  private budgetsByIdempotencyKey: Map<string, Budget> = new Map();

  injectFault(fault: FaultConfig): void {
    this.fault = { ...fault };
  }

  private checkFault(): void {
    if (!this.fault || this.fault.remaining <= 0) {
      this.fault = null;
      return;
    }
    const type: FaultType = this.fault.type;
    this.fault.remaining -= 1;
    if (this.fault.remaining <= 0) this.fault = null;

    switch (type) {
      case "timeout":
        throw new ApiError(408, { message: "Request timeout" });
      case "500":
        throw new ApiError(500, { message: "Internal server error" });
      case "404":
        throw new ApiError(404, { message: "Not found" });
      case "412":
        throw new ApiError(412, { message: "Precondition failed" });
      case "422":
        throw new ApiError(422, {
          message: "Unprocessable entity",
          errors: { items: ["Invalid subproduct_id"] },
        });
    }
  }

  async listProducts(params?: ListProductsParams): Promise<ProductListResponse> {
    this.checkFault();
    const allProducts = loadJson<Product[]>("products.json");
    const perPage = params?.per_page ?? 20;
    const page = params?.page ?? 1;
    const data = allProducts.slice((page - 1) * perPage, page * perPage);
    return {
      data,
      total: allProducts.length,
      per_page: perPage,
      current_page: page,
      last_page: Math.max(1, Math.ceil(allProducts.length / perPage)),
    };
  }

  async getProduct(id: string): Promise<Product> {
    this.checkFault();
    const products = loadJson<Product[]>("products.json");
    const product = products.find((p) => p.id === id || p.slug === id);
    if (!product) throw new ApiError(404, { message: "Product not found" });
    return product;
  }

  async createBudget(body: CreateBudgetBody, options?: CreateBudgetOptions): Promise<Budget> {
    this.checkFault();

    // Idempotência no lado do "servidor" simulado, espelhando o que a API real deve fazer.
    if (options?.idempotencyKey) {
      const existente = this.budgetsByIdempotencyKey.get(options.idempotencyKey);
      if (existente) return existente;
    }

    const products = loadJson<Product[]>("products.json");

    const items = body.items.map((item) => {
      let found: { product: Product; sub: Product["subproducts"][0] } | null = null;
      for (const p of products) {
        const sub = p.subproducts.find((s) => s.id === item.subproduct_id);
        if (sub) {
          found = { product: p, sub };
          break;
        }
      }
      if (!found) throw new ApiError(422, { message: "Subproduct not found", errors: { subproduct_id: ["Invalid"] } });

      const priceRange = found.sub.prices.find(
        (r) => item.quantity >= r.min && item.quantity <= r.max
      );
      const unitPrice = priceRange?.price ?? found.product.price;
      return {
        subproduct_id: item.subproduct_id,
        quantity: item.quantity,
        unit_price: unitPrice,
        subtotal: unitPrice * item.quantity,
        product_name: found.product.name,
        color: found.sub.color,
      };
    });

    budgetCounter++;
    const code = `ORC-${budgetCounter}`;
    const id = uuidv4();
    const budget: Budget = {
      id,
      code,
      type: body.type,
      status_id: "1",
      status_name: "Aguardando mockup",
      customer_name: body.customer_name,
      customer_phone: body.customer_phone,
      customer_email: body.customer_email,
      items,
      comments: body.comments,
      admin_id: body.admin_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.budgetStore.set(id, budget);
    this.budgetStore.set(code, budget);
    if (options?.idempotencyKey) {
      this.budgetsByIdempotencyKey.set(options.idempotencyKey, budget);
    }
    return budget;
  }

  async getBudget(id: string): Promise<Budget> {
    this.checkFault();
    const budget = this.budgetStore.get(id);
    if (!budget) throw new ApiError(404, { message: "Budget not found" });
    return budget;
  }

  async getOrder(id: string): Promise<Order> {
    this.checkFault();
    const orders = loadJson<Order[]>("orders.json");
    const order = orders.find((o) => o.id === id || o.code === id);
    if (!order) throw new ApiError(404, { message: "Order not found" });
    return order;
  }

  async listOrders(params?: ListOrdersParams): Promise<OrderListResponse> {
    this.checkFault();
    const orders = loadJson<Order[]>("orders.json");
    const perPage = params?.per_page ?? 100;
    const page = params?.page ?? 1;
    const data = orders.slice((page - 1) * perPage, page * perPage);
    return {
      data,
      total: orders.length,
      per_page: perPage,
      current_page: page,
      last_page: Math.max(1, Math.ceil(orders.length / perPage)),
    };
  }

  async listAdmins(): Promise<Admin[]> {
    this.checkFault();
    return loadJson<Admin[]>("admins.json");
  }
}
