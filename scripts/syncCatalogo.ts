/**
 * Job de sincronização do catálogo (Fase 3).
 *
 *   npm run sync:catalogo                    # incremental
 *   npm run sync:catalogo -- --forcar        # relê o detalhe de todos os produtos ativos
 *   npm run sync:catalogo -- --concorrencia 3
 *   npm run sync:catalogo -- --ritmo 55      # req/min; só com o agente desligado (a API corta em 60/min)
 *
 * Lê GET /product página por página e GET /product/{id} dos produtos ativos que
 * mudaram, e grava data/produtos-index.json (no mock, data/produtos-index-mock.json). Somente leitura na API.
 *
 * Pensado para rodar de hora em hora (cron / agendador). Só relê o detalhe de
 * quem mudou (updated_at) ou passou da idade máxima; estoque e preço que o
 * cliente vê são reconferidos na conversa de qualquer forma.
 */
import "dotenv/config";
import { createBrindeMeClient } from "../src/integrations/brindeme/factory.js";
import { relative } from "path";
import { arquivoIndicePadrao, FileProductIndexStore, sincronizarCatalogo } from "../src/catalogo/indice.js";
import { config } from "../src/config.js";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function numero(nome: string, padrao: number): number {
  const i = process.argv.indexOf(`--${nome}`);
  if (i === -1) return padrao;
  const n = Number.parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

async function main() {
  const forcar = process.argv.includes("--forcar");
  const concorrencia = numero("concorrencia", config.catalogo.concorrencia);
  const maxPaginas = numero("max-paginas", 300);
  const ritmo = numero("ritmo", config.catalogo.reqPorMinuto);

  console.log(`${BOLD}Sincronização do catálogo — ${config.storeName}${RESET}`);
  console.log(
    `${GRAY}  modo: ${config.brindeMe.mode} · concorrência: ${concorrencia} · ritmo: ${ritmo} req/min${forcar ? " · forçado" : ""}${RESET}\n`
  );

  const client = createBrindeMeClient({ reqPorMinuto: ritmo });
  const store = new FileProductIndexStore();
  const inicio = Date.now();
  let ultimaLinha = "";

  const r = await sincronizarCatalogo(client, store, {
    concorrencia,
    maxPaginas,
    forcar,
    maxIdadeHoras: config.catalogo.maxIdadeHoras,
    onProgresso: (e) => {
      const linha =
        e.fase === "listagem"
          ? `  listando… ${e.feitos}${e.total ? ` de ${e.total}` : ""}`
          : `  lendo detalhes… ${e.feitos} de ${e.total}`;
      if (process.stdout.isTTY && linha !== ultimaLinha) {
        process.stdout.write(`\r${GRAY}${linha}${RESET}   `);
        ultimaLinha = linha;
      }
    },
  });
  if (process.stdout.isTTY) process.stdout.write("\r" + " ".repeat(60) + "\r");

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`${GREEN}✓${RESET} ${r.listados} produto(s) listado(s) em ${r.paginas} página(s), ${r.ativos} ativo(s)`);
  console.log(
    `${GRAY}  detalhe lido: ${r.lidosNoDetalhe} · reaproveitados: ${r.reaproveitados} · novos: ${r.novos} · removidos: ${r.removidos}${RESET}`
  );
  console.log(`${GRAY}  índice: ${relative(process.cwd(), arquivoIndicePadrao(config.brindeMe.mode))} · ${segundos}s${RESET}`);

  if (!r.listagemCompleta) {
    console.log(
      `${YELLOW}!${RESET} listagem cortada em ${maxPaginas} páginas: nada foi removido do índice. Aumente --max-paginas.`
    );
  }
  if (r.falhas.length > 0) {
    console.log(`${YELLOW}!${RESET} ${r.falhas.length} produto(s) sem detalhe (registro anterior mantido):`);
    for (const f of r.falhas.slice(0, 10)) console.log(`${GRAY}    ${f.id}: ${f.erro}${RESET}`);
    if (r.falhas.length > 10) console.log(`${GRAY}    … e mais ${r.falhas.length - 10}${RESET}`);
    console.log(`${YELLOW}!${RESET} índice marcado incompleto. Rode de novo: só os que faltaram são lidos.`);
  }
}

main().catch((err) => {
  console.error(`${RED}✗${RESET} sincronização abortada, índice anterior preservado: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
