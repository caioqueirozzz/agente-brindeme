import type { CanalWhatsApp } from "./canal.js";
import type { LogPonte } from "./log.js";

export const CHAVE_EU = "eu";
export const DIGITANDO_MAX_MS = 4_000;
const VALIDADE_REGISTRO_MS = 120_000;

export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tempoDigitando(texto: string): number {
  return Math.min(DIGITANDO_MAX_MS, 800 + texto.length * 25);
}

export interface Saida {
  /** Vira true quando o eco do envio chega: a mensagem saiu, mesmo que o envio tenha lançado erro. */
  confirmada: boolean;
}

export class RegistroSaida {
  private pendentes: Array<{ chave: string; texto: string; em: number; saida: Saida }> = [];

  constructor(private readonly validadeMs = VALIDADE_REGISTRO_MS) {}

  registrar(chave: string, texto: string): Saida {
    const saida: Saida = { confirmada: false };
    this.pendentes.push({ chave, texto: texto.trim(), em: Date.now(), saida });
    return saida;
  }

  consumir(chave: string, texto: string): boolean {
    const agora = Date.now();
    this.pendentes = this.pendentes.filter((p) => agora - p.em <= this.validadeMs);
    const i = this.pendentes.findIndex((p) => p.chave === chave && p.texto === texto.trim());
    if (i === -1) return false;
    this.pendentes[i].saida.confirmada = true;
    this.pendentes.splice(i, 1);
    return true;
  }
}

export class LimitadorEnvios {
  private envios: number[] = [];

  constructor(private readonly porMinuto: number) {}

  async aguardarVez(): Promise<void> {
    for (;;) {
      const agora = Date.now();
      this.envios = this.envios.filter((t) => agora - t < 60_000);
      if (this.envios.length < this.porMinuto) {
        this.envios.push(agora);
        return;
      }
      await esperar(this.envios[0] + 60_000 - agora);
    }
  }
}

export class Envio {
  private readonly registro = new RegistroSaida();
  private readonly limitador: LimitadorEnvios;

  constructor(
    private readonly canal: CanalWhatsApp,
    enviosPorMinuto: number,
    private readonly log: LogPonte = () => {}
  ) {
    this.limitador = new LimitadorEnvios(enviosPorMinuto);
  }

  ehMinha(chave: string, texto: string): boolean {
    return this.registro.consumir(chave, texto);
  }

  /** `continuar` é conferido logo antes de cada tentativa sair; false cancela o envio (devolve false). */
  paraCliente(telefone: string, chatId: string, texto: string, continuar: () => boolean = () => true): Promise<boolean> {
    return this.enviar(telefone, chatId, texto, true, continuar);
  }

  paraMim(texto: string): Promise<boolean> {
    return this.enviar(CHAVE_EU, this.canal.meuChatId(), texto, false, () => true);
  }

  private async enviar(
    chave: string,
    chatId: string,
    texto: string,
    digitar: boolean,
    continuar: () => boolean
  ): Promise<boolean> {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      if (digitar) {
        await this.canal.digitando(chatId).catch(() => {});
        await esperar(tempoDigitando(texto));
      }
      // A vaga do limite é tomada só agora, no instante do envio, e não antes do "digitando".
      await this.limitador.aguardarVez();
      if (!continuar()) return false;
      // Registra antes de enviar: o eco (message_create) chega antes do envio resolver.
      // Em falha o registro fica até expirar, porque a mensagem pode ter saído mesmo assim.
      const saida = this.registro.registrar(chave, texto);
      try {
        await this.canal.enviar(chatId, texto);
        return true;
      } catch (err) {
        this.log({ type: "envio_falhou", tentativa, erro: String(err) });
        if (saida.confirmada) return true;
      }
    }
    return false;
  }
}
