import type { CanalWhatsApp, ConversaPendente, MensagemRecebida } from "../../src/whatsapp/canal.js";

export const TELEFONE_EU = "5583900000000";
export const CHAT_EU = `${TELEFONE_EU}@c.us`;

/** WhatsApp em memória. Como o whatsapp-web.js, ecoa cada envio de volta como mensagem "deMim". */
export class WhatsAppFalso implements CanalWhatsApp {
  readonly eu = CHAT_EU;
  enviadas: Array<{ chatId: string; texto: string }> = [];
  lidas: string[] = [];
  digitandoEm: string[] = [];
  naoLidas: ConversaPendente[] = [];
  /** texto → quantas das próximas tentativas de enviar esse texto falham */
  falhar = new Map<string, number>();
  private handler: (m: MensagemRecebida) => void = () => {};
  private seq = 0;

  aoMensagem(handler: (m: MensagemRecebida) => void): void {
    this.handler = handler;
  }

  aoPronto(_handler: () => void): void {}

  meuChatId(): string {
    return this.eu;
  }

  async enviar(chatId: string, texto: string): Promise<void> {
    const restantes = this.falhar.get(texto) ?? 0;
    if (restantes > 0) {
      this.falhar.set(texto, restantes - 1);
      throw new Error("falha de envio simulada");
    }
    this.enviadas.push({ chatId, texto });
    this.handler(this.mensagem({ chatId, texto, deMim: true, paraMim: chatId === this.eu }));
  }

  /** Cada chamada de digitando, com a duração pedida. */
  digitandoPor: Array<{ chatId: string; duracaoMs?: number }> = [];
  paradoEm: string[] = [];

  async digitando(chatId: string, duracaoMs?: number): Promise<void> {
    this.digitandoEm.push(chatId);
    this.digitandoPor.push({ chatId, duracaoMs });
  }

  async pararDigitando(chatId: string): Promise<void> {
    this.paradoEm.push(chatId);
  }

  async marcarComoLida(chatId: string): Promise<void> {
    this.lidas.push(chatId);
  }

  async pendentes(): Promise<ConversaPendente[]> {
    return this.naoLidas;
  }

  mensagem(p: Partial<MensagemRecebida> & { chatId: string; texto: string }): MensagemRecebida {
    return {
      id: `m${++this.seq}`,
      telefone: p.chatId.split("@")[0],
      deMim: false,
      paraMim: false,
      direta: true,
      tipo: "texto",
      timestamp: new Date().toISOString(),
      ...p,
    };
  }
}
