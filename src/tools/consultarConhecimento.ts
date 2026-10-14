import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import type { ConversationState } from "../agent/state.js";
import { config } from "../config.js";
import {
  BaseConhecimento,
  carregarBase,
  IDS_CATEGORIA,
} from "../knowledge/base.js";
import { FileLacunaStore, criarLacuna, type LacunaStore } from "../knowledge/lacunas.js";

export const consultarConhecimentoSchema = z.object({
  pergunta: z
    .string()
    .min(3)
    .max(300)
    .describe("A dúvida do cliente, com as palavras dele (ex: 'vocês entregam em todo o Brasil?')"),
  categoria: z
    .enum(IDS_CATEGORIA)
    .optional()
    .describe("Categoria provável, se for óbvia. Restringe a busca; omita na dúvida."),
});

export type ConsultarConhecimentoInput = z.infer<typeof consultarConhecimentoSchema>;

/** Injetáveis para teste; em produção lêem a pasta base/ e gravam em data/lacunas.jsonl. */
let basePadrao: BaseConhecimento | null = null;
let lacunasPadrao: LacunaStore | null = null;

export function setBaseConhecimento(base: BaseConhecimento | null): void {
  basePadrao = base;
}
export function setLacunaStore(store: LacunaStore | null): void {
  lacunasPadrao = store;
}

function getBase(): BaseConhecimento {
  if (!basePadrao) {
    const { base, problemas } = carregarBase({ incluirRascunhos: config.conhecimento.incluirRascunhos });
    // Item inválido fica de fora da busca (falha fechada). Quem edita precisa saber.
    for (const p of problemas) {
      console.warn(`[base de conhecimento] ${p.arquivo}${p.item ? ` · ${p.item}` : ""}: ${p.mensagem}`);
    }
    basePadrao = base;
  }
  return basePadrao;
}

function getLacunas(): LacunaStore {
  if (!lacunasPadrao) lacunasPadrao = new FileLacunaStore();
  return lacunasPadrao;
}

export const REGRA_DE_USO =
  "Responda usando só o conteúdo dos itens, em frases curtas e com suas palavras. Não acrescente prazo, valor, regra ou condição que não esteja neles. Se a pergunta tiver uma parte que os itens não cobrem, responda a parte coberta e transfira o resto.";

export async function consultarConhecimentoHandler(
  input: ConsultarConhecimentoInput,
  state: ConversationState,
  _client: BrindeMeClient
) {
  const acertos = getBase().buscar(input.pergunta, { categoria: input.categoria });

  if (acertos.length === 0) {
    // A pergunta sem resposta vira trabalho para a loja e o cliente vai para uma pessoa.
    getLacunas().registrar(criarLacuna(input.pergunta, state.conversaId, input.categoria));
    return {
      resultado: "sem_resposta_na_base" as const,
      mensagem:
        "A base de conhecimento aprovada não cobre essa pergunta. Não responda de memória nem estime.",
      instrucao: "transferir" as const,
      motivo_sugerido: "lacuna_conhecimento" as const,
    };
  }

  return {
    resultado: "encontrado" as const,
    itens: acertos.map((a) => ({
      id: a.item.id,
      categoria: a.item.categoria,
      titulo: a.item.titulo,
      conteudo: a.item.conteudo,
    })),
    regra: REGRA_DE_USO,
  };
}
