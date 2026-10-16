import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { extname } from "path";
import type { ConversationState } from "../agent/state.js";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";

const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".pdf", ".svg"];

export const registrarArteSchema = z.object({
  descricao_arquivo: z.string().describe("Nome ou descrição do arquivo de arte (ex: logo-empresa.png)"),
  posicao: z.string().optional().describe("Posição da arte no produto (ex: frente, costas, lateral)"),
  cores: z.string().optional().describe("Cores da arte ou observações sobre cor (ex: azul pantone 285C)"),
});

export type RegistrarArteInput = z.infer<typeof registrarArteSchema>;

export async function registrarArteHandler(
  input: RegistrarArteInput,
  state: ConversationState,
  _client: BrindeMeClient
) {
  const nomeProcurado = input.descricao_arquivo.trim().toLowerCase();
  const recebido = state.arquivosRecebidos?.find((a) => a.nome.toLowerCase() === nomeProcurado);
  if (recebido) {
    // Turno repetido depois de falha chama a ferramenta de novo: mesma arte, mesma referência.
    const existente = state.artes.find((a) => a.arquivo === recebido.caminho && a.posicao === input.posicao);
    const ref = existente?.ref ?? `arte-${uuidv4().slice(0, 8)}`;
    if (!existente) state.artes.push({ ref, arquivo: recebido.caminho, posicao: input.posicao, cores: input.cores });
    return {
      status: "arte_registrada",
      arte_ref: ref,
      arquivo: recebido.nome,
      tamanho_kb: Math.max(1, Math.round(recebido.bytes / 1024)),
      posicao: input.posicao ?? "não especificada",
      cores: input.cores ?? "não especificadas",
      mensagem: "Arte registrada! Vou incluir essa referência no orçamento para a equipe.",
    };
  }

  const ext = extname(input.descricao_arquivo).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      erro: "formato_nao_aceito",
      formatos_aceitos: ALLOWED_EXTENSIONS.join(", "),
      mensagem: `Formato "${ext || "sem extensão"}" não aceito. Por favor, envie a arte em: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }

  if (state.canal === "whatsapp") {
    return {
      erro: "arquivo_nao_recebido",
      arquivos_recebidos: (state.arquivosRecebidos ?? []).map((a) => a.nome),
      mensagem: `Esse arquivo não chegou nesta conversa. Peça para o cliente enviar a arte de novo, em ${ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }

  const ref = `arte-${uuidv4().slice(0, 8)}`;
  state.artes.push({
    ref,
    arquivo: input.descricao_arquivo,
    posicao: input.posicao,
    cores: input.cores,
  });

  return {
    status: "arte_registrada",
    arte_ref: ref,
    arquivo: input.descricao_arquivo,
    posicao: input.posicao ?? "não especificada",
    cores: input.cores ?? "não especificadas",
    mensagem: "Arte registrada! Vou incluir essa referência no orçamento para a equipe.",
  };
}
