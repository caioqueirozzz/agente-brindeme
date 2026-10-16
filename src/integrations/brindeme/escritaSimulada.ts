import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";
import { gravarArquivoAtomico, lerArquivo } from "../../util/arquivo.js";
import { ApiError } from "./errors.js";
import type {
  BrindeMeClient,
  CreateBudgetOptions,
  ListOrdersParams,
  ListProductsParams,
  OrderListResponse,
} from "./client.js";
import type { Admin, Budget, CreateBudgetBody, Order, Product, ProductListResponse } from "./types.js";

export const STATUS_TESTE = "TESTE — simulado, não foi enviado à loja";

export class EscritaSimuladaClient implements BrindeMeClient {
  private readonly simulados = new Map<string, Budget>();
  private sequencia = 0;

  /** Com arquivo, o orçamento TESTE continua consultável depois de reiniciar o agente. */
  constructor(
    private readonly real: BrindeMeClient,
    private readonly arquivo?: string
  ) {
    if (!arquivo) return;
    try {
      const salvos = JSON.parse(lerArquivo(resolve(arquivo)) ?? "[]") as Budget[];
      for (const b of salvos) this.simulados.set(b.id, b);
    } catch {
      // arquivo ilegível: os TESTE antigos deixam de ser consultáveis, nada mais
    }
  }

  listProducts(params?: ListProductsParams): Promise<ProductListResponse> {
    return this.real.listProducts(params);
  }

  getProduct(id: string): Promise<Product> {
    return this.real.getProduct(id);
  }

  getOrder(id: string): Promise<Order> {
    return this.real.getOrder(id);
  }

  listOrders(params?: ListOrdersParams): Promise<OrderListResponse> {
    return this.real.listOrders(params);
  }

  listAdmins(): Promise<Admin[]> {
    return this.real.listAdmins();
  }

  async createBudget(body: CreateBudgetBody, _options?: CreateBudgetOptions): Promise<Budget> {
    const agora = new Date().toISOString();
    const budget: Budget = {
      id: `teste-${uuidv4()}`,
      code: `TESTE-${Date.now().toString(36).toUpperCase()}${++this.sequencia}`,
      type: body.type,
      status_id: "teste",
      status_name: STATUS_TESTE,
      customer_name: body.customer_name,
      customer_phone: body.customer_phone,
      customer_email: body.customer_email,
      items: body.items.map((i) => ({
        subproduct_id: i.subproduct_id,
        quantity: i.quantity,
        unit_price: 0,
        subtotal: 0,
        product_name: "",
        color: "",
      })),
      comments: body.comments,
      created_at: agora,
      updated_at: agora,
    };
    this.simulados.set(budget.id, budget);
    if (this.arquivo) gravarArquivoAtomico(resolve(this.arquivo), JSON.stringify([...this.simulados.values()]));
    return budget;
  }

  async getBudget(id: string): Promise<Budget> {
    const simulado = this.simulados.get(id);
    if (simulado) return simulado;
    // Id de TESTE nunca vai à loja: lá ele não existe e a consulta só gastaria uma chamada.
    if (id.startsWith("teste-")) throw new ApiError(404, { message: "orçamento de teste não encontrado" });
    return this.real.getBudget(id);
  }
}
