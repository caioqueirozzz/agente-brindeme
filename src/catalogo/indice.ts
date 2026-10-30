/**
 * Índice local do catálogo (Fase 3).
 *
 * `GET /product` não tem busca por texto, categoria ou preço — só listagem
 * paginada — e a listagem nem traz subprodutos, estoque ou quantidade mínima.
 * O job `sincronizarCatalogo` lê a listagem, busca o detalhe dos produtos
 * ativos e grava o que a recomendação precisa para filtrar e ordenar sem
 * perguntar nada à API.
 *
 * O índice é só um filtro de candidatos: preço e estoque que chegam ao cliente
 * são sempre reconferidos em `GET /product/{id}` (ver recomendar.ts).
 *
 * Mesmo desenho do índice de pedidos da Fase 2: arquivo JSON agora, interface
 * `ProductIndexStore` para a Fase 5 trocar por Supabase sem tocar na lógica.
 */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import type { Product } from "../integrations/brindeme/types.js";
import { removerHtml } from "../busca/texto.js";
import { arredondar } from "../integrations/brindeme/mappers.js";
import { config } from "../config.js";

const __dir = dirname(fileURLToPath(import.meta.url));

export const VERSAO_INDICE = 1;
/** Quantas sincronizações completas seguidas um produto pode faltar na listagem antes de sair do índice. */
const AUSENCIAS_PARA_REMOVER = 2;
const LIMITE_DESCRICAO = 600;

export interface FaixaPreco {
  min: number;
  max: number;
  /** Reais. */
  preco: number;
}

export interface SubprodutoIndexado {
  id: string;
  sku: string;
  cor: string;
  estoque: number;
  faixas: FaixaPreco[];
}

/**
 * Só o necessário para recomendar. Não há custo da loja, CPF nem nada de
 * pedido aqui; `cost` dos itens de orçamento nunca passa pelo mapper.
 */
export interface ProdutoIndexado {
  id: string;
  slug: string;
  codigo: string;
  sku: string;
  nome: string;
  descricao: string;
  categorias: string[];
  destaque: boolean;
  quantidade_minima: number;
  imagem_url: string | null;
  personalizacoes: string[];
  /** Apenas subprodutos ativos. */
  subprodutos: SubprodutoIndexado[];
  /** Etiquetas de ocasião que vieram junto do produto (só os mocks). */
  etiquetas_embutidas: string[];
  /** `updated_at` da API; vazio quando a API não informa. */
  atualizado_em: string;
  sincronizado_em: string;
  /** Sincronizações completas seguidas em que o produto não apareceu na listagem. */
  ausencias: number;
}

export interface IndiceCatalogo {
  versao: number;
  sincronizado_em: string;
  /** false quando a última listagem foi cortada antes do fim (maxPaginas). */
  completo: boolean;
  produtos: ProdutoIndexado[];
}

export function indiceVazio(): IndiceCatalogo {
  return { versao: VERSAO_INDICE, sincronizado_em: "", completo: false, produtos: [] };
}

export interface ProductIndexStore {
  /**
   * Devolve a MESMA referência enquanto o conteúdo não mudar — o motor de busca
   * guarda o índice BM25 por referência para não reconstruí-lo a cada pergunta.
   */
  carregar(): IndiceCatalogo;
  salvar(indice: IndiceCatalogo): void;
}

/** O mock grava produtos de teste: nunca no mesmo arquivo do catálogo real. */
export function arquivoIndicePadrao(modo: "mock" | "http"): string {
  return join(__dir, "../../data", modo === "http" ? "produtos-index.json" : "produtos-index-mock.json");
}

export class FileProductIndexStore implements ProductIndexStore {
  private cache: IndiceCatalogo | null = null;
  private assinatura = "";

  constructor(private readonly file = arquivoIndicePadrao(config.brindeMe.mode)) {}

  private assinar(): string {
    if (!existsSync(this.file)) return "ausente";
    const st = statSync(this.file);
    return `${st.mtimeMs}:${st.size}`;
  }

  carregar(): IndiceCatalogo {
    const atual = this.assinar();
    if (this.cache && atual === this.assinatura) return this.cache;

    let indice = indiceVazio();
    if (atual !== "ausente") {
      try {
        const raw = JSON.parse(readFileSync(this.file, "utf-8")) as IndiceCatalogo;
        if (raw && raw.versao === VERSAO_INDICE && Array.isArray(raw.produtos)) indice = raw;
      } catch {
        // arquivo truncado ou ilegível: trata como índice vazio; o próximo sync reescreve.
      }
    }
    this.cache = indice;
    this.assinatura = atual;
    return indice;
  }

  salvar(indice: IndiceCatalogo): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(indice), "utf-8");
    try {
      renameSync(tmp, this.file);
    } catch {
      // Windows: rename falha se outro processo (o chat) estiver com o arquivo aberto.
      writeFileSync(this.file, JSON.stringify(indice), "utf-8");
    }
    this.cache = null;
  }
}

export class MemoryProductIndexStore implements ProductIndexStore {
  constructor(private indice: IndiceCatalogo = indiceVazio()) {}
  carregar(): IndiceCatalogo {
    return this.indice;
  }
  salvar(indice: IndiceCatalogo): void {
    this.indice = indice;
  }
}

// ---------------------------------------------------------------------------
// Product (API) → registro do índice
// ---------------------------------------------------------------------------

/**
 * Converte o detalhe do produto em registro. Mesma função na sincronização e na
 * revalidação ao vivo, para os dois caminhos nunca discordarem sobre o que
 * "preço da faixa" ou "cor disponível" significam.
 */
export function construirRegistro(
  p: Product,
  agora: Date,
  etiquetasEmbutidas: string[] = []
): ProdutoIndexado {
  const categorias = [
    ...new Set(p.categories.flatMap((c) => [c.name, c.description ?? ""]).map((c) => c.trim()).filter(Boolean)),
  ];
  return {
    id: p.id,
    slug: p.slug,
    codigo: p.code,
    sku: p.sku,
    nome: p.name,
    descricao: removerHtml(p.description).slice(0, LIMITE_DESCRICAO),
    categorias,
    destaque: p.featured,
    quantidade_minima: Math.max(1, p.min_quantity),
    imagem_url: p.images[0]?.url ?? null,
    personalizacoes: p.customizations
      .map((c) => [c.type, c.description].filter(Boolean).join(": "))
      .filter(Boolean),
    subprodutos: p.subproducts
      .filter((s) => s.status)
      .map((s) => ({
        id: s.id,
        sku: s.sku,
        cor: s.color,
        estoque: Math.max(0, s.stock),
        faixas: s.prices.map((f) => ({ min: f.min, max: f.max, preco: arredondar(f.price) })),
      })),
    etiquetas_embutidas: (p.tags_ocasiao ?? etiquetasEmbutidas).slice(),
    atualizado_em: p.updated_at ?? "",
    sincronizado_em: agora.toISOString(),
    ausencias: 0,
  };
}

// ---------------------------------------------------------------------------
// Sincronização
// ---------------------------------------------------------------------------

export interface OpcoesSyncCatalogo {
  perPage?: number;
  /** Teto de páginas; chegar nele deixa o resultado incompleto e suspende remoções. */
  maxPaginas?: number;
  concorrencia?: number;
  /** Relê o detalhe de todos os produtos ativos, ignorando updated_at. */
  forcar?: boolean;
  /** Idade máxima do registro antes de reler, mesmo com updated_at igual. */
  maxIdadeHoras?: number;
  agora?: Date;
  onProgresso?(evento: { fase: "listagem" | "detalhe"; feitos: number; total?: number }): void;
}

export interface ResultadoSyncCatalogo {
  paginas: number;
  listados: number;
  ativos: number;
  lidosNoDetalhe: number;
  reaproveitados: number;
  novos: number;
  removidos: number;
  /** Detalhe que falhou; o registro anterior (se havia) foi mantido. */
  falhas: Array<{ id: string; erro: string }>;
  /** A listagem foi até a última página (só então a remoção por ausência vale). */
  listagemCompleta: boolean;
  /** Listagem completa e nenhum detalhe falhou. */
  completo: boolean;
}

/**
 * Atualiza o índice. Regras de segurança, nesta ordem de importância:
 *  1. Falha na LISTAGEM aborta sem gravar nada — um catálogo parcial nunca
 *     substitui um bom.
 *  2. Falha no DETALHE de um produto mantém o registro anterior desse produto.
 *  3. Produto inativo na listagem sai na hora; produto que simplesmente não
 *     apareceu só sai após ausência em duas sincronizações completas, porque a
 *     paginação sem ordenação fixa pode pular itens quando o catálogo muda.
 */
export async function sincronizarCatalogo(
  client: BrindeMeClient,
  store: ProductIndexStore,
  opcoes: OpcoesSyncCatalogo = {}
): Promise<ResultadoSyncCatalogo> {
  const perPage = opcoes.perPage ?? 100;
  const maxPaginas = opcoes.maxPaginas ?? 300;
  const concorrencia = Math.max(1, opcoes.concorrencia ?? 5);
  const maxIdadeMs = (opcoes.maxIdadeHoras ?? 6) * 3_600_000;
  const agora = opcoes.agora ?? new Date();

  // 1. Listagem completa.
  const listados = new Map<string, Product>();
  let pagina = 1;
  let terminou = false;
  for (; pagina <= maxPaginas; pagina++) {
    const lote = await client.listProducts({ per_page: perPage, page: pagina });
    let novosNaPagina = 0;
    for (const p of lote.data) {
      if (!listados.has(p.id)) {
        listados.set(p.id, p);
        novosNaPagina++;
      }
    }
    opcoes.onProgresso?.({ fase: "listagem", feitos: listados.size, total: lote.total });

    const ultima = lote.last_page;
    if (
      lote.data.length === 0 ||
      novosNaPagina === 0 ||
      lote.data.length < perPage ||
      (ultima !== undefined && pagina >= ultima)
    ) {
      terminou = true;
      break;
    }
  }
  const paginas = Math.min(pagina, maxPaginas);

  const anteriores = new Map(store.carregar().produtos.map((p) => [p.id, p]));
  const ativos = [...listados.values()].filter((p) => p.status);

  // 2. Quais precisam do detalhe.
  const precisam: Product[] = [];
  const reaproveitar = new Map<string, ProdutoIndexado>();
  for (const p of ativos) {
    const anterior = anteriores.get(p.id);
    const fresco =
      !opcoes.forcar &&
      anterior &&
      anterior.atualizado_em !== "" &&
      anterior.atualizado_em === (p.updated_at ?? "") &&
      agora.getTime() - new Date(anterior.sincronizado_em).getTime() < maxIdadeMs;
    if (fresco) reaproveitar.set(p.id, { ...anterior, ausencias: 0 });
    else precisam.push(p);
  }

  // 3. Detalhe, com concorrência limitada.
  const lidos = new Map<string, ProdutoIndexado>();
  const desativados = new Set<string>();
  const falhas: ResultadoSyncCatalogo["falhas"] = [];
  let proximo = 0;
  let feitos = 0;
  async function trabalhador(): Promise<void> {
    while (proximo < precisam.length) {
      const p = precisam[proximo++];
      try {
        const detalhe = await client.getProduct(p.id);
        // O detalhe é a fonte de verdade; produto desativado entre a listagem e o detalhe sai.
        if (detalhe.status) lidos.set(p.id, construirRegistro(detalhe, agora));
        else desativados.add(p.id);
      } catch (err) {
        falhas.push({ id: p.id, erro: err instanceof Error ? err.message : String(err) });
      }
      feitos++;
      opcoes.onProgresso?.({ fase: "detalhe", feitos, total: precisam.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, precisam.length) }, trabalhador));

  // 4. Monta o novo índice.
  const resultado = new Map<string, ProdutoIndexado>();
  let novos = 0;
  for (const p of ativos) {
    if (desativados.has(p.id)) continue;
    const registro = lidos.get(p.id) ?? reaproveitar.get(p.id) ?? anteriores.get(p.id);
    if (!registro) continue; // falhou e nunca esteve no índice
    if (!anteriores.has(p.id)) novos++;
    resultado.set(p.id, registro);
  }

  // 5. Quem ficou de fora da listagem.
  let removidos = 0;
  for (const [id, anterior] of anteriores) {
    if (resultado.has(id)) continue;
    const listado = listados.get(id);
    if (desativados.has(id) || (listado && !listado.status)) {
      removidos++; // inativado: sai agora
      continue;
    }
    if (listado) continue; // ativo e listado já tem registro acima; defensivo
    if (!terminou) {
      resultado.set(id, anterior); // listagem cortada: não dá para concluir que sumiu
      continue;
    }
    const ausencias = anterior.ausencias + 1;
    if (ausencias >= AUSENCIAS_PARA_REMOVER) removidos++;
    else resultado.set(id, { ...anterior, ausencias });
  }

  const completo = terminou && falhas.length === 0;
  store.salvar({
    versao: VERSAO_INDICE,
    sincronizado_em: agora.toISOString(),
    completo,
    produtos: [...resultado.values()],
  });

  return {
    paginas,
    listados: listados.size,
    ativos: ativos.length,
    lidosNoDetalhe: lidos.size,
    reaproveitados: reaproveitar.size,
    novos,
    removidos,
    falhas,
    listagemCompleta: terminou,
    completo,
  };
}
