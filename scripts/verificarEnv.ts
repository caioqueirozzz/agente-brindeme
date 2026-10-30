/**
 * Confere a configuração antes de ligar o agente.
 *
 *   npm run verificar:env                # desenvolvimento: mock e rascunho só avisam
 *   npm run verificar:env -- --producao  # piloto/produção: mock, rascunho e índice vazio são ERRO
 *
 * Sai com código 1 se houver ERRO. Nunca imprime o valor de segredo (chave, token).
 */
import "dotenv/config";
import { existsSync } from "fs";
import { join } from "path";
import { arquivoIndicePadrao, FileProductIndexStore } from "../src/catalogo/indice.js";
import { lerEstadoSistema } from "../src/controle/estadoSistema.js";
import { carregarBase } from "../src/knowledge/base.js";
import { temErro, verificarAmbiente, type Gravidade } from "../src/operacao/verificacaoAmbiente.js";

const COR: Record<Gravidade, string> = { ok: "\x1b[32m", aviso: "\x1b[33m", erro: "\x1b[31m" };
const ROTULO: Record<Gravidade, string> = { ok: "OK   ", aviso: "AVISO", erro: "ERRO " };
const RESET = "\x1b[0m";

const producao = process.argv.includes("--producao");
const modo = process.env.BRINDEME_MODE === "http" ? "http" : "mock";

let produtos = 0;
try {
  produtos = new FileProductIndexStore(arquivoIndicePadrao(modo)).carregar().produtos.length;
} catch {
  produtos = 0;
}
const { base } = carregarBase({ incluirRascunhos: false });
const sistema = lerEstadoSistema();

const achados = verificarAmbiente(
  process.env,
  {
    temArquivoEnv: existsSync(join(process.cwd(), ".env")),
    produtosNoIndice: produtos,
    itensAprovados: base.estatisticas().servidos,
    suspenso: sistema.suspenso,
    ferramentasDesligadasRuntime: sistema.ferramentasDesligadas ?? [],
  },
  { producao }
);

console.log(`\nVerificação do ambiente — modo ${producao ? "PRODUÇÃO (piloto)" : "desenvolvimento"}\n`);
for (const a of achados) console.log(`${COR[a.gravidade]}${ROTULO[a.gravidade]}${RESET}  ${a.item}: ${a.mensagem}`);
const erros = achados.filter((a) => a.gravidade === "erro").length;
const avisos = achados.filter((a) => a.gravidade === "aviso").length;
console.log(`\n${erros} erro(s), ${avisos} aviso(s).`);
if (temErro(achados)) {
  console.log("Corrija os ERROS antes de ligar o agente.");
  process.exit(1);
}
