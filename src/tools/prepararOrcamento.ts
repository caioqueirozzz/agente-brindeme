import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/mockClient.js";
import type { ConversationState } from "../agent/state.js";
import type { OrcamentoPendente } from "../agent/state.js";

export const prepararOrcamentoSchema = z.object({
  tipo: z.enum(["PF", "PJ"]).describe("Tipo de pessoa: PF (física) ou PJ (jurídica)"),
  nome: z.string().min(2).describe("Nome completo do cliente ou razão social"),
  telefone: z.string().describe("Telefone com DDD e código do país (ex: 5583999990000)"),
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
    const products = await client.listProducts({ per_page: 100 });

    const itensSumario = [];
    let totalEstimado = 0;

    for (const item of input.itens) {
      let found: { productName: string; color: string; price: number } | null = null;
      let minQty = 1;

      for (const p of products.data) {
        const sub = p.subproducts.find((s) => s.id === item.subproduto_id);
        if (sub) {
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
          minQty = p.min_quantity;
          const range = sub.prices.find(
            (r) => item.quantidade >= r.min && item.quantidade <= r.max
          );
          const price = range?.price ?? p.price;
          found = { productName: p.name, color: sub.color, price };
          break;
        }
      }

      if (!found) {
        return {
          erro: "subproduto_nao_encontrado",
          subproduto_id: item.subproduto_id,
        };
      }

      const subtotal = found.price * item.quantidade;
      totalEstimado += subtotal;
      itensSumario.push({
        subproduto_id: item.subproduto_id,
        cor: found.color,
        nome_produto: found.productName,
        quantidade: item.quantidade,
        preco_unitario: found.price,
        subtotal,
      });
    }

    const arte_refs = state.artes.map((a) => a.ref);

    const token = uuidv4();
    const expiraEm = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const pending: OrcamentoPendente = {
      token,
      expiraEm,
      resumo: {
        tipo: input.tipo,
        nome: input.nome,
        email: input.email,
        telefone: input.telefone,
        itens: itensSumario,
        total_estimado: totalEstimado,
        observacoes: input.observacoes,
        arte_refs,
      },
      body: {
        type: input.tipo,
        customer_name: input.nome,
        customer_phone: input.telefone,
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
