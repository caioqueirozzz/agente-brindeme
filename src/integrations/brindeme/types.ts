export interface PriceRange {
  min: number;
  max: number;
  price: number;
}

export interface Subproduct {
  id: string;
  sku: string;
  status: boolean;
  color: string;
  stock: number;
  prices: PriceRange[];
}

export interface ProductImage {
  url: string;
  alt?: string;
}

export interface Customization {
  type: string;
  description: string;
}

export interface Category {
  id: string;
  name: string;
  /** A API real devolve o rótulo legível também em `description` (ex.: "Canetas"). */
  description?: string;
}

export interface Product {
  id: string;
  slug: string;
  code: string;
  name: string;
  sku: string;
  description: string;
  tech_description: string;
  status: boolean;
  featured: boolean;
  stock: number;
  price: number;
  min_quantity: number;
  categories: Category[];
  images: ProductImage[];
  customizations: Customization[];
  subproducts: Subproduct[];
  /**
   * NOT from the API. Só os mocks trazem; na API real as etiquetas de ocasião
   * vêm da tabela mantida pela loja (src/knowledge/etiquetas-ocasiao.json).
   */
  tags_ocasiao?: string[];
  /** ISO. Base da sincronização incremental do índice de catálogo (Fase 3). */
  updated_at?: string;
  /**
   * false quando o produto veio de GET /product (listagem), que não traz
   * subproducts, min_quantity, images, categories nem customizations.
   */
  detalhe_carregado?: boolean;
}

export interface ProductListResponse {
  data: Product[];
  total: number;
  per_page: number;
  current_page: number;
  last_page?: number;
}

export interface BudgetItem {
  subproduct_id: string;
  quantity: number;
}

export interface CreateBudgetBody {
  type: "PF" | "PJ";
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  items: BudgetItem[];
  comments?: string;
  origin?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  admin_id?: string;
}

export interface Budget {
  id: string;
  code: string;
  type: "PF" | "PJ";
  /** UUID na API real — não número, apesar do nome. */
  status_id: string;
  status_name: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  items: BudgetItemDetail[];
  comments?: string;
  admin_id?: string;
  mockup_url?: string;
  created_at: string;
  updated_at: string;
}

export interface BudgetItemDetail {
  subproduct_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  product_name: string;
  color: string;
  /** Imagem do mockup gerada pela equipe da loja (product_mock_image_url). */
  mockup_url?: string;
}

export interface Order {
  id: string;
  code: string;
  /** UUID na API real — não número, apesar do nome. */
  status_id: string;
  status_name: string;
  budget_code: string;
  customer_name: string;
  customer_cpf: string;
  customer_email: string;
  customer_phone: string;
  shipping_type: string;
  /** null quando a loja ainda não definiu o frete do pedido. */
  shipping_time: number | null;
  subtotal: number;
  total: number;
  items: OrderItem[];
  file_url?: string;
  nfs?: string[];
  bankslips?: string[];
  created_at?: string;
}

export interface OrderItem {
  subproduct_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  product_name: string;
  color: string;
}

export interface Admin {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

export type FaultType = "timeout" | "500" | "404" | "412" | "422";

export interface FaultConfig {
  type: FaultType;
  remaining: number;
}
