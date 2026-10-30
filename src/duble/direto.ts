import { ConversaDesconhecidaError, TurnoEmAndamentoError, type Agente } from "../contrato/agente.js";
import type { Evento, PedidoMensagens, RespostaEvento, RespostaMensagens } from "../contrato/esquemas.js";
import { formatarParaWhatsApp, loteParaTexto } from "../contrato/texto.js";
import { addMessage, createInitialState, type ConversationState } from "../agent/state.js";
import { runTurn } from "../agent/runTurn.js";
import type { LLMProvider } from "../llm/types.js";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { Logger } from "../logging/logger.js";

export class AgenteDireto implements Agente {
  private readonly estados = new Map<string, ConversationState>();
  private readonly turnos = new Map<string, RespostaMensagens>();
  private readonly emAndamento = new Set<string>();
  private readonly idsVistos = new Set<string>();

  constructor(
    private readonly llm: LLMProvider,
    private readonly client: BrindeMeClient
  ) {}

  private estado(telefone: string): ConversationState {
    let estado = this.estados.get(telefone);
    if (!estado) {
      estado = createInitialState(telefone);
      this.estados.set(telefone, estado);
    }
    return estado;
  }

  async processarLote(pedido: PedidoMensagens): Promise<RespostaMensagens> {
    const guardada = this.turnos.get(pedido.turnoId);
    if (guardada) return guardada;
    if (this.emAndamento.has(pedido.telefone)) throw new TurnoEmAndamentoError();
    this.emAndamento.add(pedido.telefone);
    try {
      const estado = this.estado(pedido.telefone);
      const novas = pedido.mensagens.filter((m) => !this.idsVistos.has(m.id));
      if (novas.length === 0) return { respostas: [], modo: estado.modo };
      const resultado = await runTurn(
        loteParaTexto(novas),
        estado,
        this.llm,
        this.client,
        new Logger(estado.conversaId)
      );
      for (const m of novas) this.idsVistos.add(m.id);
      const resposta: RespostaMensagens = {
        respostas: formatarParaWhatsApp(resultado.response ?? ""),
        modo: estado.modo,
        ...(resultado.transferred
          ? {
              avisoAtendente: `🔔 Conversa ${pedido.telefone} transferida para atendente.\nPara devolver: #devolver ${pedido.telefone}`,
            }
          : {}),
      };
      this.turnos.set(pedido.turnoId, resposta);
      return resposta;
    } finally {
      this.emAndamento.delete(pedido.telefone);
    }
  }

  async processarEvento(evento: Evento): Promise<RespostaEvento> {
    if (evento.tipo === "devolver" && !this.estados.has(evento.telefone)) throw new ConversaDesconhecidaError();
    const estado = this.estado(evento.telefone);
    if (evento.tipo === "mensagem_atendente") {
      estado.modo = "humano";
      addMessage(estado, "assistant", `[Atendente]: ${evento.texto}`);
    } else {
      estado.modo = "ia";
      estado.falhasConsecutivas = 0;
      addMessage(
        estado,
        "assistant",
        evento.nota
          ? `[Atendente devolveu o atendimento à IA com a nota: "${evento.nota}"]`
          : "[Atendente devolveu o atendimento à IA]"
      );
    }
    return { modo: estado.modo };
  }
}
