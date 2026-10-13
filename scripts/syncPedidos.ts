/**
 * Job de sincronização de pedidos (Fase 2, item 4).
 *
 *   npm run sync:pedidos -- --dias 180
 *
 * Lê GET /order por período e grava o índice local usado por consultar_pedido.
 * Somente leitura na API; grava apenas id, código, telefone, e-mail, status e
 * data — nada de CPF, endereço, boleto ou nota.
 */
import "dotenv/config";
import { createBrindeMeClient } from "../src/integrations/brindeme/factory.js";
import { sincronizarPedidos, FileOrderIndexStore } from "../src/integrations/brindeme/orderIndex.js";
import { config } from "../src/config.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function arg(nome: string, padrao: number): number {
  const i = process.argv.indexOf(`--${nome}`);
  if (i === -1) return padrao;
  const n = Number.parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

async function main() {
  const dias = arg("dias", 180);
  console.log(`${BOLD}Sincronização de pedidos — ${config.storeName}${RESET}`);
  console.log(`${GRAY}  modo: ${config.brindeMe.mode} · janela: ${dias} dias${RESET}\n`);

  const client = createBrindeMeClient();
  const store = new FileOrderIndexStore();

  const r = await sincronizarPedidos(client, store, { dias });

  console.log(`${GREEN}✓${RESET} ${r.lidos} pedido(s) lido(s) em ${r.paginas} página(s)`);
  console.log(`${GRAY}  ${r.novos} novo(s) · ${r.atualizados} atualizado(s)${RESET}`);
  console.log(`${GRAY}  índice: data/pedidos-index.json${RESET}`);
}

main().catch((err) => {
  console.error(`${RED}✗${RESET} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
