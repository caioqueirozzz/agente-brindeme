import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import type { ConversationState, FichaPedido } from "../agent/state.js";
import { marcaUltimaMensagemCliente, nomesDosProdutos, ultimasMensagens } from "../agent/state.js";

export const MOTIVOS = [
  "orcamento_para_emitir",
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

export type MotivoTransferencia = (typeof MOTIVOS)[number];

export const MENSAGEM_TRANSFERENCIA =
  "Vou te conectar com um atendente agora. Em instantes alguém da nossa equipe entrará em contato! 😊";

export interface ResumoTransferencia {
  conversaId: string;
  telefone_cliente: string;
  cliente: ConversationState["cliente"];
  motivo: MotivoTransferencia;
  prioridade: "normal" | "alta";
  observacao?: string;
  produtos_discutidos: string[];
  /** Opcional: resumo gravado em disco antes deste campo existir não pode travar a transferência. */
  produtos_nomes?: string[];
  /** Estimativa confirmada pelo cliente, para o atendente emitir o orçamento (motivo orcamento_para_emitir). */
  ficha_pedido?: FichaPedido["resumo"];
  artes_registradas: string[];
  necessidade: ConversationState["necessidade"];
  ultimas_mensagens: string;
  responsavel: { id: string; nome: string };
  transferido_em: string;
}

/** listAdmins só escolhe o nome do responsável: com a API lenta, a transferência não espera por ele. */
const PRAZO_ADMINS_MS = 5_000;

export async function transferirHumanoHandler(
  input: TransferirHumanoInput,
  state: ConversationState,
  client: BrindeMeClient
) {
  if (input.motivo === "orcamento_para_emitir") {
    if (!state.fichaPedido) {
      return {
        erro: "sem_estimativa",
        instrucao_ao_agente: "Chame preparar_orcamento antes: a equipe precisa da estimativa para emitir o orçamento.",
      };
    }
    // A confirmação é uma mensagem do cliente DEPOIS do resumo; no mesmo turno ele nem viu o resumo.
    if (state.fichaPedido.mensagemDoResumo === marcaUltimaMensagemCliente(state)) {
      return {
        erro: "aguardando_confirmacao",
        instrucao_ao_agente:
          "Mostre o resumo ao cliente e espere ele confirmar numa nova mensagem antes de enviar para a equipe.",
      };
    }
  }

  // A transferência por falha de sistema acontece justamente com a API fora: listAdmins não pode derrubá-la.
  let admins: Awaited<ReturnType<BrindeMeClient["listAdmins"]>> = [];
  let prazo: ReturnType<typeof setTimeout> | undefined;
  try {
    admins = await Promise.race([
      client.listAdmins(),
      new Promise<typeof admins>((resolve) => (prazo = setTimeout(() => resolve([]), PRAZO_ADMINS_MS))),
    ]);
  } catch {
    admins = [];
  } finally {
    clearTimeout(prazo);
  }

  // Pick the admin linked to a budget if possible
  let adminResponsavel = admins[0];
  if (!adminResponsavel) {
    adminResponsavel = { id: "desconhecido", name: "Equipe", email: "", phone: "" };
  }

  const resumo: ResumoTransferencia = {
    conversaId: state.conversaId,
    telefone_cliente: maskPhone(state.telefone),
    cliente: state.cliente,
    motivo: input.motivo,
    prioridade: input.prioridade,
    observacao: input.observacao,
    produtos_discutidos: state.produtosDiscutidos,
    produtos_nomes: nomesDosProdutos(state),
    ...(state.fichaPedido ? { ficha_pedido: state.fichaPedido.resumo } : {}),
    artes_registradas: state.artes.map((a) => a.arquivo),
    necessidade: state.necessidade,
    ultimas_mensagens: ultimasMensagens(state),
    responsavel: {
      id: adminResponsavel.id,
      nome: adminResponsavel.name,
    },
    transferido_em: new Date().toISOString(),
  };

  state.modo = "humano";
  state.fichaPedido = undefined;

  return {
    status: "transferido",
    resumo_para_atendente: resumo,
    mensagem_cliente: MENSAGEM_TRANSFERENCIA,
  };
}

/** Mantém 4 dígitos em cada ponta. Com menos de 10 não sobra o que esconder: "***" (antes, 6–7 dígitos lançavam RangeError). */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return "***";
  return digits.slice(0, 4) + "*".repeat(digits.length - 8) + digits.slice(-4);
}
