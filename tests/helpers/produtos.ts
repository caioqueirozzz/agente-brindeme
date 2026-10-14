import type {
  BrindeMeClient,
  ListProductsParams,
} from "../../src/integrations/brindeme/client.js";
import type {
  Product,
  ProductListResponse,
  Subproduct,
} from "../../src/integrations/brindeme/types.js";
import { ApiError } from "../../src/integrations/brindeme/errors.js";

/** [min, max, preço em reais] */
export type Faixa = [number, number, number];

export function sub(
  id: string,
  cor: string,
  estoque: number,
  faixas: Faixa[],
  status = true
): Subproduct {
  return {
    id,
    sku: `${id}-sku`,
    status,
    color: cor,
    stock: estoque,
    prices: faixas.map(([min, max, price]) => ({ min, max, price })),
  };
}

export interface OpcoesProduto {
  id: string;
  nome: string;
  min?: number;
  categoria?: string;
  descricao?: string;
  destaque?: boolean;
  ativo?: boolean;
  subprodutos?: Subproduct[];
  etiquetas?: string[];
  atualizadoEm?: string;
}

export function produto(o: OpcoesProduto): Product {
  const subprodutos = o.subprodutos ?? [sub(`${o.id}-a`, "Branco", 1000, [[1, 99999, 10]])];
  return {
    id: o.id,
    slug: o.nome.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    code: o.id,
    name: o.nome,
    sku: `SKU-${o.id}`,
    description: o.descricao ?? `${o.nome} personalizado para sua marca.`,
    tech_description: "",
    status: o.ativo ?? true,
    featured: o.destaque ?? false,
    stock: subprodutos.reduce((acc, s) => acc + s.stock, 0),
    price: subprodutos[0]?.prices[0]?.price ?? 0,
    min_quantity: o.min ?? 1,
    categories: o.categoria ? [{ id: `cat-${o.categoria}`, name: o.categoria }] : [],
    images: [{ url: `https://cdn.teste/${o.id}.jpg` }],
    customizations: [],
    subproducts: subprodutos,
    tags_ocasiao: o.etiquetas,
    updated_at: o.atualizadoEm,
    detalhe_carregado: true,
  };
}

/**
 * Cliente de catálogo em memória que imita a API real: a listagem é paginada e
 * NÃO traz subprodutos; só o detalhe traz. Permite falhar por produto e fazer a
 * API "ao vivo" divergir do índice (estoque que acabou depois da sincronização).
 */
export class ClienteCatalogoFalso implements BrindeMeClient {
  paginasListadas: number[] = [];
  detalhesLidos: string[] = [];
  emVooMaximo = 0;
  private emVoo = 0;

  /** id → erro a lançar no detalhe. */
  falhaNoDetalhe = new Map<string, unknown>();
  /** página (1-based) em que a listagem falha. */
  falhaNaPagina: number | null = null;
  /** Latência artificial do detalhe, para medir concorrência. */
  latenciaMs = 0;

  constructor(public produtos: Product[]) {}

  async listProducts(params?: ListProductsParams): Promise<ProductListResponse> {
    const perPage = params?.per_page ?? 100;
    const page = params?.page ?? 1;
    this.paginasListadas.push(page);
    if (this.falhaNaPagina === page) throw new ApiError(500, { message: "boom" });

    const fatia = this.produtos.slice((page - 1) * perPage, page * perPage);
    return {
      data: fatia.map((p) => ({
        ...p,
        subproducts: [],
        categories: [],
        images: [],
        customizations: [],
        min_quantity: 1,
        detalhe_carregado: false,
      })),
      total: this.produtos.length,
      per_page: perPage,
      current_page: page,
      last_page: Math.max(1, Math.ceil(this.produtos.length / perPage)),
    };
  }

  async getProduct(id: string): Promise<Product> {
    this.detalhesLidos.push(id);
    this.emVoo++;
    this.emVooMaximo = Math.max(this.emVooMaximo, this.emVoo);
    try {
      if (this.latenciaMs) await new Promise((r) => setTimeout(r, this.latenciaMs));
      const erro = this.falhaNoDetalhe.get(id);
      if (erro) throw erro;
      const p = this.produtos.find((x) => x.id === id);
      if (!p) throw new ApiError(404, { message: "not found" });
      return structuredClone(p);
    } finally {
      this.emVoo--;
    }
  }

  /** Altera o produto "ao vivo" sem o índice saber. */
  alterar(id: string, mudar: (p: Product) => void): void {
    const p = this.produtos.find((x) => x.id === id);
    if (!p) throw new Error(`produto ${id} não existe`);
    mudar(p);
  }

  async createBudget(): Promise<never> {
    throw new Error("não usado");
  }
  async getBudget(): Promise<never> {
    throw new Error("não usado");
  }
  async getOrder(): Promise<never> {
    throw new Error("não usado");
  }
  async listOrders(): Promise<never> {
    throw new Error("não usado");
  }
  async listAdmins(): Promise<never> {
    throw new Error("não usado");
  }
}
