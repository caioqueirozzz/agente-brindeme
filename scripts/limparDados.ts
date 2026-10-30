/**
 * Retenção de dados de cliente (issue #4, LGPD).
 *
 *   npm run limpar:dados                       # SIMULA: lista o que passou do prazo, não apaga nada
 *   npm run limpar:dados -- --dias 120         # outro prazo (padrão: RETENCAO_DIAS ou 90)
 *   npm run limpar:dados -- --executar         # APAGA de vez o que foi listado
 *   npm run limpar:dados -- --telefone 5583999990000 [--executar]   # tudo de um cliente que pediu exclusão
 *
 * Rode com o agente e a ponte parados: uma conversa apagada com o agente no ar volta da memória
 * na próxima gravação. O prazo é decisão da loja (issue #4); registre-o em docs/fase-6/manual-operacao.md.
 */
import "dotenv/config";
import { join } from "path";
import { config } from "../src/config.js";
import { apagar, selecionarCliente, selecionarParaLimpeza, type PastasRetencao } from "../src/operacao/retencao.js";

const args = process.argv.slice(2);
const executar = args.includes("--executar");
const valor = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const dias = Number(valor("--dias") ?? process.env.RETENCAO_DIAS ?? 90);
const telefone = valor("--telefone")?.replace(/\D/g, "");

const pastas: PastasRetencao = {
  conversas: config.agente.conversasDir,
  artes: config.whatsapp.artesDir,
  logs: join(process.cwd(), "logs"),
  orcamentosTeste: config.brindeMe.orcamentosTesteArquivo,
  ponteEstado: config.whatsapp.estadoArquivo,
  lacunas: join(process.cwd(), "data/lacunas.jsonl"),
};
const alvos = telefone ? selecionarCliente(pastas, telefone) : selecionarParaLimpeza(pastas, dias);

const kb = (b: number) => (b === 0 ? "0 KB" : `${Math.max(1, Math.round(b / 1024))} KB`);
const escopo = telefone ? `cliente ${telefone}` : `${dias} dia(s) sem atividade`;
console.log(`\nRetenção: ${escopo} · ${executar ? "EXECUTANDO (apaga de vez)" : "simulação (nada é apagado)"}\n`);
for (const tipo of ["conversa", "artes", "log"] as const) {
  const doTipo = alvos.filter((a) => a.tipo === tipo);
  const total = doTipo.reduce((s, a) => s + a.bytes, 0);
  console.log(`${tipo.padEnd(9)} ${String(doTipo.length).padStart(5)} item(ns) · ${kb(total)}`);
  for (const a of doTipo.slice(0, 20)) console.log(`   ${a.idadeDias}d  ${a.caminho}`);
  if (doTipo.length > 20) console.log(`   … e mais ${doTipo.length - 20}`);
}
for (const a of alvos.filter((x) => x.tipo === "registros")) {
  console.log(`registros ${String(a.registros).padStart(5)} em ${a.caminho}`);
}

const comando = telefone ? `--telefone ${telefone}` : `--dias ${dias}`;
if (alvos.length === 0) console.log(telefone ? "\nNada guardado desse telefone." : "\nNada passou do prazo.");
else if (!executar) console.log(`\nSimulação. Para apagar: npm run limpar:dados -- ${comando} --executar`);
else console.log(`\n${apagar(alvos)} item(ns) apagado(s).`);
