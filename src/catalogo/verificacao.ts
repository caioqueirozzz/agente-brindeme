/**
 * Verificador independente das sugestões (critério de pronto da Fase 3: "toda
 * sugestão respeita mínimo, estoque e orçamento").
 *
 * De propósito NÃO reaproveita `oferta.ts`: recalcula tudo a partir do produto
 * cru da API, com laços simples. Se as duas implementações discordarem, um dos
 * dois está errado — e é isso que o teste e o script de avaliação detectam.
 */
import type { Product } from "../integrations/brindeme/types.js";

export interface SugestaoParaVerificar {
  quantidade: number;
  preco_unitario: number;
  total_estimado: number;
  cores: Array<{ subproduto_id: string; preco_unitario: number }>;
}

export interface LimitesDoPedido {
  quantidade?: number;
  precoMaxUnitario?: number;
  orcamentoTotal?: number;
}

export interface Violacao {
  regra: "inativo" | "minimo" | "estoque" | "preco" | "orcamento" | "total" | "quantidade";
  detalhe: string;
}

const centavos = (reais: number): number => Math.round(reais * 100);

export function verificarSugestao(
  produto: Product,
  s: SugestaoParaVerificar,
  limites: LimitesDoPedido
): Violacao[] {
  const v: Violacao[] = [];

  if (!produto.status) v.push({ regra: "inativo", detalhe: `${produto.name} está inativo` });

  if (limites.quantidade !== undefined && s.quantidade !== limites.quantidade) {
    v.push({ regra: "quantidade", detalhe: `pedido ${limites.quantidade}, sugestão calculada em ${s.quantidade}` });
  }
  if (s.quantidade < produto.min_quantity) {
    v.push({ regra: "minimo", detalhe: `${s.quantidade} < mínimo ${produto.min_quantity}` });
  }
  if (s.cores.length === 0) v.push({ regra: "estoque", detalhe: "sugestão sem nenhuma cor" });

  let menor = Infinity;
  for (const cor of s.cores) {
    const sub = produto.subproducts.find((x) => x.id === cor.subproduto_id);
    if (!sub || !sub.status) {
      v.push({ regra: "estoque", detalhe: `subproduto ${cor.subproduto_id} inexistente ou inativo` });
      continue;
    }
    if (sub.stock < s.quantidade) {
      v.push({ regra: "estoque", detalhe: `${sub.color}: estoque ${sub.stock} < ${s.quantidade}` });
    }
    const faixa = sub.prices.find((f) => s.quantidade >= f.min && s.quantidade <= f.max);
    if (!faixa) {
      v.push({ regra: "preco", detalhe: `${sub.color}: sem faixa para ${s.quantidade}` });
      continue;
    }
    if (centavos(faixa.price) !== centavos(cor.preco_unitario)) {
      v.push({ regra: "preco", detalhe: `${sub.color}: API ${faixa.price}, sugerido ${cor.preco_unitario}` });
    }
    if (limites.precoMaxUnitario !== undefined && centavos(faixa.price) > centavos(limites.precoMaxUnitario)) {
      v.push({ regra: "orcamento", detalhe: `${sub.color}: ${faixa.price} > teto unitário ${limites.precoMaxUnitario}` });
    }
    if (
      limites.orcamentoTotal !== undefined &&
      centavos(faixa.price) * s.quantidade > centavos(limites.orcamentoTotal)
    ) {
      v.push({ regra: "orcamento", detalhe: `${sub.color}: total ${(centavos(faixa.price) * s.quantidade) / 100} > ${limites.orcamentoTotal}` });
    }
    menor = Math.min(menor, centavos(faixa.price));
  }

  if (Number.isFinite(menor)) {
    if (menor !== centavos(s.preco_unitario)) {
      v.push({ regra: "preco", detalhe: `menor preço real ${menor / 100}, sugerido ${s.preco_unitario}` });
    }
    if (menor * s.quantidade !== centavos(s.total_estimado)) {
      v.push({ regra: "total", detalhe: `total real ${(menor * s.quantidade) / 100}, sugerido ${s.total_estimado}` });
    }
  }
  return v;
}
