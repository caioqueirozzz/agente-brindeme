import { readFileSync } from "fs";
import { join } from "path";
import {
  MemoryOrderIndexStore,
  type PedidoIndexado,
} from "../../src/integrations/brindeme/orderIndex.js";
import { normalizePhone } from "../../src/agent/state.js";
import type { Order } from "../../src/integrations/brindeme/types.js";

/** Índice equivalente ao que o job de sincronização produziria a partir dos mocks. */
export function indiceDosMocks(): MemoryOrderIndexStore {
  const orders: Order[] = JSON.parse(
    readFileSync(join(process.cwd(), "mocks/orders.json"), "utf-8")
  );
  const agora = new Date().toISOString();
  const registros: PedidoIndexado[] = orders.map((o) => ({
    id: o.id,
    codigo: String(o.code),
    telefone: normalizePhone(o.customer_phone ?? ""),
    email: (o.customer_email ?? "").toLowerCase(),
    status: o.status_name ?? "",
    criado_em: o.created_at ?? "",
    sincronizado_em: agora,
  }));
  return new MemoryOrderIndexStore(registros);
}
