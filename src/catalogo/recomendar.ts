/**
 * Lógica de recomendação (Fase 3). Os cinco passos do planejamento:
 *
 *  1. Coletar o essencial — é conversa, vive no prompt; aqui chega pronto.
 *  2. Filtrar com regras rígidas (mínimo, estoque, orçamento) — oferta.ts.
 *  3. Ordenar por relevância: etiqueta de ocasião, similaridade, destaque.
 *  4. Apresentar até 3 opções, com preço e total na quantidade pedida.
 *  5. Sem resultado: dizer o que não fechou e propor o ajuste mais próximo,
 *     sem inventar produto.
 *
 * O índice só escolhe candidatos. Antes de qualquer produto virar sugestão,
 * `GET /product/{id}` confirma estoque e preço, e as regras rodam de novo sobre
 * o dado fresco. Produto que não pode ser verificado não é sugerido.
 */
import { IndiceBM25, type TermoConsulta, type PontuacaoDocumento } from "../busca/bm25.js";
import { tokenizar } from "../busca/texto.js";
import { sinonimosDe } from "../busca/sinonimos.js";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError, ApiError, type FalhaApi } from "../integrations/brindeme/errors.js";
import type { ProductIndexStore, ProdutoIndexado } from "./indice.js";
import { construirRegistro } from "./indice.js";
import {
  calcularOferta,
  type MotivoInelegivel,
  type Orcamento,
  type OfertaOk,
} from "./oferta.js";
import {
  detectarOcasioes,
  normalizarOcasiao,
  radicaisDasOcasioes,
  type OccasionTagStore,
} from "./ocasioes.js";

/** Quantas opções o agente apresenta (Fase 1: no máximo 3 por vez). */
export const MAX_OPCOES = 3;
/** Produtos conferidos na API por rodada, e teto de conferências por pergunta. */
const TAMANHO_LOTE = 4;
const MAX_REVALIDACOES = 12;
/** Candidatos relevantes examinados para explicar um "sem resultado". */
const MAX_PARA_EXPLICAR = 40;

// Destaque só desempata: pesa menos que a penalidade de casar por sinônimo
// (PESO_SINONIMO = 0.7 → 0.3 × PESO_SIMILARIDADE), senão um "copo" em destaque
// passaria na frente da caneca que o cliente pediu.
const PESO_SIMILARIDADE = 0.5;
const PESO_OCASIAO = 0.42;
const PESO_DESTAQUE = 0.08;

export interface PedidoRecomendacao {
  consulta: string;
  quantidade?: number;
  precoMaxUnitario?: number;
  orcamentoTotal?: number;
  ocasiao?: string;
}

export interface Dependencias {
  index: ProductIndexStore;
  tags: OccasionTagStore;
  client: BrindeMeClient;
  agora?: () => Date;
}

export interface ItemRecomendado {
  /** Registro construído do detalhe recém-buscado na API. */
  produto: ProdutoIndexado;
  oferta: OfertaOk;
  /** O produto está etiquetado com a ocasião pedida. */
  ocasiaoConfere: boolean;
  /** Relevância 0..1 usada na ordenação. */
  relevancia: number;
}

export type Ajuste =
  | {
      tipo: "aumentar_quantidade";
      produto_id: string;
      nome: string;
      quantidade: number;
      preco_unitario: number;
      total_estimado: number;
    }
  | {
      tipo: "reduzir_quantidade";
      produto_id: string;
      nome: string;
      quantidade: number;
      preco_unitario: number;
      total_estimado: number;
    }
  | {
      tipo: "aumentar_orcamento";
      produto_id: string;
      nome: string;
      quantidade: number;
      preco_unitario_minimo: number;
      total_estimado: number;
    };

export type Recomendacao =
  | {
      tipo: "encontrados";
      itens: ItemRecomendado[];
      quantidadeConsiderada: number | null;
      quantidadeInformada: boolean;
      ocasioes: string[];
      /** Candidatos que não puderam ser conferidos na API (não foram sugeridos). */
      naoVerificados: number;
      /** Candidatos que passaram no índice mas falharam nas regras com o dado fresco. */
      descartadosNaRevalidacao: number;
    }
  | {
      tipo: "nenhum";
      motivo: "sem_correspondencia" | "regras_nao_fecham";
      candidatosRelevantes: number;
      eliminadosPor: Partial<Record<MotivoInelegivel, number>>;
      ajustes: Ajuste[];
      ocasioes: string[];
      descartadosNaRevalidacao: number;
    }
  | { tipo: "falha_api"; erro: FalhaApi }
  | { tipo: "indice_vazio" };

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

interface ConsultaInterpretada {
  termos: TermoConsulta[];
  /** Termos que dizem o QUE é o produto (exclui as palavras que só nomeiam a ocasião). */
  termosDeConteudo: Set<string>;
  ocasioes: string[];
}

function interpretar(consulta: string, ocasiaoParam?: string): ConsultaInterpretada {
  const ocasioes = new Set(detectarOcasioes(consulta));
  if (ocasiaoParam) {
    for (const o of detectarOcasioes(ocasiaoParam)) ocasioes.add(o);
    const n = normalizarOcasiao(ocasiaoParam);
    if (n) ocasioes.add(n);
  }
  const radicaisOcasiao = radicaisDasOcasioes([...ocasioes]);

  const vistos = new Set<string>();
  const termos: TermoConsulta[] = [];
  for (const t of tokenizar(`${consulta} ${ocasiaoParam ?? ""}`, { semGenericasDeProduto: true })) {
    if (vistos.has(t)) continue;
    vistos.add(t);
    termos.push({ termo: t, alternativas: sinonimosDe(t) });
  }
  const termosDeConteudo = new Set(termos.map((t) => t.termo).filter((t) => !radicaisOcasiao.has(t)));
  return { termos, termosDeConteudo, ocasioes: [...ocasioes] };
}

// ---------------------------------------------------------------------------
// Motor de busca (BM25 por referência do índice)
// ---------------------------------------------------------------------------

const motores = new WeakMap<object, IndiceBM25>();

function motorDe(produtos: ProdutoIndexado[]): IndiceBM25 {
  let motor = motores.get(produtos);
  if (!motor) {
    motor = new IndiceBM25(
      produtos.map((p) => ({
        id: p.id,
        campos: [
          { tokens: tokenizar(p.nome), peso: 3 },
          // O slug guarda o nome real mesmo quando o nome vem vazio ou genérico.
          { tokens: tokenizar(p.slug.replace(/-/g, " ")), peso: 3 },
          { tokens: tokenizar(p.categorias.join(" ")), peso: 2 },
          { tokens: tokenizar(p.personalizacoes.join(" ")), peso: 1 },
          { tokens: tokenizar(p.descricao), peso: 1 },
        ],
      }))
    );
    motores.set(produtos, motor);
  }
  return motor;
}

// ---------------------------------------------------------------------------
// Recomendação
// ---------------------------------------------------------------------------

function etiquetadoCom(p: ProdutoIndexado, ocasioes: string[], tags: OccasionTagStore): boolean {
  const etiquetas = tags.etiquetasDe(p);
  return ocasioes.some((o) => etiquetas.includes(o));
}

interface Candidato {
  produto: ProdutoIndexado;
  similaridade: number;
  ocasiaoConfere: boolean;
}

function orcamentoDe(p: PedidoRecomendacao): Orcamento {
  // Total sem quantidade não vira teto unitário: cada produto seria avaliado na
  // sua própria quantidade mínima e o "total" perderia o sentido.
  return {
    unitarioMax: p.precoMaxUnitario,
    totalMax: p.quantidade !== undefined ? p.orcamentoTotal : undefined,
  };
}

export async function recomendar(
  pedido: PedidoRecomendacao,
  deps: Dependencias
): Promise<Recomendacao> {
  const agora = deps.agora ?? (() => new Date());
  const { produtos } = deps.index.carregar();
  if (produtos.length === 0) return { tipo: "indice_vazio" };

  const consulta = interpretar(pedido.consulta, pedido.ocasiao);
  const orcamento = orcamentoDe(pedido);

  // --- candidatos por relevância -------------------------------------------------
  const pontuacoes: Map<string, PontuacaoDocumento> = consulta.termos.length
    ? motorDe(produtos).pontuar(consulta.termos)
    : new Map();
  const maxScore = Math.max(0, ...[...pontuacoes.values()].map((p) => p.score));

  const candidatos: Candidato[] = [];
  for (const p of produtos) {
    const pont = pontuacoes.get(p.id);
    const ocasiaoConfere = consulta.ocasioes.length > 0 && etiquetadoCom(p, consulta.ocasioes, deps.tags);

    const casouConteudo = pont?.casados.some((t) => consulta.termosDeConteudo.has(t)) ?? false;
    const temConteudo = consulta.termosDeConteudo.size > 0;
    const temFiltroDeTexto = consulta.termos.length > 0 || consulta.ocasioes.length > 0;

    // Com "caneca" na pergunta, só caneca (ou sinônimo) é candidata: a ocasião ordena, não admite.
    // Sem tipo de produto ("algo para professores"), vale a etiqueta ou o texto.
    const relevante = !temFiltroDeTexto
      ? true
      : temConteudo
        ? casouConteudo
        : ocasiaoConfere || pont !== undefined;
    if (!relevante) continue;

    candidatos.push({
      produto: p,
      similaridade: pont && maxScore > 0 ? pont.score / maxScore : 0,
      ocasiaoConfere,
    });
  }

  if (candidatos.length === 0) {
    return {
      tipo: "nenhum",
      motivo: "sem_correspondencia",
      candidatosRelevantes: 0,
      eliminadosPor: {},
      ajustes: [],
      ocasioes: consulta.ocasioes,
      descartadosNaRevalidacao: 0,
    };
  }

  const relevancia = (c: Candidato): number =>
    PESO_SIMILARIDADE * c.similaridade +
    PESO_OCASIAO * (c.ocasiaoConfere ? 1 : 0) +
    PESO_DESTAQUE * (c.produto.destaque ? 1 : 0);

  // --- passo 2: regras rígidas sobre o índice ------------------------------------
  const aprovados: Array<Candidato & { relevancia: number; preco: number }> = [];
  const reprovados: Array<{ c: Candidato; relevancia: number; motivo: MotivoInelegivel }> = [];
  const eliminadosPor: Partial<Record<MotivoInelegivel, number>> = {};

  for (const c of candidatos) {
    const oferta = calcularOferta(c.produto, pedido.quantidade, orcamento);
    const r = relevancia(c);
    if (oferta.ok) aprovados.push({ ...c, relevancia: r, preco: oferta.preco_unitario });
    else {
      eliminadosPor[oferta.motivo] = (eliminadosPor[oferta.motivo] ?? 0) + 1;
      reprovados.push({ c, relevancia: r, motivo: oferta.motivo });
    }
  }

  // --- passo 3: ordem -------------------------------------------------------------
  aprovados.sort(
    (a, b) =>
      b.relevancia - a.relevancia ||
      a.preco - b.preco ||
      a.produto.nome.localeCompare(b.produto.nome, "pt-BR")
  );

  // --- revalidação ao vivo --------------------------------------------------------
  const itens: ItemRecomendado[] = [];
  let naoVerificados = 0;
  let descartados = 0;
  let verificados = 0;
  let sucessosNaApi = 0;
  let primeiraFalha: FalhaApi | null = null;

  for (
    let cursor = 0;
    itens.length < MAX_OPCOES && cursor < aprovados.length && verificados < MAX_REVALIDACOES;
    cursor += TAMANHO_LOTE
  ) {
    const lote = aprovados.slice(cursor, cursor + TAMANHO_LOTE);
    verificados += lote.length;

    const respostas = await Promise.all(
      lote.map(async (c) => {
        try {
          return { c, fresco: await deps.client.getProduct(c.produto.id) };
        } catch (err) {
          return { c, erro: err };
        }
      })
    );

    for (const r of respostas) {
      if (itens.length >= MAX_OPCOES) break;
      if ("erro" in r) {
        // 404: o produto saiu do ar desde a sincronização — é dado, não falha.
        if (r.erro instanceof ApiError && r.erro.status === 404) {
          descartados++;
          continue;
        }
        naoVerificados++;
        primeiraFalha ??= translateApiError(r.erro);
        continue;
      }
      sucessosNaApi++;
      if (!r.fresco.status) {
        descartados++;
        continue;
      }
      const registro = construirRegistro(r.fresco, agora(), r.c.produto.etiquetas_embutidas);
      const oferta = calcularOferta(registro, pedido.quantidade, orcamento);
      if (!oferta.ok) {
        descartados++;
        continue;
      }
      itens.push({
        produto: registro,
        oferta,
        ocasiaoConfere: r.c.ocasiaoConfere,
        relevancia: relevancia(r.c),
      });
    }
  }

  if (itens.length > 0) {
    return {
      tipo: "encontrados",
      itens,
      // Sem quantidade, cada oferta usa o mínimo do próprio produto (ver oferta.quantidade).
      quantidadeConsiderada: pedido.quantidade ?? null,
      quantidadeInformada: pedido.quantidade !== undefined,
      ocasioes: consulta.ocasioes,
      naoVerificados,
      descartadosNaRevalidacao: descartados,
    };
  }

  // Nada confirmado. Se a API falhou e nenhuma conferência deu certo, o problema
  // é de infraestrutura, não de catálogo — o agente não deve dizer "não temos".
  if (primeiraFalha && sucessosNaApi === 0) return { tipo: "falha_api", erro: primeiraFalha };

  // --- passo 5: explicar e propor o ajuste mais próximo -----------------------------
  reprovados.sort((a, b) => b.relevancia - a.relevancia);
  return {
    tipo: "nenhum",
    motivo: "regras_nao_fecham",
    candidatosRelevantes: candidatos.length,
    eliminadosPor,
    ajustes: propor(reprovados.slice(0, MAX_PARA_EXPLICAR), pedido, orcamento),
    ocasioes: consulta.ocasioes,
    descartadosNaRevalidacao: descartados,
  };
}

/**
 * Para os candidatos mais relevantes que as regras eliminaram, descobre a menor
 * mudança que os faria passar — e só propõe se a mudança, de fato, passa nas
 * mesmas regras. No máximo um ajuste de cada tipo, do produto mais relevante.
 */
function propor(
  reprovados: Array<{ c: Candidato; relevancia: number; motivo: MotivoInelegivel }>,
  pedido: PedidoRecomendacao,
  orcamento: Orcamento
): Ajuste[] {
  const ajustes: Ajuste[] = [];
  const jaTem = (tipo: Ajuste["tipo"]) => ajustes.some((a) => a.tipo === tipo);

  for (const { c, motivo } of reprovados) {
    if (ajustes.length >= 2) break;
    const p = c.produto;
    const base = calcularOferta(p, pedido.quantidade, orcamento);
    if (base.ok) continue;

    if (motivo === "abaixo_do_minimo" && !jaTem("aumentar_quantidade")) {
      const q = p.quantidade_minima;
      const o = calcularOferta(p, q, orcamento);
      if (o.ok) {
        ajustes.push({
          tipo: "aumentar_quantidade",
          produto_id: p.id,
          nome: p.nome,
          quantidade: q,
          preco_unitario: o.preco_unitario,
          total_estimado: o.total_estimado,
        });
      }
    } else if (motivo === "estoque_insuficiente" && !jaTem("reduzir_quantidade")) {
      const q = base.detalhe.maior_estoque_de_uma_cor;
      if (q !== undefined && q >= p.quantidade_minima) {
        const o = calcularOferta(p, q, orcamento);
        if (o.ok) {
          ajustes.push({
            tipo: "reduzir_quantidade",
            produto_id: p.id,
            nome: p.nome,
            quantidade: q,
            preco_unitario: o.preco_unitario,
            total_estimado: o.total_estimado,
          });
        }
      }
    } else if (motivo === "acima_do_orcamento" && !jaTem("aumentar_orcamento")) {
      const preco = base.detalhe.menor_preco_unitario;
      if (preco !== undefined) {
        // Sem orçamento algum a oferta passaria: confirma que SÓ o orçamento barra.
        const o = calcularOferta(p, base.quantidade, {});
        if (o.ok) {
          ajustes.push({
            tipo: "aumentar_orcamento",
            produto_id: p.id,
            nome: p.nome,
            quantidade: base.quantidade,
            preco_unitario_minimo: preco,
            total_estimado: o.total_estimado,
          });
        }
      }
    }
  }
  return ajustes;
}
