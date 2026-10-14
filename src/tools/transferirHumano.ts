import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import type { ConversationState } from "../agent/state.js";

export const MOTIVOS = [
  "pedido_cliente",
  "reclamacao",
  "desconto",
  "pagamento",
  "frete_prazo",
  "ajuste_mockup",
  "falha_sistema",
  "nao_entendido",
  "arte_problematica",
  "lacuna_conhecimento",
  "outro",
] as const;

export const transferirHumanoSchema = z.object({
  motivo: z.enum(MOTIVOS).describe("Motivo da transferência"),
  prioridade: z.enum(["normal", "alta"]).describe("Prioridade: alta para reclamações e urgências"),
  observacao: z.string().max(300).optional().describe("Observações adicionais para o atendente"),
});

export type TransferirHumanoInput = z.infer<typeof transferirHumanoSchema>;

export async function transferirHumanoHandler(
  input: TransferirHumanoInput,
  state: ConversationState,
  client: BrindeMeClient
) {
  const admins = await client.listAdmins();

  // Pick the admin linked to a budget if possible
  let adminResponsavel = admins[0];
  if (!adminResponsavel) {
    adminResponsavel = { id: "desconhecido", name: "Equipe", email: "", phone: "" };
  }

  const ultimasMensagens = state.historico
    .slice(-4)
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n");

  const resumo = {
    conversaId: state.conversaId,
    telefone_cliente: maskPhone(state.telefone),
    cliente: state.cliente,
    motivo: input.motivo,
    prioridade: input.prioridade,
    observacao: input.observacao,
    produtos_discutidos: state.produtosDiscutidos,
    orcamentos_na_conversa: state.orcamentos,
    artes_registradas: state.artes.map((a) => a.arquivo),
    necessidade: state.necessidade,
    ultimas_mensagens: ultimasMensagens,
    responsavel: {
      id: adminResponsavel.id,
      nome: adminResponsavel.name,
    },
    transferido_em: new Date().toISOString(),
  };

  state.modo = "humano";

  return {
    status: "transferido",
    resumo_para_atendente: resumo,
    mensagem_cliente:
      "Vou te conectar com um atendente agora. Em instantes alguém da nossa equipe entrará em contato! 😊",
  };
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return digits.slice(0, 4) + "*".repeat(digits.length - 8) + digits.slice(-4);
}
