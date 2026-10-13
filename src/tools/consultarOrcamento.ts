import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/errors.js";
import type { ConversationState } from "../agent/state.js";
import { phoneMatches } from "../agent/state.js";
import { traduzirStatusOrcamento } from "../knowledge/statusMap.js";

export const consultarOrcamentoSchema = z.object({
  codigo: z.string().describe("Código do orçamento (ex: ORC-1042)"),
});

export type ConsultarOrcamentoInput = z.infer<typeof consultarOrcamentoSchema>;

export async function consultarOrcamentoHandler(
  input: ConsultarOrcamentoInput,
  state: ConversationState,
  client: BrindeMeClient
) {
  // Only reveal budgets created in this conversation
  if (!state.orcamentos.includes(input.codigo)) {
    return { resultado: "nao_encontrado", mensagem: "Orçamento não encontrado." };
  }

  // GET /budget/{id} responde 404 para o código — precisa do UUID guardado
  // na criação. Sem ele, não há como localizar o orçamento.
  const budgetId = state.orcamentoIds[input.codigo];
  if (!budgetId) {
    return { resultado: "nao_encontrado", mensagem: "Orçamento não encontrado." };
  }

  try {
    const budget = await client.getBudget(budgetId);

    if (!phoneMatches(state.telefone, budget.customer_phone)) {
      return { resultado: "nao_encontrado", mensagem: "Orçamento não encontrado." };
    }

    const status = traduzirStatusOrcamento(budget.status_name);
    return {
      resultado: "encontrado",
      codigo: budget.code,
      status: budget.status_name,
      status_frase: status.frase,
      status_conhecido: status.conhecido,
      itens: budget.items.map((i) => ({
        produto: i.product_name,
        cor: i.color,
        quantidade: i.quantity,
        subtotal: i.subtotal,
      })),
      mockup_url: budget.mockup_url ?? null,
    };
  } catch (err) {
    return { erro: translateApiError(err) };
  }
}
