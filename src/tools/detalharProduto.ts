import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { ApiError, translateApiError } from "../integrations/brindeme/errors.js";
import type { ConversationState } from "../agent/state.js";

/** Cobre "me fala da primeira, e da segunda? fico com a primeira". */
const PRODUTOS_DETALHADOS_GUARDADOS = 3;

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
    const detalhado = { id: p.id, nome: p.name, cores: activeSubs.map((s) => ({ subproduto_id: s.id, cor: s.color })) };
    state.produtosDetalhados = [detalhado, ...(state.produtosDetalhados ?? []).filter((d) => d.id !== p.id)].slice(
      0,
      PRODUTOS_DETALHADOS_GUARDADOS
    );

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
      // O modelo errou a conta (112 ≥ 100) e transferiu: a comparação sai pronta.
      atende_quantidade: input.quantidade ? s.stock >= input.quantidade : null,
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
      cores_que_atendem_quantidade: input.quantidade
        ? subprodutos.filter((s) => s.atende_quantidade).map((s) => s.cor)
        : null,
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
    // Id inventado pelo modelo não é a API fora do ar: não conta para a transferência por falha.
    if (err instanceof ApiError && err.status === 404) {
      return {
        resultado: "produto_nao_encontrado" as const,
        instrucao_ao_agente: "Esse produto_id não existe. Ache o produto com buscar_produtos e use o id que ele devolver; nunca invente id.",
      };
    }
    return { erro: translateApiError(err) };
  }
}
