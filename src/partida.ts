import type { BrindeMeClient } from "./integrations/brindeme/client.js";
import { FileProductIndexStore } from "./catalogo/indice.js";
import { garantirIndice } from "./catalogo/garantirIndice.js";
import { carregarBase } from "./knowledge/base.js";
import { config } from "./config.js";

const GRAY = "\x1b[90m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/** Estado da base de conhecimento e do índice de catálogo, antes de atender. */
export async function avisarConhecimentoECatalogo(client: BrindeMeClient): Promise<void> {
  const { base, problemas } = carregarBase({ incluirRascunhos: config.conhecimento.incluirRascunhos });
  const e = base.estatisticas();
  console.log(
    `${GRAY}Base de conhecimento: ${e.servidos} item(ns) servido(s) de ${e.total} · ${e.aprovados} aprovado(s), ${e.rascunhos} em rascunho${RESET}`
  );
  if (config.conhecimento.incluirRascunhos) {
    console.log(`${YELLOW}! KB_INCLUIR_RASCUNHOS=true — respostas usam texto NÃO aprovado. Só para desenvolvimento.${RESET}`);
  } else if (e.aprovados === 0) {
    console.log(`${YELLOW}! nenhum item aprovado: dúvidas gerais viram lacuna e transferem. Veja: npm run kb:validar${RESET}`);
  }
  for (const p of problemas) console.log(`${YELLOW}! ${p.arquivo}${p.item ? ` · ${p.item}` : ""}: ${p.mensagem}${RESET}`);

  try {
    const s = await garantirIndice(client, new FileProductIndexStore(), {
      autoSincronizar: config.brindeMe.mode === "mock",
    });
    if (s.situacao === "vazio") {
      console.log(`${YELLOW}! índice de catálogo vazio — buscar_produtos vai falhar. Rode: npm run sync:catalogo${RESET}`);
    } else if (s.situacao === "antigo") {
      console.log(`${YELLOW}! índice de catálogo com ${Math.round(s.idadeHoras)}h (${s.produtos} produtos) — o job de sincronização está rodando?${RESET}`);
    } else if (s.situacao === "sincronizado") {
      console.log(`${GRAY}Índice de catálogo montado a partir dos mocks: ${s.produtos} produto(s)${RESET}`);
    } else {
      console.log(`${GRAY}Índice de catálogo: ${s.produtos} produto(s), sincronizado há ${s.idadeHoras < 1 ? "menos de 1" : Math.round(s.idadeHoras)}h${RESET}`);
    }
  } catch (err) {
    console.log(`${YELLOW}! não foi possível preparar o índice de catálogo: ${err instanceof Error ? err.message : err}${RESET}`);
  }
  console.log();
}
