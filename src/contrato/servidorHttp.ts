import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { ZodError } from "zod";
import { eventoSchema, pedidoMensagensSchema } from "./esquemas.js";
import { ConversaDesconhecidaError, TurnoEmAndamentoError, type Agente } from "./agente.js";

const LIMITE_CORPO_BYTES = 1_000_000;

class CorpoInvalidoError extends Error {}

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let tamanho = 0;
    req.on("data", (parte: Buffer) => {
      tamanho += parte.length;
      if (tamanho > LIMITE_CORPO_BYTES) {
        reject(new CorpoInvalidoError("corpo maior que 1 MB"));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString("utf-8")));
      } catch {
        reject(new CorpoInvalidoError("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

function responder(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corpo));
}

export function criarServidorAgente(
  agente: Agente,
  log: (evento: Record<string, unknown>) => void = () => {}
): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/api/health") {
        responder(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && req.url === "/api/mensagens") {
        const pedido = pedidoMensagensSchema.parse(await lerCorpo(req));
        responder(res, 200, await agente.processarLote(pedido));
        return;
      }
      if (req.method === "POST" && req.url === "/api/eventos") {
        const evento = eventoSchema.parse(await lerCorpo(req));
        responder(res, 200, await agente.processarEvento(evento));
        return;
      }
      responder(res, 404, { status: "nao_encontrado" });
    } catch (err) {
      if (err instanceof TurnoEmAndamentoError) {
        responder(res, 409, { status: "em_andamento" });
      } else if (err instanceof ConversaDesconhecidaError) {
        responder(res, 404, { status: "conversa_desconhecida" });
      } else if (err instanceof ZodError || err instanceof CorpoInvalidoError) {
        responder(res, 400, { status: "invalido", erro: err.message.slice(0, 500) });
      } else {
        log({ type: "erro_agente", erro: String(err) });
        responder(res, 503, { status: "falha_temporaria" });
      }
    }
  });
}
