import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/errors.js";
import type { ConversationState } from "../agent/state.js";
import type { Product } from "../integrations/brindeme/types.js";

export const buscarProdutosSchema = z.object({
  consulta: z.string().describe("Palavras-chave para busca (produto, ocasião, material etc.)"),
  quantidade: z.number().int().positive().optional().describe("Quantidade desejada"),
  preco_max_unitario: z.number().positive().optional().describe("Preço máximo por unidade em reais"),
  ocasiao: z.string().optional().describe("Ocasião do brinde (ex: natal, corporativo, formatura)"),
});

export type BuscarProdutosInput = z.infer<typeof buscarProdutosSchema>;

/**
 * Quantos candidatos da triagem textual recebem GET /product/{id}.
 * A listagem não traz subprodutos, estoque real nem quantidade mínima — sem
 * hidratar, qualquer filtro de disponibilidade responde errado.
 */
const MAX_HIDRATACOES = 8;

/** Até onde a busca enxerga o catálogo enquanto não existe o índice da Fase 3. */
const PAGINA_UNICA = 100;

/**
 * Menor preço entre as cores disponíveis na quantidade pedida. Pega o mínimo —
 * não o primeiro subproduto — porque cada cor pode ter tabela própria, e o que
 * o agente anuncia na busca é o "a partir de".
 */
function getPriceForQuantity(product: Product, qty?: number): number | null {
  if (!qty) return product.price;
  const activeSubs = product.subproducts.filter((s) => s.status && s.stock > 0);
  const precos = activeSubs
    .map((sub) => sub.prices.find((r) => qty >= r.min && qty <= r.max)?.price)
    .filter((p): p is number => p !== undefined);
  return precos.length ? Math.min(...precos) : null;
}

function getTotalStock(product: Product): number {
  return product.subproducts
    .filter((s) => s.status)
    .reduce((acc, s) => acc + s.stock, 0);
}

export async function buscarProdutosHandler(
  input: BuscarProdutosInput,
  state: ConversationState,
  client: BrindeMeClient
) {
  try {
    const response = await client.listProducts({ per_page: PAGINA_UNICA });
    const all = response.data;

    const terms = input.consulta.toLowerCase().split(/\s+/).filter(Boolean);
    const ocasiao = input.ocasiao?.toLowerCase();

    // 1. Triagem textual — usa só campos presentes na listagem.
    const pontuar = (p: Product): number => {
      let score = 0;
      const texto = [p.name, p.description, ...p.categories.map((c) => c.name)]
        .join(" ")
        .toLowerCase();
      const tags = (p.tags_ocasiao ?? []).map((t) => t.toLowerCase());
      for (const term of terms) {
        if (texto.includes(term)) score += 2;
        if (tags.some((t) => t.includes(term))) score += 3;
      }
      if (ocasiao && tags.some((t) => t.includes(ocasiao))) score += 5;
      if (p.featured) score += 1;
      return score;
    };

    const triados = all
      .filter((p) => p.status)
      .map((p) => ({ product: p, score: pontuar(p) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_HIDRATACOES);

    if (triados.length === 0) {
      return {
        resultado: "nenhum_produto_encontrado",
        razao: `Nenhum produto corresponde a "${input.consulta}" entre os ${all.length} consultados.`,
        cobertura_parcial: response.total > all.length,
        total_no_catalogo: response.total,
      };
    }

    // 2. Hidratação: só GET /product/{id} tem subprodutos, estoque e mínimo.
    const precisaHidratar = triados.some((t) => t.product.detalhe_carregado === false);
    let candidatos = triados;
    let falhasHidratacao = 0;

    if (precisaHidratar) {
      const hidratados = await Promise.all(
        triados.map(async (t) => {
          if (t.product.detalhe_carregado !== false) return t;
          try {
            return { product: await client.getProduct(t.product.id), score: t.score };
          } catch {
            falhasHidratacao++;
            return null;
          }
        })
      );
      candidatos = hidratados.filter((x): x is { product: Product; score: number } => x !== null);
    }

    if (candidatos.length === 0) {
      return {
        erro: {
          falha_api: true as const,
          erro: "detalhe_indisponivel",
          tentar_novamente: true,
          detalhes: "Não foi possível carregar os detalhes dos produtos encontrados.",
        },
      };
    }

    // Guarda a origem de cada subproduto hidratado, para preparar_orcamento.
    for (const { product } of candidatos) {
      for (const sub of product.subproducts) state.subprodutoParaProduto[sub.id] = product.id;
    }

    // 3. Filtros rígidos — agora sobre dados completos.
    const eliminados = { estoque: 0, minimo: 0, preco: 0 };
    const aprovados = candidatos.filter(({ product: p }) => {
      if (input.quantidade && getTotalStock(p) < input.quantidade) {
        eliminados.estoque++;
        return false;
      }
      if (input.quantidade && input.quantidade < p.min_quantity) {
        eliminados.minimo++;
        return false;
      }
      const preco = getPriceForQuantity(p, input.quantidade);
      if (input.preco_max_unitario && (preco === null || preco > input.preco_max_unitario)) {
        eliminados.preco++;
        return false;
      }
      return true;
    });

    if (aprovados.length === 0) {
      const razoes: string[] = [];
      if (eliminados.minimo > 0)
        razoes.push(`${eliminados.minimo} com pedido mínimo acima da quantidade pedida`);
      if (eliminados.estoque > 0) razoes.push(`${eliminados.estoque} sem estoque suficiente`);
      if (eliminados.preco > 0) razoes.push(`${eliminados.preco} acima do preço máximo`);
      return {
        resultado: "nenhum_produto_encontrado",
        razao: razoes.join("; ") || "Nenhum produto atende aos critérios.",
        // Dá ao agente o que propor como ajuste, em vez de só negar.
        menor_minimo: Math.min(...candidatos.map((c) => c.product.min_quantity)),
        cobertura_parcial: response.total > all.length,
      };
    }

    const top = aprovados.slice(0, 3);
    return {
      resultado: "produtos_encontrados",
      total: top.length,
      cobertura_parcial: response.total > all.length,
      ...(falhasHidratacao > 0 ? { produtos_nao_carregados: falhasHidratacao } : {}),
      produtos: top.map(({ product: p }) => {
        const preco = getPriceForQuantity(p, input.quantidade);
        return {
          id: p.id,
          nome: p.name,
          sku: p.sku,
          preco_unitario_na_quantidade: preco,
          min_quantity: p.min_quantity,
          cores_disponiveis: p.subproducts.filter((s) => s.status && s.stock > 0).map((s) => s.color),
          imagem_url: p.images[0]?.url ?? null,
        };
      }),
    };
  } catch (err) {
    return { erro: translateApiError(err) };
  }
}
