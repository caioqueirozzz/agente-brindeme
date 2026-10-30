/**
 * Lista as lacunas da base de conhecimento (Fase 3): perguntas de clientes que
 * a base não soube responder, da mais frequente para a menos.
 *
 *   npm run kb:lacunas
 *   npm run kb:lacunas -- --limite 50
 *
 * É a fila de trabalho da loja: o que aparece mais aqui é o próximo item a
 * escrever em src/knowledge/base/ e aprovar.
 */
import { FileLacunaStore, agruparLacunas } from "../src/knowledge/lacunas.js";

const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const i = process.argv.indexOf("--limite");
const limite = i === -1 ? 30 : Math.max(1, Number.parseInt(process.argv[i + 1] ?? "30", 10) || 30);

const lacunas = new FileLacunaStore().listar();
if (lacunas.length === 0) {
  console.log("Nenhuma lacuna registrada ainda (data/lacunas.jsonl).");
  process.exit(0);
}

const grupos = agruparLacunas(lacunas);
console.log(`${BOLD}Lacunas da base de conhecimento${RESET} ${GRAY}(${lacunas.length} pergunta(s), ${grupos.length} assunto(s))${RESET}\n`);
for (const g of grupos.slice(0, limite)) {
  console.log(`${String(g.ocorrencias).padStart(3)}×  ${g.pergunta_exemplo}`);
  console.log(
    `      ${GRAY}${g.conversas} conversa(s) · última em ${g.ultima_em.slice(0, 10)}${g.categoria_sugerida ? ` · categoria provável: ${g.categoria_sugerida}` : ""}${RESET}`
  );
}
if (grupos.length > limite) console.log(`\n${GRAY}… e mais ${grupos.length - limite} assunto(s). Use --limite.${RESET}`);
