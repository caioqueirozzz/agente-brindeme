import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/errors.js";
import { arredondar } from "../integrations/brindeme/mappers.js";
import type { ConversationState } from "../agent/state.js";
import { marcaUltimaMensagemCliente, type OrcamentoPendente } from "../agent/state.js";

export const prepararOrcamentoSchema = z.object({
  tipo: z.enum(["PF", "PJ"]).describe("Tipo de pessoa: PF (física) ou PJ (jurídica)"),
  nome: z.string().min(2).describe("Nome completo do cliente ou razão social"),
  email: z.string().email().describe("E-mail válido do cliente"),
  itens: z.array(z.object({
    subproduto_id: z.string(),
    quantidade: z.number().int().min(1),
  })).min(1).max(100),
  observacoes: z.string().max(300).optional().describe("Observações adicionais (máx. 300 chars)"),
});

export type PrepararOrcamentoInput = z.infer<typeof prepararOrcamentoSchema>;

export async function prepararOrcamentoHandler(
  input: PrepararOrcamentoInput,
  state: ConversationState,
  client: BrindeMeClient
) {
  try {
    const itensSumario = [];
    let totalEstimado = 0;

    // Cache por produto: vários itens podem vir do mesmo produto.
    const cache = new Map<string, Awaited<ReturnType<typeof client.getProduct>>>();

    for (const item of input.itens) {
      // A listagem não traz subprodutos, então não dá para varrer o catálogo:
      // o produto de origem vem do mapa preenchido por buscar/detalhar.
      const produtoId = state.subprodutoParaProduto[item.subproduto_id];
      // buscar_produtos só mostra o id do produto; o modelo às vezes manda esse no lugar da cor.
      if (!produtoId && state.produtosDiscutidos.includes(item.subproduto_id)) {
        const produto = await client.getProduct(item.subproduto_id);
        for (const s of produto.subproducts) state.subprodutoParaProduto[s.id] = produto.id;
        return {
          erro: "informe_a_cor",
          produto: produto.name,
          opcoes: produto.subproducts
            .filter((s) => s.status && s.stock > 0)
            .map((s) => ({ subproduto_id: s.id, cor: s.color, estoque: s.stock })),
          instrucao:
            "Esse id é do produto, não da cor. Use o subproduto_id da cor que o cliente pediu (se ele não disse, pergunte) e chame preparar_orcamento de novo.",
        };
      }
      if (!produtoId) {
        return {
          erro: "subproduto_desconhecido",
          subproduto_id: item.subproduto_id,
          instrucao:
            "Chame detalhar_produto para esse produto antes de preparar o orçamento.",
        };
      }

      let p = cache.get(produtoId);
      if (!p) {
        p = await client.getProduct(produtoId);
        cache.set(produtoId, p);
      }

      const sub = p.subproducts.find((x) => x.id === item.subproduto_id);
      if (!sub) {
        return { erro: "subproduto_nao_encontrado", subproduto_id: item.subproduto_id };
      }
      // Produto desativado na loja com a cor ainda ativa: buscar_produtos já não o sugere, o orçamento também não.
      if (!p.status) {
        return {
          erro: "produto_inativo",
          subproduto_id: item.subproduto_id,
          mensagem: `"${p.name}" não está mais disponível na loja.`,
        };
      }
      if (!sub.status) {
        return {
          erro: "subproduto_inativo",
          subproduto_id: item.subproduto_id,
          mensagem: `O subproduto "${sub.color}" de "${p.name}" está inativo.`,
        };
      }
      if (sub.stock < item.quantidade) {
        return {
          erro: "estoque_insuficiente",
          subproduto_id: item.subproduto_id,
          estoque_disponivel: sub.stock,
          quantidade_solicitada: item.quantidade,
        };
      }
      if (item.quantidade < p.min_quantity) {
        return {
          erro: "abaixo_do_minimo",
          subproduto_id: item.subproduto_id,
          min_quantity: p.min_quantity,
          quantidade_solicitada: item.quantidade,
        };
      }

      const range = sub.prices.find(
        (r) => item.quantidade >= r.min && item.quantidade <= r.max
      );
      // O preço de referência do produto só vale para cor SEM tabela (relatorio-campos-api.md).
      // Com tabela e a quantidade fora de todas as faixas, o resumo mostraria um preço que a loja não pratica.
      if (!range && sub.prices.length > 0) {
        return {
          erro: "sem_faixa_de_preco",
          subproduto_id: item.subproduto_id,
          quantidade_solicitada: item.quantidade,
          faixas: sub.prices.map((r) => ({ min: r.min, max: r.max })),
          instrucao: "A quantidade não está em nenhuma faixa de preço desta cor. Ofereça uma quantidade dentro das faixas ou transfira.",
        };
      }
      const price = range?.price ?? p.price;

      const subtotal = arredondar(price * item.quantidade);
      totalEstimado = arredondar(totalEstimado + subtotal);
      itensSumario.push({
        subproduto_id: item.subproduto_id,
        cor: sub.color,
        nome_produto: p.name,
        quantidade: item.quantidade,
        preco_unitario: price,
        subtotal,
      });
    }

    const arte_refs = state.artes.map((a) => a.ref);

    const token = uuidv4();
    const expiraEm = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const pending: OrcamentoPendente = {
      token,
      expiraEm,
      mensagemDoResumo: marcaUltimaMensagemCliente(state),
      resumo: {
        tipo: input.tipo,
        nome: input.nome,
        email: input.email,
        telefone: state.telefone,
        itens: itensSumario,
        total_estimado: totalEstimado,
        observacoes: input.observacoes,
        arte_refs,
      },
      body: {
        type: input.tipo,
        customer_name: input.nome,
        // Do número da conversa: o cliente não abre orçamento no nome de outro telefone.
        customer_phone: state.telefone,
        customer_email: input.email,
        items: input.itens.map((i) => ({ subproduct_id: i.subproduto_id, quantity: i.quantidade })),
        comments: buildComments(input.observacoes, arte_refs),
        origin: "whatsapp-agente-ia",
      },
    };

    state.orcamentoPendente = pending;
    state.cliente.tipo = input.tipo;
    state.cliente.nome = input.nome;
    state.cliente.email = input.email;

    return {
      status: "resumo_pronto",
      token_confirmacao: token,
      expira_em_minutos: 15,
      resumo: pending.resumo,
      instrucao: "Mostre este resumo ao cliente e aguarde confirmação explícita antes de chamar criar_orcamento.",
    };
  } catch (err) {
    return { erro: translateApiError(err) };
  }
}

function buildComments(observacoes?: string, arteRefs?: string[]): string {
  const parts: string[] = [];
  if (observacoes) parts.push(`Obs: ${observacoes}`);
  if (arteRefs?.length) parts.push(`Artes: ${arteRefs.join(", ")}`);
  return parts.join(" | ").slice(0, 500);
}
