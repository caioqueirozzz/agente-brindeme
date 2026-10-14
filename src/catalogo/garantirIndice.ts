import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { sincronizarCatalogo, type ProductIndexStore } from "./indice.js";

export type SituacaoIndice =
  | { situacao: "ok"; produtos: number; idadeHoras: number }
  | { situacao: "antigo"; produtos: number; idadeHoras: number }
  | { situacao: "sincronizado"; produtos: number }
  | { situacao: "vazio" };

/** Acima disto o CLI avisa que o job de sincronização parou de rodar. */
export const IDADE_MAXIMA_HORAS = 24;

/**
 * Confere o índice de catálogo na partida.
 *  - vazio + `autoSincronizar` (mock, 8 produtos): sincroniza na hora.
 *  - vazio sem `autoSincronizar` (API real, milhares de produtos): não sincroniza
 *    sozinho — leva minutos e é decisão de quem opera; devolve "vazio" para avisar.
 */
export async function garantirIndice(
  client: BrindeMeClient,
  store: ProductIndexStore,
  opcoes: { autoSincronizar: boolean; agora?: Date }
): Promise<SituacaoIndice> {
  const agora = opcoes.agora ?? new Date();
  const atual = store.carregar();

  if (atual.produtos.length === 0) {
    if (!opcoes.autoSincronizar) return { situacao: "vazio" };
    await sincronizarCatalogo(client, store, { agora });
    return { situacao: "sincronizado", produtos: store.carregar().produtos.length };
  }

  const idadeHoras = atual.sincronizado_em
    ? (agora.getTime() - new Date(atual.sincronizado_em).getTime()) / 3_600_000
    : Infinity;
  const base = { produtos: atual.produtos.length, idadeHoras };
  return idadeHoras > IDADE_MAXIMA_HORAS ? { situacao: "antigo", ...base } : { situacao: "ok", ...base };
}
