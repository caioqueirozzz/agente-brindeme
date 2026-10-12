import { readFileSync } from "fs";
import { join } from "path";
import type { ConversationState } from "../../src/agent/state.js";
import type { Product } from "../../src/integrations/brindeme/types.js";

/**
 * Preenche subproduto → produto como detalhar_produto/buscar_produtos fariam.
 * Na conversa real o agente sempre detalha o produto antes de orçar.
 */
export function semearMapaSubprodutos(state: ConversationState): void {
  const produtos: Product[] = JSON.parse(
    readFileSync(join(process.cwd(), "mocks/products.json"), "utf-8")
  );
  for (const p of produtos) {
    for (const s of p.subproducts) state.subprodutoParaProduto[s.id] = p.id;
  }
}
