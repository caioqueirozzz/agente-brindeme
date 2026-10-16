import "dotenv/config";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { config } from "../src/config.js";
import { manterVivo, matarArvore } from "../src/lancador.js";

const AGENTES: Record<string, string[]> = {
  api: ["src/api/index.ts"],
  direto: ["src/duble/index.ts", "--modo", "direto"],
  eco: ["src/duble/index.ts", "--modo", "eco"],
};
const AGENTE_PADRAO = "api";
const RELIGAR_AGENTE_MS = 5_000;
const RELIGAR_AGENTE_MAX_MS = 60_000;
const AGENTE_ESTAVEL_MS = 5 * 60_000;
const ESPERA_ENCERRAR_MS = 5_000;

function argumento(nome: string, padrao: string): string {
  const i = process.argv.indexOf(nome);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function subir(args: string[]): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", ...args], { stdio: "inherit" });
}

async function esperarAgente(tentativas = 120): Promise<boolean> {
  for (let i = 0; i < tentativas; i++) {
    try {
      if ((await fetch(`${config.agente.url}/api/health`)).ok) return true;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

async function main(): Promise<void> {
  const qual = argumento("--agente", AGENTE_PADRAO);
  const args = AGENTES[qual];
  if (!args) {
    console.error(`--agente inválido: ${qual} (use ${Object.keys(AGENTES).join(", ")})`);
    process.exit(1);
  }
  if (!existsSync(args[0])) {
    console.error(`${args[0]} ainda não existe nesta branch.`);
    process.exit(1);
  }

  // O agente cair não derruba a ponte: ela segura as mensagens, avisa o cliente e varre quando ele volta.
  // Se ele cai antes de responder a primeira vez, é configuração (índice vazio, prazos, chave): religar não resolve.
  let respondeu = false;
  const agente = manterVivo(() => subir(args), {
    esperaMs: RELIGAR_AGENTE_MS,
    esperaMaxMs: RELIGAR_AGENTE_MAX_MS,
    estavelMs: AGENTE_ESTAVEL_MS,
    deveReligar: () => respondeu,
    aoDesistir: (codigo) => {
      console.error(`O agente saiu antes de subir (código ${codigo}). Veja o erro acima; a ponte não foi iniciada.`);
      process.exit(1);
    },
    aoReiniciar: (codigo, ms) =>
      console.error(`O agente saiu (código ${codigo}); religando em ${(ms ?? RELIGAR_AGENTE_MS) / 1000}s. A ponte continua no ar.`),
  });
  respondeu = await esperarAgente();
  if (!respondeu) {
    console.error("O agente não respondeu em /api/health em 2 min.");
    agente.parar();
    matarArvore(agente.atual());
    process.exit(1);
  }

  const ponte = subir(["src/whatsapp/index.ts"]);
  let encerrando = false;
  const encerrar = (codigo: number) => {
    if (encerrando) return;
    encerrando = true;
    agente.parar();
    matarArvore(agente.atual());
    matarArvore(ponte);
    process.exit(codigo);
  };
  ponte.on("exit", (codigo) => encerrar(codigo ?? 0));
  // Ctrl+C chega também aos filhos: a ponte fecha o Chrome sozinha. O prazo é a rede de segurança.
  process.on("SIGINT", () => setTimeout(() => encerrar(0), ESPERA_ENCERRAR_MS));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
