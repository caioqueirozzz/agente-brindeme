import { ConversaDesconhecidaError, TurnoEmAndamentoError, type Agente } from "../contrato/agente.js";
import type {
  Evento,
  Modo,
  PedidoMensagens,
  RespostaEvento,
  RespostaMensagens,
} from "../contrato/esquemas.js";
import { loteParaTexto } from "../contrato/texto.js";

export class AgenteEco implements Agente {
  private readonly modos = new Map<string, Modo>();
  private readonly turnos = new Map<string, RespostaMensagens>();
  private readonly emAndamento = new Set<string>();
  private readonly idsVistos = new Set<string>();
  private readonly conhecidos = new Set<string>();

  constructor(private readonly opcoes: { atrasoMs?: number } = {}) {}

  async processarLote(pedido: PedidoMensagens): Promise<RespostaMensagens> {
    const guardada = this.turnos.get(pedido.turnoId);
    if (guardada) return guardada;
    if (this.emAndamento.has(pedido.telefone)) throw new TurnoEmAndamentoError();
    this.emAndamento.add(pedido.telefone);
    this.conhecidos.add(pedido.telefone);
    try {
      if (this.opcoes.atrasoMs) await new Promise((r) => setTimeout(r, this.opcoes.atrasoMs));
      const novas = pedido.mensagens.filter((m) => !this.idsVistos.has(m.id));
      for (const m of novas) this.idsVistos.add(m.id);
      const modo = this.modos.get(pedido.telefone) ?? "ia";
      const resposta: RespostaMensagens =
        modo === "humano" || novas.length === 0
          ? { respostas: [], modo }
          : { respostas: [`eco: ${loteParaTexto(novas)}`], modo };
      this.turnos.set(pedido.turnoId, resposta);
      return resposta;
    } finally {
      this.emAndamento.delete(pedido.telefone);
    }
  }

  async processarEvento(evento: Evento): Promise<RespostaEvento> {
    if (evento.tipo === "devolver" && !this.conhecidos.has(evento.telefone)) throw new ConversaDesconhecidaError();
    this.conhecidos.add(evento.telefone);
    const modo: Modo = evento.tipo === "devolver" ? "ia" : "humano";
    this.modos.set(evento.telefone, modo);
    return { modo };
  }
}
