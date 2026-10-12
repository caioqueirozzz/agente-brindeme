import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/errors.js";
import type { ConversationState } from "../agent/state.js";

export const detalharProdutoSchema = z.object({
  produto_id: z.string().describe("ID do produto"),
  quantidade: z.number().int().positive().optional().describe("Quantidade desejada para calcular o preço"),
});

export type DetalharProdutoInput = z.infer<typeof detalharProdutoSchema>;

export async function detalharProdutoHandler(
  input: DetalharProdutoInput,
  state: ConversationState,
  client: BrindeMeClient
) {
  try {
    const p = await client.getProduct(input.produto_id);

    const activeSubs = p.subproducts.filter((s) => s.status);

    // Guarda de onde veio cada subproduto: preparar_orcamento precisa disso
    // para resolver o item sem varrer o catálogo inteiro.
    for (const s of p.subproducts) state.subprodutoParaProduto[s.id] = p.id;
    if (!state.produtosDiscutidos.includes(p.id)) state.produtosDiscutidos.push(p.id);

    const precoNaQuantidade = (sub: (typeof activeSubs)[number]): number | null => {
      if (!input.quantidade) return null;
      const range = sub.prices.find(
        (r) => input.quantidade! >= r.min && input.quantidade! <= r.max
      );
      return range?.price ?? null;
    };

    // Cada cor pode ter a própria tabela de preços — não assumir a do primeiro
    // subproduto, senão o agente informa preço errado para as outras cores.
    const subprodutos = activeSubs.map((s) => ({
      subproduto_id: s.id,
      cor: s.color,
      sku: s.sku,
      estoque: s.stock,
      disponivel: s.stock > 0,
      tabela_precos: s.prices.map((r) => ({ min: r.min, max: r.max, preco: r.price })),
      preco_para_quantidade: precoNaQuantidade(s),
    }));

    const tabelasDistintas = new Set(activeSubs.map((s) => JSON.stringify(s.prices)));
    const precosVariamPorCor = tabelasDistintas.size > 1;

    const precosNaQuantidade = subprodutos
      .map((s) => s.preco_para_quantidade)
      .filter((v): v is number => v !== null);

    return {
      id: p.id,
      nome: p.name,
      descricao: p.description,
      min_quantity: p.min_quantity,
      subprodutos_ativos: subprodutos,
      precos_variam_por_cor: precosVariamPorCor,
      /** Só quando todas as cores compartilham a mesma tabela; senão use a de cada subproduto. */
      tabela_precos: precosVariamPorCor ? null : (subprodutos[0]?.tabela_precos ?? []),
      preco_para_quantidade_a_partir_de: precosNaQuantidade.length
        ? Math.min(...precosNaQuantidade)
        : null,
      imagens: p.images.map((i) => i.url),
      personalizacoes: p.customizations.map((c) => `${c.type}: ${c.description}`),
    };
  } catch (err) {
    return { erro: translateApiError(err) };
  }
}
