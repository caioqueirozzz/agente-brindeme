/**
 * Traduz os payloads da API Brinde.me para os tipos internos do agente.
 *
 * A API real diverge dos mocks da Fase 1 em vários pontos; mapear na fronteira
 * mantém tools e mocks estáveis. Divergências tratadas aqui:
 *
 *   prices[].init_quantity/final_quantity  →  PriceRange.min/max
 *   subproduct.color  (objeto)             →  Subproduct.color (string)
 *   images[].image_url.original            →  ProductImage.url
 *   code (int)                             →  string
 *   valores monetários em centavos         →  reais (ver config.precoEmCentavos)
 *
 * Shapes de envelope observados na API (são quatro, diferentes entre si):
 *   GET  /product      → { data: [...], pagination: {...} }
 *   GET  /product/{id} → { data: {...} }
 *   GET  /order        → { data: { items: [...], pagination: {...} } }
 *   POST /budget       → { resource: {...} }
 */
import type {
  Product,
  Subproduct,
  PriceRange,
  ProductImage,
  Category,
  Customization,
  Order,
  OrderItem,
  Budget,
  BudgetItemDetail,
  Admin,
} from "./types.js";
import { config } from "../../config.js";

type Json = Record<string, unknown>;

const asArray = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strOrUndef = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v);
const bool = (v: unknown): boolean => v === true || v === "true" || v === 1 || v === "1";

/** A API tipa números ora como int, ora como string. */
export function num(v: unknown, fallback = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * Converte valor monetário da API para reais.
 * Evidência de que a API usa centavos: caneta a `price: 377` (R$ 3,77) e pedido
 * corporativo com `subtotal: 112650` (R$ 1.126,50). Controlado por env para o
 * caso de a loja confirmar o contrário.
 */
export function money(v: unknown): number {
  const raw = num(v);
  if (!config.brindeMe.precoEmCentavos) return raw;
  // Arredonda em centavos: 7860/100 dá 78.60000000000001 em float, e esse
  // número chegaria ao cliente pela boca do modelo.
  return Math.round(raw) / 100;
}

/** Centavos exatos: evita 0.1 + 0.2 aparecendo na conversa. */
export function arredondar(reais: number): number {
  return Math.round(reais * 100) / 100;
}

/** Extrai a URL de uma imagem: { image_url: { original, ... } } ou string direta. */
function imageUrl(img: unknown): string | null {
  if (!img) return null;
  if (typeof img === "string") return img;
  const o = img as Json;
  const iu = o.image_url;
  if (typeof iu === "string") return iu;
  if (iu && typeof iu === "object") {
    const urls = iu as Json;
    const first = urls.original ?? urls.large ?? urls.medium ?? urls.thumb;
    if (typeof first === "string") return first;
  }
  if (typeof o.url === "string") return o.url;
  return null;
}

export function mapPrices(raw: unknown): PriceRange[] {
  return asArray(raw).map((r) => ({
    min: num(r.init_quantity ?? r.min, 1),
    max: num(r.final_quantity ?? r.max, Number.MAX_SAFE_INTEGER),
    price: money(r.price),
  }));
}

export function mapSubproduct(raw: Json): Subproduct {
  const color = raw.color;
  const colorName =
    color && typeof color === "object"
      ? str((color as Json).name)
      : str(color);
  return {
    id: str(raw.id),
    sku: str(raw.sku),
    status: bool(raw.status),
    color: colorName,
    stock: num(raw.stock),
    prices: mapPrices(raw.prices),
  };
}

export function mapImages(raw: unknown): ProductImage[] {
  const out: ProductImage[] = [];
  for (const i of asArray(raw)) {
    const url = imageUrl(i);
    if (url) out.push({ url, alt: strOrUndef(i.alt) });
  }
  return out;
}

function mapCategories(raw: unknown): Category[] {
  return asArray(raw).map((c) => ({ id: str(c.id), name: str(c.name) }));
}

function mapCustomizations(raw: unknown): Customization[] {
  return asArray(raw).map((c) => ({
    type: str(c.type ?? c.name),
    description: str(c.description ?? c.name),
  }));
}

/**
 * `GET /product` (listagem) NÃO traz subproducts, min_quantity, images,
 * categories nem customizations — só `image` (uma só). Os campos ausentes
 * ficam vazios e `detalhe_carregado: false` sinaliza que falta buscar o detalhe.
 */
export function mapProduct(raw: Json): Product {
  const imagensDetalhe = mapImages(raw.images);
  const imagemListagem = imageUrl(raw.image);
  const temDetalhe = raw.subproducts !== undefined;

  return {
    id: str(raw.id),
    slug: str(raw.slug),
    code: str(raw.code),
    name: str(raw.name),
    sku: str(raw.sku),
    description: str(raw.description),
    tech_description: str(raw.tech_description),
    status: bool(raw.status),
    featured: bool(raw.featured),
    stock: num(raw.stock),
    price: money(raw.price),
    min_quantity: num(raw.min_quantity, 1),
    categories: mapCategories(raw.categories),
    images:
      imagensDetalhe.length > 0
        ? imagensDetalhe
        : imagemListagem
          ? [{ url: imagemListagem }]
          : [],
    customizations: mapCustomizations(raw.customizations),
    subproducts: asArray(raw.subproducts).map(mapSubproduct),
    detalhe_carregado: temDetalhe,
  };
}

export function mapAdmin(raw: Json): Admin {
  return {
    id: str(raw.id),
    name: str(raw.name),
    email: str(raw.email),
    phone: str(raw.phone),
  };
}

function mapOrderItem(raw: Json): OrderItem {
  return {
    subproduct_id: str(raw.subproduct_id),
    quantity: num(raw.quantity),
    unit_price: money(raw.price ?? raw.unit_price),
    subtotal: money(raw.total ?? raw.subtotal),
    product_name: str(raw.product_name),
    color: str(raw.color_name ?? raw.color),
  };
}

export function mapOrder(raw: Json): Order {
  return {
    id: str(raw.id),
    code: str(raw.code),
    status_id: str(raw.status_id),
    status_name: str(raw.status_name),
    budget_code: str(raw.budget_code),
    customer_name: str(raw.customer_name),
    customer_cpf: str(raw.customer_cpf),
    customer_email: str(raw.customer_email),
    customer_phone: str(raw.customer_phone),
    shipping_type: str(raw.shipping_type),
    shipping_time: raw.shipping_time === null ? null : num(raw.shipping_time),
    subtotal: money(raw.subtotal),
    total: money(raw.total),
    items: asArray(raw.items).map(mapOrderItem),
    file_url: strOrUndef(raw.file_url),
    nfs: asArray(raw.nfs).map(str),
    bankslips: asArray(raw.bankslips).map(str),
    created_at: str(raw.created_at),
  };
}

function mapBudgetItem(raw: Json): BudgetItemDetail {
  // O subproduto vem aninhado no item do orçamento.
  const sub = (raw.subproduct ?? {}) as Json;
  const color = sub.color;
  const quantity = num(raw.quantity);
  const unit = money(raw.price ?? raw.unit_price);
  return {
    subproduct_id: str(raw.subproduct_id),
    quantity,
    unit_price: unit,
    subtotal: raw.total !== undefined ? money(raw.total) : arredondar(unit * quantity),
    product_name: str(sub.product_name ?? sub.name ?? raw.product_name),
    color:
      color && typeof color === "object" ? str((color as Json).name) : str(raw.color_name ?? raw.color),
    mockup_url: strOrUndef(raw.product_mock_image_url),
    // `cost` (custo interno da loja) existe no payload e NUNCA é mapeado.
  };
}

export function mapBudget(raw: Json): Budget {
  // Diferente do pedido, o orçamento traz status, cliente e responsável
  // aninhados — não como campos planos.
  const status = (raw.status ?? {}) as Json;
  const customer = (raw.customer ?? {}) as Json;
  const admin = (raw.admin ?? {}) as Json;
  const company = (raw.billing_company ?? raw.company ?? {}) as Json;

  const itens = asArray(raw.items).map(mapBudgetItem);
  const mockup = itens.find((i) => i.mockup_url)?.mockup_url;

  return {
    id: str(raw.id),
    code: str(raw.code),
    type: (str(raw.type) === "PJ" ? "PJ" : "PF") as "PF" | "PJ",
    status_id: str(status.id ?? raw.status_id),
    status_name: str(status.name ?? raw.status_name),
    customer_name: str(
      customer.name ?? company.company_name ?? company.trade_name ?? raw.customer_name
    ),
    customer_phone: str(customer.phone ?? raw.customer_phone),
    customer_email: str(customer.email ?? raw.customer_email),
    items: itens,
    comments: strOrUndef(raw.comments),
    admin_id: strOrUndef(admin.id ?? raw.admin_id),
    mockup_url: mockup,
    created_at: str(raw.created_at),
    updated_at: str(raw.updated_at ?? raw.created_at),
  };
}

export interface Paginacao {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

/** Normaliza os quatro formatos de envelope da API. */
export function unwrapCollection(payload: unknown): { items: Json[]; paginacao: Paginacao } {
  const root = (payload ?? {}) as Json;
  const data = root.data;

  // /order → { data: { items: [...], pagination: {...} } }
  const container =
    data && typeof data === "object" && !Array.isArray(data) && "items" in (data as Json)
      ? (data as Json)
      : root;

  const items = Array.isArray(data)
    ? (data as Json[])
    : asArray((container as Json).items);

  const p = ((container as Json).pagination ?? root.pagination ?? {}) as Json;
  return {
    items,
    paginacao: {
      total: num(p.total, items.length),
      per_page: num(p.per_page, items.length),
      current_page: num(p.current_page, 1),
      last_page: num(p.last_page, 1),
    },
  };
}

/** Recurso único: { data: {...} } (GETs) ou { resource: {...} } (POST /budget). */
export function unwrapResource(payload: unknown): Json {
  const root = (payload ?? {}) as Json;
  const inner = root.data ?? root.resource;
  return (inner && typeof inner === "object" ? inner : root) as Json;
}
