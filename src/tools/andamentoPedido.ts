import { z } from "zod";
import type { ConversationState } from "../agent/state.js";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { config } from "../config.js";

export const andamentoPedidoSchema = z.object({
  codigo: z
    .string()
    .max(30)
    .optional()
    .describe("Código que o cliente citou (ex.: PED-0012), para destacar esse pedido. Opcional: sem ele vêm todos os pedidos do cliente."),
});

export type AndamentoPedidoInput = z.infer<typeof andamentoPedidoSchema>;

const PRAZO_MS = 8_000;

/** Pedido como o CRM devolve (src/app/api/integracao/pedidos do CRM): já sem nada interno da equipe. */
interface PedidoNoQuadro {
  codigo: string;
  [campo: string]: unknown;
}

type Buscar = (telefone: string) => Promise<PedidoNoQuadro[]>;

async function buscarNoCrm(telefone: string): Promise<PedidoNoQuadro[]> {
  const res = await fetch(`${config.crm.url}/api/integracao/pedidos?telefone=${encodeURIComponent(telefone)}`, {
    headers: { "x-crm-secret": config.crm.segredo },
    signal: AbortSignal.timeout(PRAZO_MS),
  });
  if (!res.ok) throw new Error(`CRM respondeu ${res.status}`);
  const corpo = (await res.json()) as { pedidos?: PedidoNoQuadro[] };
  return corpo.pedidos ?? [];
}

let buscar: Buscar = buscarNoCrm;
/** Injetável para teste. */
export function setBuscarPedidosNoQuadro(fn: Buscar | null): void {
  buscar = fn ?? buscarNoCrm;
}

/**
 * Andamento dos pedidos do cliente no quadro de Pedidos do CRM (a sequência da operação que a
 * gestão atualiza). O telefone da conversa é a validação: a Lia só vê os pedidos deste número.
 */
export async function andamentoPedidoHandler(input: AndamentoPedidoInput, state: ConversationState, _client: BrindeMeClient) {
  if (!config.crm.url || config.crm.segredo.length < 16) {
    return { resultado: "indisponivel", mensagem: "O quadro de pedidos não está ligado. Use consultar_pedido se o cliente tiver o código." };
  }
  let pedidos: PedidoNoQuadro[];
  try {
    pedidos = await buscar(state.telefone);
  } catch {
    return { erro: "falha_ao_consultar_quadro", instrucao: "transferir", motivo_sugerido: "falha_sistema" };
  }
  if (pedidos.length === 0) return { resultado: "nenhum_pedido_no_quadro" };

  const codigo = input.codigo?.replace(/\s+/g, "").toUpperCase();
  const citado = codigo ? pedidos.find((p) => p.codigo.toUpperCase() === codigo || p.codigo.toUpperCase().endsWith(`-${codigo.replace(/^#?0*/, "").padStart(4, "0")}`)) : undefined;
  if (codigo && !citado) return { resultado: "codigo_nao_encontrado_neste_telefone", pedidos_do_cliente: pedidos };
  return { resultado: "encontrado", pedidos: citado ? [citado] : pedidos };
}
