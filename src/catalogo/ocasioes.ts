/**
 * Ocasiões (Natal, Dia das Mães, onboarding...) e a tabela de etiquetas que a
 * loja mantém. A API da Brinde.me não tem esse campo, então o agente só sabe
 * que uma caneca "serve para Natal" se a loja disse.
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { normalizar, radical } from "../busca/texto.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const knowledgeDir = join(__dir, "../knowledge");

interface OcasiaoDef {
  rotulo: string;
  aliases: string[];
}

/** ocasioes.json já normalizado: normalizar é caro e a busca compara milhares de etiquetas. */
interface OcasioesPreparadas {
  defs: Record<string, OcasiaoDef>;
  /** id ou alias normalizado → id canônico. */
  porNome: Map<string, string>;
  /** id → aliases normalizados. */
  aliases: Map<string, string[]>;
}

let cacheOcasioes: OcasioesPreparadas | null = null;

function slug(texto: string): string {
  return normalizar(texto).replace(/ /g, "-");
}

function ocasioes(): OcasioesPreparadas {
  if (!cacheOcasioes) {
    const raw = JSON.parse(readFileSync(join(knowledgeDir, "ocasioes.json"), "utf-8")) as {
      ocasioes: Record<string, OcasiaoDef>;
    };
    const porNome = new Map<string, string>();
    const aliases = new Map<string, string[]>();
    for (const [id, def] of Object.entries(raw.ocasioes)) {
      porNome.set(slug(id), id);
      const norm = def.aliases.map(normalizar);
      aliases.set(id, norm);
      for (const a of norm) porNome.set(a, id);
    }
    cacheOcasioes = { defs: raw.ocasioes, porNome, aliases };
  }
  return cacheOcasioes;
}

/** Só para teste: força reler ocasioes.json. */
export function recarregarOcasioes(): void {
  cacheOcasioes = null;
  memoNormalizar.clear();
}

export function rotuloDaOcasiao(id: string): string {
  return ocasioes().defs[id]?.rotulo ?? id;
}

const memoNormalizar = new Map<string, string>();

/**
 * Leva o que veio do modelo ou da etiqueta ("Dia das Mães", "natal",
 * "dia-dos-professores") ao id canônico. Ocasião desconhecida vira slug: a loja
 * pode etiquetar com um nome novo e a comparação continua funcionando.
 */
export function normalizarOcasiao(entrada: string): string {
  const memo = memoNormalizar.get(entrada);
  if (memo !== undefined) return memo;

  const alvo = normalizar(entrada);
  const resultado = alvo ? (ocasioes().porNome.get(alvo) ?? ocasioes().porNome.get(slug(alvo)) ?? slug(alvo)) : "";
  if (memoNormalizar.size > 5000) memoNormalizar.clear();
  memoNormalizar.set(entrada, resultado);
  return resultado;
}

/** Ocasiões citadas no texto livre do cliente, por frase inteira (não por pedaço de palavra). */
export function detectarOcasioes(texto: string): string[] {
  const alvo = ` ${normalizar(texto)} `;
  const achadas: string[] = [];
  for (const [id, aliases] of ocasioes().aliases) {
    if (aliases.some((a) => alvo.includes(` ${a} `))) achadas.push(id);
  }
  return achadas;
}

/** Radicais das palavras que identificam as ocasiões dadas (para não tratá-las como "tipo de produto"). */
export function radicaisDasOcasioes(ids: string[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const def = ocasioes().defs[id];
    if (!def) {
      out.add(radical(slug(id)));
      continue;
    }
    for (const alias of [id.replace(/-/g, " "), ...(ocasioes().aliases.get(id) ?? [])]) {
      for (const parte of alias.split(" ")) {
        if (parte) out.add(radical(parte));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tabela de etiquetas mantida pela loja
// ---------------------------------------------------------------------------

export interface TabelaEtiquetas {
  porProduto: Record<string, string[]>;
  porSku: Record<string, string[]>;
  porCategoria: Record<string, string[]>;
}

export interface ProdutoEtiquetavel {
  id: string;
  sku: string;
  categorias: string[];
  /** Etiquetas que vieram junto do produto (só os mocks trazem). */
  etiquetas_embutidas?: string[];
}

export interface OccasionTagStore {
  /** Ocasiões (ids canônicos) às quais o produto está etiquetado. */
  etiquetasDe(produto: ProdutoEtiquetavel): string[];
}

function tabelaVazia(): TabelaEtiquetas {
  return { porProduto: {}, porSku: {}, porCategoria: {} };
}

/** Tabela com as chaves de categoria já normalizadas, para não refazer isso por produto. */
interface TabelaPreparada {
  porProduto: Record<string, string[]>;
  porSku: Record<string, string[]>;
  porCategoria: Map<string, string[]>;
}

function preparar(t: Partial<TabelaEtiquetas>): TabelaPreparada {
  const base = { ...tabelaVazia(), ...t };
  return {
    porProduto: base.porProduto,
    porSku: base.porSku,
    porCategoria: new Map(
      Object.entries(base.porCategoria).map(([nome, tags]) => [normalizar(nome), tags])
    ),
  };
}

function etiquetasDe(tabela: TabelaPreparada, p: ProdutoEtiquetavel): string[] {
  const brutas: string[] = [...(p.etiquetas_embutidas ?? [])];
  brutas.push(...(tabela.porProduto[p.id] ?? []));
  brutas.push(...(tabela.porSku[p.sku] ?? []));
  for (const cat of p.categorias) brutas.push(...(tabela.porCategoria.get(normalizar(cat)) ?? []));
  return [...new Set(brutas.map(normalizarOcasiao).filter(Boolean))];
}

export class MemoryOccasionTagStore implements OccasionTagStore {
  private readonly tabela: TabelaPreparada;
  constructor(tabela: Partial<TabelaEtiquetas> = {}) {
    this.tabela = preparar(tabela);
  }
  etiquetasDe(p: ProdutoEtiquetavel): string[] {
    return etiquetasDe(this.tabela, p);
  }
}

/** Lê etiquetas-ocasiao.json; relê quando o arquivo muda, sem precisar reiniciar. */
export class FileOccasionTagStore implements OccasionTagStore {
  private tabela: TabelaPreparada = preparar({});
  private mtime = -1;
  private ultimaChecagem = 0;

  constructor(private readonly file = join(knowledgeDir, "etiquetas-ocasiao.json")) {}

  private garantirAtual(): void {
    // etiquetasDe roda uma vez por candidato; sem este intervalo seriam milhares de stat por busca.
    const agora = Date.now();
    if (agora - this.ultimaChecagem < 1000) return;
    this.ultimaChecagem = agora;

    if (!existsSync(this.file)) {
      this.tabela = preparar({});
      return;
    }
    const mtime = statSync(this.file).mtimeMs;
    if (mtime === this.mtime) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf-8")) as Partial<TabelaEtiquetas>;
      this.tabela = preparar(raw);
      this.mtime = mtime;
    } catch {
      // JSON quebrado na edição: mantém a última tabela boa em vez de derrubar a busca.
    }
  }

  etiquetasDe(p: ProdutoEtiquetavel): string[] {
    this.garantirAtual();
    return etiquetasDe(this.tabela, p);
  }
}
