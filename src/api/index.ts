import "dotenv/config";
import { config, conferirPrazos } from "../config.js";
import { criarServidorAgente } from "../contrato/servidorHttp.js";
import { RepositorioConversas } from "../conversas/repositorio.js";
import { FileProductIndexStore, sincronizarCatalogo } from "../catalogo/indice.js";
import { createBrindeMeClient } from "../integrations/brindeme/factory.js";
import { criarLLM } from "../llm/index.js";
import { avisarConhecimentoECatalogo } from "../partida.js";
import { AgenteDefinitivo } from "./agenteDefinitivo.js";

const SEIS_HORAS_MS = 6 * 3_600_000;
const CONCORRENCIA_MAX_DO_SYNC = 2;

async function main(): Promise<void> {
  const prazos = conferirPrazos(config.agente.tetoMs, config.whatsapp.agenteTimeoutMs);
  if (prazos) {
    console.error(prazos);
    process.exit(1);
  }
  let llm;
  try {
    llm = criarLLM();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const client = createBrindeMeClient();
  console.log(`API da loja: ${config.brindeMe.mode} · escrita de orçamento: ${config.brindeMe.escritaOrcamento}`);
  await avisarConhecimentoECatalogo(client);

  const store = new FileProductIndexStore();
  if (store.carregar().produtos.length === 0) {
    console.error("Índice do catálogo vazio: o agente não sobe sem ele. Rode antes: npm run sync:catalogo (a 1ª carga leva minutos).");
    process.exit(1);
  }

  // Cliente próprio: falhas do sync abrem o disjuntor dele, não o das conversas.
  const clienteDoSync = createBrindeMeClient({ reqPorMinuto: config.catalogo.reqPorMinuto });
  const sincronizar = () =>
    sincronizarCatalogo(clienteDoSync, store, {
      concorrencia: Math.min(config.catalogo.concorrencia, CONCORRENCIA_MAX_DO_SYNC),
      maxIdadeHoras: config.catalogo.maxIdadeHoras,
    })
      .then((r) =>
        console.log(`Catálogo sincronizado: ${r.ativos} ativos, ${r.novos} novos, ${r.removidos} removidos${r.completo ? "" : " (incompleto)"}`)
      )
      .catch((err) =>
        console.error(`Sync do catálogo falhou; o índice anterior continua valendo: ${err instanceof Error ? err.message : err}`)
      );
  // Só com a API real: em mock, o sync gravaria os produtos de teste dentro do índice real.
  if (config.brindeMe.mode === "http") {
    void sincronizar();
    setInterval(() => void sincronizar(), SEIS_HORAS_MS);
  }

  const log = (e: Record<string, unknown>) => console.error(JSON.stringify(e));
  const agente = new AgenteDefinitivo({
    repo: new RepositorioConversas(config.agente.conversasDir, log),
    llm,
    client,
    tetoMs: config.agente.tetoMs,
    respostasPorHora: config.agente.respostasPorHora,
  });
  criarServidorAgente(agente, log).listen(config.agente.porta, "127.0.0.1", () => {
    console.log(`Agente em http://127.0.0.1:${config.agente.porta}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
