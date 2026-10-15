import type { Evento, PedidoMensagens, RespostaEvento, RespostaMensagens } from "./esquemas.js";

export class TurnoEmAndamentoError extends Error {
  constructor() {
    super("turno em andamento nesta conversa");
    this.name = "TurnoEmAndamentoError";
  }
}

/** #devolver de um telefone sem conversa: número digitado errado, nunca uma conversa nova. */
export class ConversaDesconhecidaError extends Error {
  constructor() {
    super("o agente não tem conversa com esse telefone");
    this.name = "ConversaDesconhecidaError";
  }
}

export interface Agente {
  processarLote(pedido: PedidoMensagens): Promise<RespostaMensagens>;
  processarEvento(evento: Evento): Promise<RespostaEvento>;
}
