/**
 * Conferência da configuração antes de ligar o agente (Fase 5, C5 — entregue na Fase 6).
 * Função pura sobre as variáveis de ambiente e fatos já levantados pelo script, para poder testar
 * sem tocar o disco. `npm run verificar:env` imprime o resultado e sai com 1 se houver ERRO.
 */
import { conferirPrazos } from "../config.js";
import { ehFerramenta } from "../tools/nomes.js";

export type Gravidade = "ok" | "aviso" | "erro";

export interface Achado {
  gravidade: Gravidade;
  item: string;
  mensagem: string;
}

export interface FatosAmbiente {
  /** Existe arquivo .env na raiz. */
  temArquivoEnv: boolean;
  /** Produtos no índice do catálogo (data/catalogo*.json). */
  produtosNoIndice: number;
  /** Itens aprovados na base de conhecimento. */
  itensAprovados: number;
  /** data/estado-sistema.json diz que o agente está suspenso. */
  suspenso: boolean;
  ferramentasDesligadasRuntime: string[];
}

/** Valor que ainda é o exemplo do .env.example, e não um segredo de verdade. */
function ehExemplo(v: string | undefined): boolean {
  const t = (v ?? "").trim();
  return t === "" || t === "sk-..." || t === "https://..." || t.includes("...");
}

function inteiro(v: string | undefined, padrao: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

/**
 * `producao` endurece as regras: mock, rascunho da base e índice vazio deixam de ser aviso e viram erro.
 * O piloto roda em modo produção.
 */
export function verificarAmbiente(
  env: Record<string, string | undefined>,
  fatos: FatosAmbiente,
  opcoes: { producao: boolean }
): Achado[] {
  const achados: Achado[] = [];
  const ok = (item: string, mensagem: string) => achados.push({ gravidade: "ok", item, mensagem });
  const aviso = (item: string, mensagem: string) => achados.push({ gravidade: "aviso", item, mensagem });
  const erro = (item: string, mensagem: string) => achados.push({ gravidade: "erro", item, mensagem });
  const naProducao = (item: string, mensagem: string) => (opcoes.producao ? erro : aviso)(item, mensagem);

  if (!fatos.temArquivoEnv) aviso(".env", "arquivo .env não encontrado: valendo só as variáveis do sistema e os padrões");

  // Modelo
  if (ehExemplo(env.OPENAI_API_KEY)) erro("OPENAI_API_KEY", "ausente ou ainda o exemplo do .env.example: o agente não sobe");
  else ok("OPENAI_API_KEY", "preenchida");
  if (!env.LLM_MODEL?.trim()) erro("LLM_MODEL", "vazio: o agente não sobe sem o id do modelo");
  else ok("LLM_MODEL", env.LLM_MODEL);
  const raciocinio = (env.LLM_REASONING ?? "").trim();
  if ((env.LLM_API ?? "chat") === "chat" && raciocinio && raciocinio !== "none") {
    aviso("LLM_REASONING", `"${raciocinio}" com LLM_API=chat quebrou as ferramentas na verificação de 15/10 (issue #7); use none`);
  }
  if ((env.LLM_API ?? "chat") === "responses") aviso("LLM_API", "responses não foi validada nos evals; o piloto foi homologado com chat");

  // API da loja
  const modo = env.BRINDEME_MODE ?? "mock";
  if (modo === "mock") naProducao("BRINDEME_MODE", "mock: preços, estoque e pedidos são de mentira");
  else if (modo !== "http") erro("BRINDEME_MODE", `valor desconhecido "${modo}" (use mock ou http)`);
  else {
    if (ehExemplo(env.BRINDEME_BASE_URL)) erro("BRINDEME_BASE_URL", "vazia ou exemplo com BRINDEME_MODE=http");
    else if (!/^https:\/\//.test(env.BRINDEME_BASE_URL!)) erro("BRINDEME_BASE_URL", "precisa ser https: o token viaja em todo pedido");
    else ok("BRINDEME_BASE_URL", env.BRINDEME_BASE_URL!);
    if (!env.BRINDEME_TOKEN?.trim()) erro("BRINDEME_TOKEN", "vazio com BRINDEME_MODE=http");
    else ok("BRINDEME_TOKEN", "preenchido");
  }
  const escrita = env.ORCAMENTO_ESCRITA === "real" ? "real" : "simulada";
  if (escrita === "real" && modo !== "http") erro("ORCAMENTO_ESCRITA", "real só vale com BRINDEME_MODE=http");
  else if (escrita === "simulada" && opcoes.producao) {
    aviso("ORCAMENTO_ESCRITA", "simulada: os orçamentos do piloto NÃO chegam à loja (só data/orcamentos-teste.json)");
  } else ok("ORCAMENTO_ESCRITA", escrita);

  // Conhecimento e catálogo
  if ((env.KB_INCLUIR_RASCUNHOS ?? "false") === "true") naProducao("KB_INCLUIR_RASCUNHOS", "true: o cliente recebe texto NÃO aprovado pela loja");
  if (fatos.itensAprovados === 0) {
    aviso("base de conhecimento", "nenhum item aprovado: toda dúvida de processo, prazo, entrega ou pagamento vai para um atendente (issue #13)");
  } else ok("base de conhecimento", `${fatos.itensAprovados} item(ns) aprovado(s)`);
  if (fatos.produtosNoIndice === 0) naProducao("catálogo", "índice vazio: rode npm run sync:catalogo antes de ligar");
  else ok("catálogo", `${fatos.produtosNoIndice} produto(s) no índice`);

  // WhatsApp e limites
  const prazos = conferirPrazos(inteiro(env.TURNO_TETO_MS, 90_000), inteiro(env.AGENTE_TIMEOUT_MS, 120_000));
  if (prazos) erro("TURNO_TETO_MS", prazos);
  const liberados = (env.WHATSAPP_LIBERADOS ?? "").split(",").filter((s) => s.replace(/\D/g, "")).length;
  if (liberados === 0) aviso("WHATSAPP_LIBERADOS", "vazio: o agente responde QUALQUER número que escrever no chip");
  else ok("WHATSAPP_LIBERADOS", `${liberados} número(s) liberado(s)`);
  if (inteiro(env.RESPOSTAS_POR_HORA, 30) > 60) aviso("RESPOSTAS_POR_HORA", "acima de 60 por telefone: pouca proteção contra abuso e custo");

  // Controle em runtime
  const desligadasEnv = (env.FERRAMENTAS_DESLIGADAS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const invalidas = [...desligadasEnv, ...fatos.ferramentasDesligadasRuntime].filter((f) => !ehFerramenta(f));
  if (invalidas.length) erro("FERRAMENTAS_DESLIGADAS", `nome(s) que não são ferramenta: ${invalidas.join(", ")} — nada está bloqueado`);
  const desligadas = [...new Set([...desligadasEnv, ...fatos.ferramentasDesligadasRuntime])].filter(ehFerramenta);
  if (desligadas.length) aviso("ferramentas desligadas", desligadas.join(", "));
  if (fatos.suspenso) aviso("estado-sistema", "agente SUSPENSO (#suspender): ninguém é atendido pela IA até #retomar");

  return achados;
}

export function temErro(achados: Achado[]): boolean {
  return achados.some((a) => a.gravidade === "erro");
}
