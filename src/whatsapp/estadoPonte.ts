import { resolve } from "path";
import type { Evento, Modo } from "../contrato/esquemas.js";
import type { LogPonte } from "./log.js";
import { gravarArquivoAtomico, lerArquivo, separarCorrompido } from "../util/arquivo.js";

/** Partes da resposta às mensagens `ids` que já chegaram ao cliente. */
export interface EntregaParcial {
  ids: string[];
  partes: string[];
}

/** O que a ponte precisa lembrar depois de reiniciar para não repetir resposta nem esquecer o atendente. */
export interface EstadoPonte {
  versao: 1;
  modos: Record<string, Modo>;
  eventosPendentes: Evento[];
  avisosPendentes: string[];
  concluidos: string[];
  /** Por telefone. Opcional: estado gravado antes da rodada 3 não tem. */
  entregasParciais?: Record<string, EntregaParcial>;
}

export interface ArmazemPonte {
  carregar(): EstadoPonte;
  salvar(estado: EstadoPonte): void;
}

export function estadoVazio(): EstadoPonte {
  return { versao: 1, modos: {}, eventosPendentes: [], avisosPendentes: [], concluidos: [], entregasParciais: {} };
}

export class MemoriaEstadoPonte implements ArmazemPonte {
  constructor(public estado: EstadoPonte = estadoVazio()) {}

  carregar(): EstadoPonte {
    return structuredClone(this.estado);
  }

  salvar(estado: EstadoPonte): void {
    this.estado = structuredClone(estado);
  }
}

export class ArquivoEstadoPonte implements ArmazemPonte {
  private readonly arquivo: string;

  constructor(
    arquivo: string,
    private readonly log: LogPonte = () => {}
  ) {
    this.arquivo = resolve(arquivo);
  }

  carregar(): EstadoPonte {
    const bruto = lerArquivo(this.arquivo);
    if (bruto === null) return estadoVazio();
    try {
      const e = JSON.parse(bruto) as EstadoPonte;
      if (
        e?.versao !== 1 ||
        !Array.isArray(e.concluidos) ||
        !Array.isArray(e.eventosPendentes) ||
        !Array.isArray(e.avisosPendentes) ||
        typeof e.modos !== "object" ||
        e.modos === null
      ) {
        throw new Error("formato inesperado");
      }
      e.entregasParciais = entregasValidas(e.entregasParciais);
      return e;
    } catch (err) {
      const destino = separarCorrompido(this.arquivo);
      this.log({ type: "alerta", gravidade: "alta", motivo: "estado_da_ponte_corrompido", arquivo: destino ?? this.arquivo, erro: String(err) });
      return estadoVazio();
    }
  }

  salvar(estado: EstadoPonte): void {
    gravarArquivoAtomico(this.arquivo, JSON.stringify(estado));
  }
}

const textos = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function entregasValidas(bruto: unknown): Record<string, EntregaParcial> {
  if (typeof bruto !== "object" || bruto === null) return {};
  const validas: Record<string, EntregaParcial> = {};
  for (const [telefone, e] of Object.entries(bruto as Record<string, Partial<EntregaParcial>>)) {
    if (textos(e?.ids) && textos(e?.partes)) validas[telefone] = { ids: e.ids, partes: e.partes };
  }
  return validas;
}
