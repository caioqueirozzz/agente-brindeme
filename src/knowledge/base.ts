/**
 * Base de conhecimento (Fase 3): o que o agente pode afirmar sobre processo,
 * arte, prazos, entrega, pagamento, trocas e dados da loja.
 *
 * Regras do planejamento, e onde cada uma é garantida:
 *  - Item curto, com dono e data de revisão ........ itemSchema
 *  - Só conteúdo aprovado entra; rascunho fica fora ... BaseConhecimento.servivel
 *  - Pergunta sem resposta vira lacuna e transfere ... tools/consultarConhecimento.ts
 *  - Log do item usado em cada resposta ............. runTurn.ts
 *
 * O texto vive em `base/<categoria>.json`, editável pela loja sem tocar em
 * código. Na Fase 5 o supervisor edita pelo painel; a interface não muda.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { IndiceBM25, type TermoConsulta } from "../busca/bm25.js";
import { tokenizar } from "../busca/texto.js";
import { sinonimosDe } from "../busca/sinonimos.js";

const __dir = dirname(fileURLToPath(import.meta.url));
export const DIR_BASE_PADRAO = join(__dir, "base");

/** Quem aprova cada categoria (tabela do planejamento, Fase 3). */
export const CATEGORIAS = {
  "processo-comercial": { rotulo: "Processo comercial", aprovador: "Comercial" },
  arte: { rotulo: "Arte", aprovador: "Produção" },
  prazos: { rotulo: "Prazos", aprovador: "Produção" },
  entrega: { rotulo: "Entrega", aprovador: "Logística" },
  pagamento: { rotulo: "Pagamento", aprovador: "Financeiro" },
  "trocas-defeitos": { rotulo: "Trocas e defeitos", aprovador: "Gerência" },
  institucional: { rotulo: "Institucional", aprovador: "Gerência" },
} as const;

export type CategoriaId = keyof typeof CATEGORIAS;
export const IDS_CATEGORIA = Object.keys(CATEGORIAS) as [CategoriaId, ...CategoriaId[]];

/** Marcadores como [X], [H], [PRAZO_PRODUCAO]: valor que a loja ainda não preencheu. */
export const REGEX_PLACEHOLDER = /\[[A-Z][A-Z0-9_ ]*\]/;

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD");

export const itemSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use minúsculas, números e hífens"),
    titulo: z.string().min(3).max(100),
    // "Curto": cabe numa mensagem de WhatsApp sem virar manual.
    conteudo: z.string().min(10).max(700),
    /** Palavras que o cliente usa e o conteúdo não repete ("demora", "pix", "parcelar"). */
    palavras_chave: z.array(z.string().min(2)).default([]),
    /** Perguntas reais que este item responde; entram na busca. */
    perguntas_exemplo: z.array(z.string().min(3)).default([]),
    /** Quem responde pelo conteúdo. Padrão: o aprovador da categoria. */
    dono: z.string().min(2).optional(),
    status: z.enum(["aprovado", "rascunho"]),
    aprovado_por: z.string().min(2).optional(),
    aprovado_em: dataIso.optional(),
    /** Quando o conteúdo deve ser revisto. */
    revisar_em: dataIso,
    /** Recado para a loja (o que falta preencher, de onde veio o texto). Nunca é servido. */
    nota_interna: z.string().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.status === "aprovado") {
      if (!item.aprovado_por) {
        ctx.addIssue({ code: "custom", path: ["aprovado_por"], message: "item aprovado precisa de aprovado_por" });
      }
      if (!item.aprovado_em) {
        ctx.addIssue({ code: "custom", path: ["aprovado_em"], message: "item aprovado precisa de aprovado_em" });
      }
      if (REGEX_PLACEHOLDER.test(item.conteudo) || REGEX_PLACEHOLDER.test(item.titulo)) {
        ctx.addIssue({
          code: "custom",
          path: ["conteudo"],
          message: "item aprovado não pode ter [PLACEHOLDER] — preencha o valor ou volte para rascunho",
        });
      }
    }
  });

const arquivoSchema = z.object({
  categoria: z.enum(IDS_CATEGORIA),
  itens: z.array(z.unknown()),
});

export type ItemSchema = z.infer<typeof itemSchema>;

export interface ItemBase extends ItemSchema {
  categoria: CategoriaId;
  dono: string;
  /** Conteúdo com valor ainda não preenchido: nunca é servido. */
  temPlaceholder: boolean;
  /** Passou de revisar_em. */
  vencido: boolean;
}

export interface ProblemaBase {
  arquivo: string;
  item?: string;
  mensagem: string;
}

export interface OpcoesLeitura {
  dir?: string;
  hoje?: Date;
}

/** Lê e valida TODOS os itens (aprovados e rascunhos). Item inválido vira problema, não exceção. */
export function lerItens(opcoes: OpcoesLeitura = {}): { itens: ItemBase[]; problemas: ProblemaBase[] } {
  const dir = opcoes.dir ?? DIR_BASE_PADRAO;
  const hoje = (opcoes.hoje ?? new Date()).toISOString().slice(0, 10);
  const itens: ItemBase[] = [];
  const problemas: ProblemaBase[] = [];
  const ids = new Set<string>();

  if (!existsSync(dir)) {
    return { itens, problemas: [{ arquivo: dir, mensagem: "pasta da base de conhecimento não existe" }] };
  }

  for (const arquivo of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let bruto: unknown;
    try {
      bruto = JSON.parse(readFileSync(join(dir, arquivo), "utf-8"));
    } catch (err) {
      problemas.push({ arquivo, mensagem: `JSON inválido: ${err instanceof Error ? err.message : err}` });
      continue;
    }
    const cab = arquivoSchema.safeParse(bruto);
    if (!cab.success) {
      problemas.push({ arquivo, mensagem: `cabeçalho inválido: ${cab.error.issues[0]?.message ?? "?"}` });
      continue;
    }
    if (arquivo !== `${cab.data.categoria}.json`) {
      problemas.push({ arquivo, mensagem: `o arquivo deve se chamar ${cab.data.categoria}.json` });
      continue;
    }

    for (const cru of cab.data.itens) {
      const r = itemSchema.safeParse(cru);
      const idTentativa = (cru as { id?: string } | null)?.id;
      if (!r.success) {
        const i = r.error.issues[0];
        problemas.push({
          arquivo,
          item: idTentativa,
          mensagem: `${i?.path.join(".") || "item"}: ${i?.message ?? "inválido"}`,
        });
        continue;
      }
      if (ids.has(r.data.id)) {
        problemas.push({ arquivo, item: r.data.id, mensagem: "id repetido na base" });
        continue;
      }
      ids.add(r.data.id);
      itens.push({
        ...r.data,
        categoria: cab.data.categoria,
        dono: r.data.dono ?? CATEGORIAS[cab.data.categoria].aprovador,
        temPlaceholder: REGEX_PLACEHOLDER.test(r.data.conteudo) || REGEX_PLACEHOLDER.test(r.data.titulo),
        vencido: r.data.revisar_em < hoje,
      });
    }
  }
  return { itens, problemas };
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

/**
 * Parte do "peso informativo" da pergunta que o item precisa cobrir. Abaixo
 * disso é lacuna: responder com um item que só casa com uma palavra solta
 * ("dias") é pior que dizer "vou verificar".
 */
export const COBERTURA_MINIMA = 0.5;
/** O segundo item só acompanha o primeiro se for quase tão bom. */
const FRACAO_DO_MELHOR = 0.6;

export interface AcertoBase {
  item: ItemBase;
  score: number;
  cobertura: number;
}

export interface OpcoesBusca {
  categoria?: CategoriaId;
  limite?: number;
}

export interface EstatisticasBase {
  total: number;
  aprovados: number;
  rascunhos: number;
  servidos: number;
  vencidos: number;
  comPlaceholder: number;
}

export class BaseConhecimento {
  private readonly servidos: ItemBase[];
  private readonly motor: IndiceBM25;

  constructor(
    private readonly todos: ItemBase[],
    private readonly opcoes: { incluirRascunhos: boolean }
  ) {
    this.servidos = todos.filter((i) => this.servivel(i));
    this.motor = new IndiceBM25(
      this.servidos.map((i) => ({
        id: i.id,
        campos: [
          { tokens: tokenizar(i.titulo), peso: 3 },
          { tokens: tokenizar(i.palavras_chave.join(" ")), peso: 3 },
          { tokens: tokenizar(i.perguntas_exemplo.join(" ")), peso: 2 },
          { tokens: tokenizar(i.conteudo), peso: 1 },
        ],
      }))
    );
  }

  /** Aprovado e sem valor pendente. Rascunho só com a chave de desenvolvimento, e ainda assim sem placeholder. */
  private servivel(i: ItemBase): boolean {
    if (i.temPlaceholder) return false;
    return i.status === "aprovado" || this.opcoes.incluirRascunhos;
  }

  estatisticas(): EstatisticasBase {
    return {
      total: this.todos.length,
      aprovados: this.todos.filter((i) => i.status === "aprovado").length,
      rascunhos: this.todos.filter((i) => i.status === "rascunho").length,
      servidos: this.servidos.length,
      vencidos: this.todos.filter((i) => i.vencido).length,
      comPlaceholder: this.todos.filter((i) => i.temPlaceholder).length,
    };
  }

  buscar(pergunta: string, opcoes: OpcoesBusca = {}): AcertoBase[] {
    if (this.servidos.length === 0) return [];

    const termos: TermoConsulta[] = [];
    const vistos = new Set<string>();
    for (const t of tokenizar(pergunta)) {
      if (vistos.has(t)) continue;
      vistos.add(t);
      termos.push({ termo: t, alternativas: sinonimosDe(t) });
    }
    if (termos.length === 0) return [];

    const pontuacoes = this.motor.pontuar(termos);
    const acertos: AcertoBase[] = [];
    for (const item of this.servidos) {
      if (opcoes.categoria && item.categoria !== opcoes.categoria) continue;
      const p = pontuacoes.get(item.id);
      if (!p || p.cobertura < COBERTURA_MINIMA) continue;
      acertos.push({ item, score: p.score, cobertura: p.cobertura });
    }
    acertos.sort((a, b) => b.score - a.score);

    const limite = opcoes.limite ?? 2;
    const melhor = acertos[0]?.score ?? 0;
    return acertos.filter((a, i) => i === 0 || a.score >= melhor * FRACAO_DO_MELHOR).slice(0, limite);
  }
}

export interface OpcoesCarga extends OpcoesLeitura {
  incluirRascunhos?: boolean;
}

export function carregarBase(opcoes: OpcoesCarga = {}): {
  base: BaseConhecimento;
  problemas: ProblemaBase[];
} {
  const { itens, problemas } = lerItens(opcoes);
  return {
    base: new BaseConhecimento(itens, { incluirRascunhos: opcoes.incluirRascunhos ?? false }),
    problemas,
  };
}
