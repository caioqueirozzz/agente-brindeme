import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { MockBrindeMeClient, translateApiError } from "../integrations/brindeme/mockClient.js";
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

  // Idempotency: check if this token was already used
  if (client instanceof MockBrindeMeClient) {
    const existing = client.getBudgetByToken(input.token_confirmacao);
    if (existing) {
      return {
        status: "ja_criado",
        codigo: existing.code,
        status_orcamento: existing.status_name,
        mensagem: "Orçamento já criado anteriormente com este token.",
      };
    }
  }

  try {
    const body = state.orcamentoPendente.body;
    const budget = await client.createBudget(body);

    // Register token→budget for idempotency
    if (client instanceof MockBrindeMeClient) {
      client.setBudgetToken(input.token_confirmacao, budget.id);
    }

    state.orcamentos.push(budget.code);
    state.orcamentoPendente = undefined;
    state.falhasConsecutivas = 0;

    return {
      status: "criado",
      codigo: budget.code,
      status_orcamento: budget.status_name,
      mensagem: "Orçamento criado! Nossa equipe vai preparar o mockup e entrar em contato em breve.",
    };
  } catch (err) {
    // criar_orcamento NEVER auto-retries
    const translated = translateApiError(err);
    state.falhasConsecutivas += 1;
    return {
      erro: translated.erro,
      tentar_novamente: false,
      instrucao:
        state.falhasConsecutivas >= 2
          ? "transferir"
          : "informar_instabilidade",
    };
  }
}
