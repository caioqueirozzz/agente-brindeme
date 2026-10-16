import "dotenv/config";
import { config } from "../config.js";
import type { Agente } from "../contrato/agente.js";
import { criarServidorAgente } from "../contrato/servidorHttp.js";
import { createBrindeMeClient } from "../integrations/brindeme/factory.js";
import { criarLLM } from "../llm/index.js";
import { avisarConhecimentoECatalogo } from "../partida.js";
import { AgenteDireto } from "./direto.js";
import { AgenteEco } from "./eco.js";

function lerModo(): string {
  const i = process.argv.indexOf("--modo");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : "direto";
}

async function main(): Promise<void> {
  const modo = lerModo();
  let agente: Agente;
  if (modo === "eco") {
    agente = new AgenteEco();
  } else if (modo === "direto") {
    const client = createBrindeMeClient();
    console.log(`API da loja: ${config.brindeMe.mode} · escrita de orçamento: ${config.brindeMe.escritaOrcamento}`);
    await avisarConhecimentoECatalogo(client);
    agente = new AgenteDireto(criarLLM(), client);
  } else {
    console.error(`--modo inválido: ${modo} (use eco ou direto)`);
    process.exit(1);
  }
  const servidor = criarServidorAgente(agente, (e) => console.error(JSON.stringify(e)));
  servidor.listen(config.agente.porta, "127.0.0.1", () => {
    console.log(`Dublê do agente (${modo}) em http://127.0.0.1:${config.agente.porta}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
