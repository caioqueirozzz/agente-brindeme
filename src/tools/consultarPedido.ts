import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/errors.js";
import type { ConversationState } from "../agent/state.js";
import {
  localizarPedido,
  FileOrderIndexStore,
  type OrderIndexStore,
} from "../integrations/brindeme/orderIndex.js";
import { traduzirStatusPedido } from "../knowledge/statusMap.js";

export const consultarPedidoSchema = z.object({
  codigo: z.string().describe("Código do pedido informado pelo cliente (ex: 2, 21, #105)"),
  email: z.string().email().optional().describe("E-mail do cliente para validação adicional"),
});

export type ConsultarPedidoInput = z.infer<typeof consultarPedidoSchema>;

const MAX_VALIDATION_FAILURES = 2;

/**
 * Teto de consultas por conversa. Sem isso, o caminho "telefone não bate →
 * pede e-mail" não custa nada e permite varrer códigos de pedido: a resposta
 * distingue código inexistente de código real.
 */
const MAX_CONSULTAS = 5;

export type PedidoSafeResult =
  | {
      resultado: "encontrado";
      codigo: string;
      status: string;
      status_frase: string;
      status_conhecido: boolean;
      tipo_entrega: string;
      prazo_entrega: number | null;
    }
  | { resultado: "nao_encontrado" }
  | { resultado: "precisa_email"; mensagem: string }
  | { resultado: "nao_validado"; mensagem: string }
  | { resultado: "bloqueado"; mensagem: string; instrucao: "transferir"; motivo_sugerido: string }
  | { erro: ReturnType<typeof translateApiError> };

function bloquear(mensagem: string): PedidoSafeResult {
  // instrucao/motivo explícitos: antes a mensagem prometia transferir mas nada
  // no código garantia — dependia do modelo decidir chamar transferir_humano.
  return { resultado: "bloqueado", mensagem, instrucao: "transferir", motivo_sugerido: "outro" };
}

/** Injetável para teste; em produção lê o índice sincronizado pelo job. */
let storePadrao: OrderIndexStore | null = null;
export function setOrderIndexStore(store: OrderIndexStore | null): void {
  storePadrao = store;
}
function getStore(): OrderIndexStore {
  if (!storePadrao) storePadrao = new FileOrderIndexStore();
  return storePadrao;
}

/**
 * Fluxo da Fase 2, item 4:
 *   1. o job já gravou os pedidos da janela no índice local
 *   2. o cliente informa o código; localizamos no índice
 *   3. o telefone do WhatsApp precisa bater; se não, pede o e-mail; se ainda
 *      não bater, transfere
 *   4. validado, busca o pedido completo em GET /order/{id} e devolve só
 *      status, prazo e entrega
 */
export async function consultarPedidoHandler(
  input: ConsultarPedidoInput,
  state: ConversationState,
  client: BrindeMeClient
): Promise<PedidoSafeResult> {
  if (state.falhasValidacaoPedido >= MAX_VALIDATION_FAILURES) {
    return bloquear(
      "Muitas tentativas de validação sem sucesso. Por segurança, vou transferir para um atendente."
    );
  }

  if (state.consultasPedido >= MAX_CONSULTAS) {
    return bloquear(
      "Muitas consultas de pedido nesta conversa. Por segurança, vou transferir para um atendente."
    );
  }
  state.consultasPedido += 1;

  // Passos 2 e 3: localizar e validar ANTES de tocar na API.
  const achado = localizarPedido(getStore(), {
    codigo: input.codigo,
    telefone: state.telefone,
    email: input.email,
  });

  if (!achado.encontrado) {
    return { resultado: "nao_encontrado" };
  }

  if (!achado.validado) {
    if (!input.email) {
      return {
        resultado: "precisa_email",
        mensagem:
          "Não consegui localizar o pedido pelo telefone. Pode confirmar o e-mail cadastrado?",
      };
    }

    state.falhasValidacaoPedido += 1;
    if (state.falhasValidacaoPedido >= MAX_VALIDATION_FAILURES) {
      return bloquear(
        "Não consegui validar os dados. Por segurança, vou transferir para um atendente."
      );
    }
    return {
      resultado: "nao_validado",
      mensagem:
        "Não consegui confirmar o pedido com os dados informados. Verifique e tente novamente.",
    };
  }

  // Passo 4: só agora o pedido completo sai da API.
  try {
    const order = await client.getOrder(achado.id);
    return buildSafeResult(order);
  } catch (err) {
    const translated = translateApiError(err);
    if (translated.erro === "nao_encontrado") return { resultado: "nao_encontrado" };
    return { erro: translated };
  }
}

function buildSafeResult(order: import("../integrations/brindeme/types.js").Order) {
  const status = traduzirStatusPedido(order.status_name);
  return {
    resultado: "encontrado" as const,
    codigo: order.code,
    status: order.status_name,
    // Frase aprovada em vez do rótulo cru da plataforma; status desconhecido
    // vira frase neutra em vez de o modelo inventar o significado.
    status_frase: status.frase,
    status_conhecido: status.conhecido,
    tipo_entrega: order.shipping_type,
    prazo_entrega: order.shipping_time,
    // NUNCA incluir: customer_cpf, customer_email, customer_phone, file_url, nfs, bankslips
  };
}
