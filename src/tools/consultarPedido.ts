import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/mockClient.js";
import type { ConversationState } from "../agent/state.js";
import { phoneMatches } from "../agent/state.js";

export const consultarPedidoSchema = z.object({
  codigo: z.string().describe("Código do pedido (ex: PED-2024-001)"),
  email: z.string().email().optional().describe("E-mail do cliente para validação adicional"),
});

export type ConsultarPedidoInput = z.infer<typeof consultarPedidoSchema>;

const MAX_VALIDATION_FAILURES = 2;

export type PedidoSafeResult =
  | { resultado: "encontrado"; codigo: string; status: string; tipo_entrega: string; prazo_entrega: number }
  | { resultado: "nao_encontrado" }
  | { resultado: "precisa_email"; mensagem: string }
  | { resultado: "nao_validado"; mensagem: string }
  | { resultado: "bloqueado"; mensagem: string }
  | { erro: ReturnType<typeof translateApiError> };

export async function consultarPedidoHandler(
  input: ConsultarPedidoInput,
  state: ConversationState,
  client: BrindeMeClient
): Promise<PedidoSafeResult> {
  if (state.falhasValidacaoPedido >= MAX_VALIDATION_FAILURES) {
    return {
      resultado: "bloqueado",
      mensagem:
        "Muitas tentativas de validação sem sucesso. Por segurança, vou transferir para um atendente.",
    };
  }

  let order;
  try {
    order = await client.getOrder(input.codigo);
  } catch (err) {
    const translated = translateApiError(err);
    if (translated.erro === "nao_encontrado") return { resultado: "nao_encontrado" };
    return { erro: translated };
  }

  // Step 1: phone match
  if (phoneMatches(state.telefone, order.customer_phone)) {
    return buildSafeResult(order);
  }

  // Step 2: phone doesn't match — need email
  if (!input.email) {
    return {
      resultado: "precisa_email",
      mensagem: "Não consegui localizar o pedido pelo telefone. Pode confirmar o e-mail cadastrado?",
    };
  }

  if (order.customer_email.toLowerCase() === input.email.toLowerCase()) {
    return buildSafeResult(order);
  }

  state.falhasValidacaoPedido += 1;

  if (state.falhasValidacaoPedido >= MAX_VALIDATION_FAILURES) {
    return {
      resultado: "bloqueado",
      mensagem:
        "Não consegui validar os dados. Por segurança, vou transferir para um atendente.",
    };
  }

  return {
    resultado: "nao_validado",
    mensagem: "Não consegui confirmar o pedido com os dados informados. Verifique e tente novamente.",
  };
}

function buildSafeResult(order: import("../integrations/brindeme/types.js").Order) {
  return {
    resultado: "encontrado" as const,
    codigo: order.code,
    status: order.status_name,
    tipo_entrega: order.shipping_type,
    prazo_entrega: order.shipping_time,
    // NEVER include: customer_cpf, customer_email, customer_phone, file_url, nfs, bankslips
  };
}
