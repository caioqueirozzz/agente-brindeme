import "dotenv/config";
import { config } from "../config.js";
import { criarClienteHttp } from "./agenteHttp.js";
import { ArquivoEstadoPonte } from "./estadoPonte.js";
import { criarLogPonte } from "./log.js";
import { Ponte } from "./ponte.js";
import { CanalWwebjs } from "./sessao.js";

async function main(): Promise<void> {
  const w = config.whatsapp;
  const log = criarLogPonte();
  const canal = new CanalWwebjs({
    sessaoDir: w.sessaoDir,
    log,
    ...(w.parearTelefone ? { parearTelefone: w.parearTelefone } : {}),
    ...(w.versaoWeb ? { versaoWeb: w.versaoWeb } : {}),
  });
  const ponte = new Ponte(
    canal,
    criarClienteHttp(config.agente.url, w.agenteTimeoutMs),
    {
      artesDir: w.artesDir,
      liberados: w.liberados,
      lote: { silencioMs: w.loteSilencioMs, maxMs: w.loteMaxMs, maxMensagens: w.loteMaxMensagens },
      avisoInstabilidadeMs: w.avisoInstabilidadeMin * 60_000,
      enviosPorMinuto: w.enviosPorMinuto,
      armazem: new ArquivoEstadoPonte(w.estadoArquivo, log),
    },
    log
  );
  ponte.iniciar(w.varreduraMs);
  if (w.liberados.length > 0) console.log(`Respondendo só a: ${w.liberados.join(", ")}`);
  const sair = () => {
    ponte.salvarAgora();
    void canal.encerrar().finally(() => process.exit(0));
  };
  process.once("SIGINT", sair);
  process.once("SIGTERM", sair);
  await canal.iniciar();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
