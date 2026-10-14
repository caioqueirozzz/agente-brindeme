/**
 * Valida a base de conhecimento (Fase 3).
 *
 *   npm run kb:validar                       # relatório; falha só se houver erro de formato
 *   npm run kb:validar -- --exigir-aprovacao # falha também se houver item não aprovado (gate de release)
 *
 * Mostra, por categoria, quantos itens estão aprovados, em rascunho, com valor
 * pendente ([PLACEHOLDER]) ou com revisão vencida — e quem precisa agir.
 */
import { lerItens, CATEGORIAS, IDS_CATEGORIA, type ItemBase } from "../src/knowledge/base.js";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const exigirAprovacao = process.argv.includes("--exigir-aprovacao");
const { itens, problemas } = lerItens();

console.log(`${BOLD}Base de conhecimento${RESET}\n`);

const colunas = ["Categoria", "Aprova", "Itens", "Aprov.", "Rasc.", "Pendente", "Vencido"];
const linhas: string[][] = IDS_CATEGORIA.map((cat) => {
  const doCat = itens.filter((i) => i.categoria === cat);
  return [
    CATEGORIAS[cat].rotulo,
    CATEGORIAS[cat].aprovador,
    String(doCat.length),
    String(doCat.filter((i) => i.status === "aprovado").length),
    String(doCat.filter((i) => i.status === "rascunho").length),
    String(doCat.filter((i) => i.temPlaceholder).length),
    String(doCat.filter((i) => i.vencido).length),
  ];
});
const larguras = colunas.map((c, k) => Math.max(c.length, ...linhas.map((l) => l[k].length)));
const fmt = (l: string[]) => l.map((c, k) => c.padEnd(larguras[k])).join("  ");
console.log(`${GRAY}${fmt(colunas)}${RESET}`);
for (const l of linhas) console.log(fmt(l));

const aprovados = itens.filter((i) => i.status === "aprovado");
const naoAprovados = itens.filter((i) => i.status !== "aprovado");
console.log(
  `\n${itens.length} item(ns): ${GREEN}${aprovados.length} aprovado(s)${RESET}, ${YELLOW}${naoAprovados.length} em rascunho${RESET}`
);

function listar(titulo: string, lista: ItemBase[], detalhe: (i: ItemBase) => string) {
  if (lista.length === 0) return;
  console.log(`\n${BOLD}${titulo}${RESET}`);
  for (const i of lista) console.log(`  ${i.id} ${GRAY}(${i.dono})${RESET}\n    ${GRAY}${detalhe(i)}${RESET}`);
}

listar(
  "Aguardando valor da loja (nunca é servido ao cliente enquanto houver [PLACEHOLDER])",
  itens.filter((i) => i.temPlaceholder),
  (i) => `${i.nota_interna ?? ""}`.trim() || "preencher os valores entre colchetes"
);
listar(
  "Prontos para revisão e aprovação (sem valor pendente)",
  naoAprovados.filter((i) => !i.temPlaceholder),
  (i) => `${i.nota_interna ?? "revisar o texto"} → ao aprovar: status, aprovado_por, aprovado_em`
);
listar("Revisão vencida", itens.filter((i) => i.vencido), (i) => `revisar_em ${i.revisar_em}`);

if (problemas.length > 0) {
  console.log(`\n${RED}${BOLD}Erros de formato (estes itens estão FORA da base):${RESET}`);
  for (const p of problemas) console.log(`  ${RED}✗${RESET} ${p.arquivo}${p.item ? ` · ${p.item}` : ""}: ${p.mensagem}`);
}

const semAprovado = IDS_CATEGORIA.filter((c) => !aprovados.some((i) => i.categoria === c));
if (semAprovado.length > 0) {
  console.log(
    `\n${YELLOW}!${RESET} sem nenhum item aprovado: ${semAprovado.map((c) => CATEGORIAS[c].rotulo).join(", ")} — perguntas dessas categorias viram lacuna e transferem.`
  );
}

if (problemas.length > 0) process.exit(1);
if (exigirAprovacao && naoAprovados.length > 0) {
  console.log(`\n${RED}✗${RESET} --exigir-aprovacao: ${naoAprovados.length} item(ns) ainda não aprovado(s).`);
  process.exit(1);
}
