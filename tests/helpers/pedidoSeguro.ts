import { mapOrder } from "../../src/integrations/brindeme/mappers.js";
import { traduzirStatusPedido } from "../../src/knowledge/statusMap.js";

/**
 * Espelha buildSafeResult de consultarPedido: o que efetivamente chega ao
 * modelo depois da validação do cliente.
 */
export function buildSafeResultParaTeste(bruto: Record<string, unknown>) {
  const order = mapOrder(bruto);
  const status = traduzirStatusPedido(order.status_name);
  return {
    resultado: "encontrado" as const,
    codigo: order.code,
    status: order.status_name,
    status_frase: status.frase,
    status_conhecido: status.conhecido,
    tipo_entrega: order.shipping_type,
    prazo_entrega: order.shipping_time,
  };
}
