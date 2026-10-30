import type { TipoMensagem } from "./canal.js";

export const LIMITE_NAO_SAUDAVEL = 3;
export const LIMITE_FALHAS_BATIMENTO = 3;

export interface EstadoSaude {
  naoSaudaveis: number;
  /** Leituras UNPAIRED seguidas; contadas à parte para outro estado ruim não confirmar desvinculação. */
  desvinculadas: number;
  falhasBatimento: number;
  desvinculado: boolean;
}

export type DecisaoSaude = "ok" | "aguardar" | "reconectar" | "desvinculado";

export function novoEstadoSaude(): EstadoSaude {
  return { naoSaudaveis: 0, desvinculadas: 0, falhasBatimento: 0, desvinculado: false };
}

const DESCONEXOES_TERMINAIS = new Set(["LOGOUT", "UNPAIRED", "UNPAIRED_IDLE", "TOS_BLOCK", "SMB_TOS_BLOCK"]);

/** Motivo de `disconnected` que nenhuma reconexão resolve: só um pareamento novo (ou o fim do bloqueio). */
export function desconexaoTerminal(motivo: string): boolean {
  return DESCONEXOES_TERMINAIS.has(motivo);
}

function ehDesvinculado(estado: string | null): boolean {
  return estado === "UNPAIRED" || estado === "UNPAIRED_IDLE";
}

export function decidirSaude(estadoWhatsApp: string | null, s: EstadoSaude): DecisaoSaude {
  if (s.desvinculado) return "aguardar";
  if (ehDesvinculado(estadoWhatsApp)) {
    s.naoSaudaveis = 0;
    s.desvinculadas += 1;
    if (s.desvinculadas < LIMITE_NAO_SAUDAVEL) return "aguardar";
    s.desvinculado = true;
    return "desvinculado";
  }
  s.desvinculadas = 0;
  if (estadoWhatsApp !== "CONNECTED") {
    s.naoSaudaveis += 1;
    if (s.naoSaudaveis < LIMITE_NAO_SAUDAVEL) return "aguardar";
    s.naoSaudaveis = 0;
    return "reconectar";
  }
  s.naoSaudaveis = 0;
  if (s.falhasBatimento >= LIMITE_FALHAS_BATIMENTO) {
    s.falhasBatimento = 0;
    return "reconectar";
  }
  return "ok";
}

/**
 * Mensagens do cliente ainda não lidas, para a varredura. A que ainda está cifrada fica de fora: ela chega
 * pelo evento ao vivo quando decifrar, e se a varredura a concluísse antes o texto se perderia.
 */
export function naoLidasDoCliente<T extends { fromMe: boolean; type: string }>(recentes: T[], naoLidas: number): T[] {
  if (naoLidas <= 0) return [];
  return recentes
    .filter((m) => !m.fromMe)
    .slice(-naoLidas)
    .filter((m) => m.type !== "ciphertext");
}

export function tipoDaMensagem(tipo: string): TipoMensagem {
  switch (tipo) {
    case "chat":
      return "texto";
    case "image":
    case "document":
      return "midia";
    case "video":
      return "nao_suportada";
    case "ptt":
    case "audio":
      return "audio";
    default:
      return "ignorada";
  }
}
