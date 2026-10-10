import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/mockClient.js";
import type { ConversationState } from "../agent/state.js";

export const detalharProdutoSchema = z.object({
  produto_id: z.string().describe("ID do produto"),
  quantidade: z.number().int().positive().optional().describe("Quantidade desejada para calcular o preço"),
});

export type DetalharProdutoInput = z.infer<typeof detalharProdutoSchema>;

export async function detalharProdutoHandler(
  input: DetalharProdutoInput,
  _state: ConversationState,
  client: BrindeMeClient
) {
  try {
    const p = await client.getProduct(input.produto_id);

    const activeSubs = p.subproducts.filter((s) => s.status);

    let precoPorFaixa: Array<{ min: number; max: number; preco: number }> = [];
    let precoParaQuantidade: number | null = null;

    if (activeSubs.length > 0) {
      precoPorFaixa = activeSubs[0].prices.map((r) => ({
        min: r.min,
        max: r.max,
        preco: r.price,
      }));
      if (input.quantidade) {
        const range = activeSubs[0].prices.find(
          (r) => input.quantidade! >= r.min && input.quantidade! <= r.max
        );
        precoParaQuantidade = range?.price ?? null;
      }
    }

    return {
      id: p.id,
      nome: p.name,
      descricao: p.description,
      min_quantity: p.min_quantity,
      subprodutos_ativos: activeSubs.map((s) => ({
        subproduto_id: s.id,
        cor: s.color,
        sku: s.sku,
        estoque: s.stock,
        disponivel: s.stock > 0,
      })),
      tabela_precos: precoPorFaixa,
      preco_para_quantidade: precoParaQuantidade,
      imagens: p.images.map((i) => i.url),
      personalizacoes: p.customizations.map((c) => `${c.type}: ${c.description}`),
    };
  } catch (err) {
    return { erro: translateApiError(err) };
  }
}
