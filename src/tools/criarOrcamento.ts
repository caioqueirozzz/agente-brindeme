import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/errors.js";
import type { ConversationState } from "../agent/state.js";
import { isTokenValid } from "../agent/state.js";

export const criarOrcamentoSchema = z.object({
  token_confirmacao: z.string().describe("Token retornado por preparar_orcamento"),
});

export type CriarOrcamentoInput = z.infer<typeof criarOrcamentoSchema>;

export async function criarOrcamentoHandler(
  input: CriarOrcamentoInput,
  state: ConversationState,
  client: BrindeMeClient
) {
  if (!state.orcamentoPendente) {
    return { erro: "sem_orcamento_pendente", mensagem: "Nenhum orçamento pendente. Use preparar_orcamento primeiro." };
  }

  if (state.orcamentoPendente.token !== input.token_confirmacao) {
    return { erro: "token_invalido", mensagem: "Token de confirmação inválido." };
  }

  if (!isTokenValid(state)) {
    state.orcamentoPendente = undefined;
    return { erro: "token_expirado", mensagem: "O resumo expirou (15 min). Gere um novo com preparar_orcamento." };
  }

  // Idempotência: o token já foi usado nesta conversa?
  const jaCriado = state.orcamentoTokens[input.token_confirmacao];
  if (jaCriado) {
    return {
      status: "ja_criado",
      codigo: jaCriado,
      mensagem: "Orçamento já criado anteriormente com este token.",
    };
  }

  try {
    const body = state.orcamentoPendente.body;
    // TESTADO em 12/10/2026: a API IGNORA o header Idempotency-Key — duas
    // chamadas com a mesma chave criaram os orçamentos 26 e 27. A guarda acima
    // (state.orcamentoTokens) é a ÚNICA proteção contra duplicata. O header
    // continua sendo enviado caso a loja passe a suportá-lo.
    const budget = await client.createBudget(body, { idempotencyKey: input.token_confirmacao });

    state.orcamentoTokens[input.token_confirmacao] = budget.code;
    state.orcamentos.push(budget.code);
    // GET /budget/{id} só aceita o UUID; o cliente só conhece o código.
    state.orcamentoIds[budget.code] = budget.id;
    state.orcamentoPendente = undefined;

    return {
      status: "criado",
      codigo: budget.code,
      status_orcamento: budget.status_name,
      mensagem: "Orçamento criado! Nossa equipe vai preparar o mockup e entrar em contato em breve.",
    };
  } catch (err) {
    // criar_orcamento NUNCA faz retry automático: o pedido pode ter sido criado
    // do outro lado mesmo com a resposta falhando.
    return { erro: { ...translateApiError(err), tentar_novamente: false } };
  }
}
