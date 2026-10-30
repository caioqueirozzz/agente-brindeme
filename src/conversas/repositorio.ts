import { existsSync } from "fs";
import { join, resolve } from "path";
import { z } from "zod";
import { createInitialState, type ConversationState } from "../agent/state.js";
import { respostaMensagensSchema, type RespostaMensagens } from "../contrato/esquemas.js";
import type { ResumoTransferencia } from "../tools/transferirHumano.js";
import { gravarArquivoAtomico, lerArquivo, separarCorrompido } from "../util/arquivo.js";

export const MAX_TURNOS_GUARDADOS = 20;
export const MAX_IDS_VISTOS = 1_000;
export const MAX_HISTORICO = 200;
export const MAX_ARQUIVOS_RECEBIDOS = 50;
export const MAX_FALHAS_GUARDADAS = 50;

export interface TurnoGuardado {
  turnoId: string;
  resposta: RespostaMensagens;
  /** Ids do lote; ausente em turnos salvos antes da revisão final. */
  ids?: string[];
  /** Quantas vezes o atendente tinha escrito quando a resposta foi gerada. */
  tomadas?: number;
}

export interface TransferenciaPendente {
  resumo: ResumoTransferencia;
  lacunas: string[];
}

export interface Conversa {
  versao: 1;
  estado: ConversationState;
  idsVistos: string[];
  turnos: TurnoGuardado[];
  /** turnoId → falhas seguidas do mesmo lote (a 2ª transfere). */
  falhasPorTurno: Record<string, number>;
  /** ISO das respostas da última hora, para o limite por telefone. */
  respostasRecentes: string[];
  /** Mensagens do atendente recebidas nesta conversa. */
  tomadas?: number;
  /** Transferência feita num turno que ainda não respondeu ao cliente (o processo pode ter caído no meio). */
  transferenciaPendente?: TransferenciaPendente;
  /** suspensoEm da suspensão em que o cliente já recebeu o aviso de fora do ar (um aviso por suspensão). */
  avisoSuspensao?: string;
}

const conversaSchema = z
  .object({
    versao: z.literal(1),
    estado: z
      .object({
        conversaId: z.string(),
        telefone: z.string(),
        modo: z.enum(["ia", "humano"]),
        cliente: z.object({}).passthrough(),
        necessidade: z.object({}).passthrough(),
        produtosDiscutidos: z.array(z.string()),
        subprodutoParaProduto: z.record(z.string()),
        artes: z.array(z.object({ ref: z.string(), arquivo: z.string() }).passthrough()),
        arquivosRecebidos: z
          .array(z.object({ nome: z.string(), caminho: z.string(), mime: z.string(), bytes: z.number() }))
          .optional(),
        falhasConsecutivas: z.number(),
        historico: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string(), timestamp: z.string() })),
      })
      .passthrough(),
    idsVistos: z.array(z.string()),
    turnos: z.array(
      z.object({
        turnoId: z.string(),
        resposta: respostaMensagensSchema,
        ids: z.array(z.string()).optional(),
        tomadas: z.number().optional(),
      })
    ),
    falhasPorTurno: z.record(z.number()),
    respostasRecentes: z.array(z.string()),
    tomadas: z.number().optional(),
    transferenciaPendente: z.object({ resumo: z.object({}).passthrough(), lacunas: z.array(z.string()) }).optional(),
  })
  .passthrough();

export function novaConversa(telefone: string): Conversa {
  return {
    versao: 1,
    estado: createInitialState(telefone),
    idsVistos: [],
    turnos: [],
    falhasPorTurno: {},
    respostasRecentes: [],
  };
}

export class RepositorioConversas {
  private readonly dir: string;

  constructor(
    dir: string,
    private readonly log: (evento: Record<string, unknown>) => void = () => {}
  ) {
    this.dir = resolve(dir);
  }

  existe(telefone: string): boolean {
    return existsSync(this.arquivo(telefone));
  }

  carregar(telefone: string): Conversa {
    const arquivo = this.arquivo(telefone);
    const bruto = lerArquivo(arquivo);
    if (bruto === null) return novaConversa(telefone);
    try {
      const c = conversaSchema.parse(JSON.parse(bruto)) as unknown as Conversa;
      if (c.estado.telefone !== telefone) throw new Error("arquivo de outro telefone");
      return c;
    } catch (err) {
      const destino = separarCorrompido(arquivo);
      this.log({ type: "alerta", gravidade: "alta", motivo: "estado_corrompido", arquivo: destino ?? arquivo, erro: String(err).slice(0, 500) });
      return novaConversa(telefone);
    }
  }

  salvar(c: Conversa): void {
    c.turnos = c.turnos.slice(-MAX_TURNOS_GUARDADOS);
    c.idsVistos = c.idsVistos.slice(-MAX_IDS_VISTOS);
    c.estado.historico = c.estado.historico.slice(-MAX_HISTORICO);
    if (c.estado.arquivosRecebidos) c.estado.arquivosRecebidos = c.estado.arquivosRecebidos.slice(-MAX_ARQUIVOS_RECEBIDOS);
    const falhas = Object.entries(c.falhasPorTurno);
    if (falhas.length > MAX_FALHAS_GUARDADAS) c.falhasPorTurno = Object.fromEntries(falhas.slice(-MAX_FALHAS_GUARDADAS));
    gravarArquivoAtomico(this.arquivo(c.estado.telefone), JSON.stringify(c));
  }

  private arquivo(telefone: string): string {
    if (!/^\d{10,15}$/.test(telefone)) throw new Error("telefone inválido para nome de arquivo");
    return join(this.dir, `${telefone}.json`);
  }
}
