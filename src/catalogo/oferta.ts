/**
 * Regras rígidas da recomendação (Fase 3, passo 2): quantidade ≥ mínimo,
 * estoque suficiente, preço da faixa de quantidade dentro do orçamento.
 *
 * Função pura sobre o registro do índice. A mesma função roda sobre o índice
 * (triagem) e sobre o detalhe recém-buscado na API (revalidação), então as duas
 * etapas nunca discordam.
 *
 * Decisões:
 *  - ESTOQUE é por cor: uma cor precisa cobrir a quantidade inteira. Somar
 *    cores dependeria de como a plataforma faixa o preço de um pedido dividido
 *    em linhas (por linha? pelo total?), o que a spec não diz. Prefere-se não
 *    sugerir a sugerir um preço que o orçamento depois contradiz.
 *  - PREÇO é o da faixa que contém a quantidade, de cada cor. A oferta lista só
 *    as cores que cobrem a quantidade E cabem no orçamento.
 *  - Sem quantidade, avalia-se na quantidade mínima do produto e a oferta diz
 *    isso — "a partir de", nunca um preço que pareça valer para qualquer volume.
 */
import type { ProdutoIndexado, SubprodutoIndexado } from "./indice.js";

export type MotivoInelegivel =
  | "sem_estoque"
  | "abaixo_do_minimo"
  | "estoque_insuficiente"
  | "sem_faixa_de_preco"
  | "acima_do_orcamento";

/** Orçamento do cliente. Os dois podem vir; vale o mais restritivo. */
export interface Orcamento {
  /** Reais por unidade. */
  unitarioMax?: number;
  /** Reais pelo pedido todo; vira teto unitário = total / quantidade. */
  totalMax?: number;
}

export interface CorOfertada {
  subproduto_id: string;
  cor: string;
  estoque: number;
  /** Reais, preço da faixa desta cor na quantidade. */
  preco_unitario: number;
}

export interface OfertaOk {
  ok: true;
  /** Quantidade em que a oferta foi calculada. */
  quantidade: number;
  /** false quando o cliente não disse a quantidade e usamos o mínimo do produto. */
  quantidade_informada: boolean;
  /** Menor preço entre as cores ofertadas. */
  preco_unitario: number;
  /** preco_unitario × quantidade, em reais com centavos exatos. */
  total_estimado: number;
  cores: CorOfertada[];
}

export interface OfertaRecusada {
  ok: false;
  motivo: MotivoInelegivel;
  quantidade: number;
  quantidade_informada: boolean;
  detalhe: {
    minimo?: number;
    /** Maior estoque de uma única cor. */
    maior_estoque_de_uma_cor?: number;
    /** Menor preço unitário que o produto faria na quantidade (para propor ajuste de orçamento). */
    menor_preco_unitario?: number;
  };
}

export type Oferta = OfertaOk | OfertaRecusada;

const aCentavos = (reais: number): number => Math.round(reais * 100);
const deCentavos = (c: number): number => c / 100;

/** Teto unitário em centavos para a quantidade, ou Infinity se não há orçamento. */
export function tetoUnitarioCentavos(orcamento: Orcamento, quantidade: number): number {
  let teto = Infinity;
  if (orcamento.unitarioMax !== undefined) teto = Math.min(teto, aCentavos(orcamento.unitarioMax));
  if (orcamento.totalMax !== undefined) {
    // floor: R$ 100 para 3 unidades é R$ 33,33 — nunca 33,34, que estouraria o total.
    teto = Math.min(teto, Math.floor(aCentavos(orcamento.totalMax) / quantidade));
  }
  return teto;
}

function precoNaFaixa(sub: SubprodutoIndexado, quantidade: number): number | null {
  const faixa = sub.faixas.find((f) => quantidade >= f.min && quantidade <= f.max);
  return faixa ? aCentavos(faixa.preco) : null;
}

export function calcularOferta(
  produto: Pick<ProdutoIndexado, "quantidade_minima" | "subprodutos">,
  quantidadeInformada: number | undefined,
  orcamento: Orcamento = {}
): Oferta {
  const informada = quantidadeInformada !== undefined;
  const quantidade = quantidadeInformada ?? produto.quantidade_minima;
  const recusa = (
    motivo: MotivoInelegivel,
    detalhe: OfertaRecusada["detalhe"] = {}
  ): OfertaRecusada => ({ ok: false, motivo, quantidade, quantidade_informada: informada, detalhe });

  const comEstoque = produto.subprodutos.filter((s) => s.estoque > 0);
  if (comEstoque.length === 0) return recusa("sem_estoque");

  if (quantidade < produto.quantidade_minima) {
    return recusa("abaixo_do_minimo", { minimo: produto.quantidade_minima });
  }

  const cobrem = comEstoque.filter((s) => s.estoque >= quantidade);
  if (cobrem.length === 0) {
    return recusa("estoque_insuficiente", {
      maior_estoque_de_uma_cor: Math.max(...comEstoque.map((s) => s.estoque)),
      minimo: produto.quantidade_minima,
    });
  }

  const comPreco = cobrem
    .map((s) => ({ sub: s, centavos: precoNaFaixa(s, quantidade) }))
    .filter((x): x is { sub: SubprodutoIndexado; centavos: number } => x.centavos !== null);
  if (comPreco.length === 0) return recusa("sem_faixa_de_preco");

  const teto = tetoUnitarioCentavos(orcamento, quantidade);
  const dentro = comPreco.filter((x) => x.centavos <= teto);
  if (dentro.length === 0) {
    return recusa("acima_do_orcamento", {
      menor_preco_unitario: deCentavos(Math.min(...comPreco.map((x) => x.centavos))),
    });
  }

  dentro.sort((a, b) => a.centavos - b.centavos);
  const menor = dentro[0].centavos;
  return {
    ok: true,
    quantidade,
    quantidade_informada: informada,
    preco_unitario: deCentavos(menor),
    total_estimado: deCentavos(menor * quantidade),
    cores: dentro.map((x) => ({
      subproduto_id: x.sub.id,
      cor: x.sub.cor,
      estoque: x.sub.estoque,
      preco_unitario: deCentavos(x.centavos),
    })),
  };
}
