import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/mockClient.js";
import type { ConversationState } from "../agent/state.js";
import type { Product } from "../integrations/brindeme/types.js";

export const buscarProdutosSchema = z.object({
  consulta: z.string().describe("Palavras-chave para busca (produto, ocasião, material etc.)"),
  quantidade: z.number().int().positive().optional().describe("Quantidade desejada"),
  preco_max_unitario: z.number().positive().optional().describe("Preço máximo por unidade em reais"),
  ocasiao: z.string().optional().describe("Ocasião do brinde (ex: natal, corporativo, formatura)"),
});

export type BuscarProdutosInput = z.infer<typeof buscarProdutosSchema>;

function getPriceForQuantity(product: Product, qty?: number): number | null {
  if (!qty) return product.price;
  const activeSubs = product.subproducts.filter((s) => s.status && s.stock > 0);
  if (activeSubs.length === 0) return null;
  for (const sub of activeSubs) {
    const range = sub.prices.find((r) => qty >= r.min && qty <= r.max);
    if (range) return range.price;
  }
  return null;
}

function getTotalStock(product: Product): number {
  return product.subproducts
    .filter((s) => s.status)
    .reduce((acc, s) => acc + s.stock, 0);
}

export async function buscarProdutosHandler(
  input: BuscarProdutosInput,
  _state: ConversationState,
  client: BrindeMeClient
) {
  try {
    const response = await client.listProducts({ per_page: 100 });
    const all = response.data;

    const terms = input.consulta.toLowerCase().split(/\s+/).filter(Boolean);
    const ocasiao = input.ocasiao?.toLowerCase();

    const eliminated = { inativo: 0, estoque: 0, minimo: 0, preco: 0 };

    const candidates = all.filter((p) => {
      if (!p.status) { eliminated.inativo++; return false; }

      const totalStock = getTotalStock(p);
      if (input.quantidade && totalStock < input.quantidade) { eliminated.estoque++; return false; }
      if (input.quantidade && input.quantidade < p.min_quantity) { eliminated.minimo++; return false; }

      const preco = getPriceForQuantity(p, input.quantidade);
      if (input.preco_max_unitario && (preco === null || preco > input.preco_max_unitario)) {
        eliminated.preco++;
        return false;
      }

      return true;
    });

    const scored = candidates.map((p) => {
      let score = 0;
      const searchText = [p.name, p.description, ...p.categories.map((c) => c.name)].join(" ").toLowerCase();
      const tags = (p.tags_ocasiao ?? []).map((t) => t.toLowerCase());

      for (const term of terms) {
        if (searchText.includes(term)) score += 2;
        if (tags.some((t) => t.includes(term))) score += 3;
      }
      if (ocasiao && tags.some((t) => t.includes(ocasiao))) score += 5;

      return { product: p, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top5 = scored.slice(0, 5);

    if (top5.length === 0) {
      const reasons: string[] = [];
      if (eliminated.inativo > 0) reasons.push(`${eliminated.inativo} produto(s) inativo(s)`);
      if (eliminated.estoque > 0) reasons.push(`${eliminated.estoque} produto(s) sem estoque suficiente`);
      if (eliminated.minimo > 0) reasons.push(`${eliminated.minimo} produto(s) com pedido mínimo acima da quantidade solicitada`);
      if (eliminated.preco > 0) reasons.push(`${eliminated.preco} produto(s) acima do preço máximo`);
      return {
        resultado: "nenhum_produto_encontrado",
        razao: reasons.join("; ") || "Nenhum produto corresponde à busca.",
      };
    }

    return {
      resultado: "produtos_encontrados",
      total: top5.length,
      produtos: top5.map(({ product: p }) => {
        const preco = getPriceForQuantity(p, input.quantidade);
        const cores = p.subproducts
          .filter((s) => s.status && s.stock > 0)
          .map((s) => s.color);
        return {
          id: p.id,
          nome: p.name,
          preco_unitario_na_quantidade: preco,
          min_quantity: p.min_quantity,
          cores_disponiveis: cores,
          imagem_url: p.images[0]?.url ?? null,
        };
      }),
    };
  } catch (err) {
    return { erro: translateApiError(err) };
  }
}
