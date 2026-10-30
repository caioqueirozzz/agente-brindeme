import type { ClienteAgente, ResultadoEvento, ResultadoLote } from "../../src/whatsapp/agenteHttp.js";
import type { Evento, PedidoMensagens } from "../../src/contrato/esquemas.js";

type Passo = ResultadoLote | (() => Promise<ResultadoLote>);

export class AgenteFalso implements ClienteAgente {
  lotes: PedidoMensagens[] = [];
  eventos: Evento[] = [];
  roteiro: Passo[] = [];
  padrao: ResultadoLote = { tipo: "ok", resposta: { respostas: ["olá"], modo: "ia" } };
  /** Toda entrega de evento falha (agente fora). */
  eventosFalham = false;
  /** O agente responde `statusRecusa` (400) a qualquer evento. */
  eventosRecusados = false;
  statusRecusa = 400;
  /** Eventos destes telefones falham; os outros passam. */
  falhamPara = new Set<string>();

  async enviarLote(pedido: PedidoMensagens): Promise<ResultadoLote> {
    this.lotes.push(pedido);
    const passo = this.roteiro.shift() ?? this.padrao;
    return typeof passo === "function" ? passo() : passo;
  }

  async enviarEvento(evento: Evento): Promise<ResultadoEvento> {
    if (this.eventosRecusados) return { tipo: "recusado", status: this.statusRecusa };
    if (this.eventosFalham || this.falhamPara.has(evento.telefone)) return { tipo: "falha", motivo: "fora" };
    this.eventos.push(evento);
    return { tipo: "ok", resposta: { modo: evento.tipo === "devolver" ? "ia" : "humano" } };
  }
}
