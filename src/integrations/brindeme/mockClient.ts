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
import type { BrindeMeClient, ListProductsParams } from "./client.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const mocksDir = join(__dir, "../../../mocks");

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(mocksDir, filename), "utf-8")) as T;
}

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: object
  ) {
    super(`HTTP ${status}`);
  }
}

let budgetCounter = 1040;

export class MockBrindeMeClient implements BrindeMeClient {
  private fault: FaultConfig | null = null;
  private budgetStore: Map<string, Budget> = new Map();
  private createdBudgetsByToken: Map<string, string> = new Map();

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
    const data = allProducts.slice(0, perPage);
    return {
      data,
      total: allProducts.length,
      per_page: perPage,
      current_page: 1,
    };
  }

  async getProduct(id: string): Promise<Product> {
    this.checkFault();
    const products = loadJson<Product[]>("products.json");
    const product = products.find((p) => p.id === id || p.slug === id);
    if (!product) throw new ApiError(404, { message: "Product not found" });
    return product;
  }

  async createBudget(body: CreateBudgetBody): Promise<Budget> {
    this.checkFault();
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
      status_id: 1,
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

  async listAdmins(): Promise<Admin[]> {
    this.checkFault();
    return loadJson<Admin[]>("admins.json");
  }

  /** Used by criarOrcamento for idempotency */
  getBudgetByToken(token: string): Budget | undefined {
    const id = this.createdBudgetsByToken.get(token);
    return id ? this.budgetStore.get(id) : undefined;
  }

  setBudgetToken(token: string, budgetId: string): void {
    this.createdBudgetsByToken.set(token, budgetId);
  }
}

export function translateApiError(err: unknown): {
  erro: string;
  tentar_novamente: boolean;
  detalhes?: string;
} {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 404:
        return { erro: "nao_encontrado", tentar_novamente: false };
      case 408:
        return { erro: "timeout", tentar_novamente: true };
      case 412:
        return { erro: "precondition_falhou", tentar_novamente: false, detalhes: "Verifique os dados enviados (erro 412 — detalhes pendentes na Fase 2)" };
      case 422:
        return { erro: "dados_invalidos", tentar_novamente: false, detalhes: JSON.stringify((err.body as { errors?: unknown }).errors) };
      case 500:
        return { erro: "instabilidade", tentar_novamente: true };
      default:
        return { erro: "erro_desconhecido", tentar_novamente: true };
    }
  }
  if (err instanceof Error && err.message.includes("timeout")) {
    return { erro: "timeout", tentar_novamente: true };
  }
  return { erro: "erro_desconhecido", tentar_novamente: true };
}
