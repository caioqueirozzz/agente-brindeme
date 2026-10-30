import {
  respostaEventoSchema,
  respostaMensagensSchema,
  type Evento,
  type PedidoMensagens,
  type RespostaEvento,
  type RespostaMensagens,
} from "../contrato/esquemas.js";

export type ResultadoLote =
  | { tipo: "ok"; resposta: RespostaMensagens }
  | { tipo: "em_andamento" }
  | { tipo: "falha"; motivo: string };

/** recusado: o agente respondeu 4xx — repetir não adianta. falha: rede, prazo ou 5xx — repetir depois. */
export type ResultadoEvento =
  | { tipo: "ok"; resposta: RespostaEvento }
  | { tipo: "recusado"; status: number }
  | { tipo: "falha"; motivo: string };

export interface ClienteAgente {
  /** `prazoMs` encurta a espera desta chamada (o que sobra do prazo total do lote). */
  enviarLote(pedido: PedidoMensagens, prazoMs?: number): Promise<ResultadoLote>;
  enviarEvento(evento: Evento): Promise<ResultadoEvento>;
}

export function criarClienteHttp(baseUrl: string, timeoutMs: number): ClienteAgente {
  function post(rota: string, corpo: unknown, prazoMs = timeoutMs): Promise<Response> {
    return fetch(`${baseUrl}${rota}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(Math.max(1, Math.min(prazoMs, timeoutMs))),
    });
  }

  return {
    async enviarLote(pedido, prazoMs) {
      try {
        const res = await post("/api/mensagens", pedido, prazoMs);
        if (res.status === 409) return { tipo: "em_andamento" };
        if (!res.ok) {
          const corpo = await res.text().catch(() => "");
          return { tipo: "falha", motivo: `http_${res.status}: ${corpo.slice(0, 300)}` };
        }
        return { tipo: "ok", resposta: respostaMensagensSchema.parse(await res.json()) };
      } catch (err) {
        return { tipo: "falha", motivo: err instanceof Error ? err.name : "erro" };
      }
    },

    async enviarEvento(evento) {
      try {
        const res = await post("/api/eventos", evento);
        if (res.status >= 400 && res.status < 500) return { tipo: "recusado", status: res.status };
        if (!res.ok) return { tipo: "falha", motivo: `http_${res.status}` };
        return { tipo: "ok", resposta: respostaEventoSchema.parse(await res.json()) };
      } catch (err) {
        return { tipo: "falha", motivo: err instanceof Error ? err.name : "erro" };
      }
    },
  };
}
