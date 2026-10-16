/** nao_suportada: formato que nunca vira arte (vídeo) — recusado sem baixar. */
export type TipoMensagem = "texto" | "midia" | "audio" | "nao_suportada" | "ignorada";

export interface MidiaBaixada {
  mime: string;
  base64: string;
  nome?: string;
}

export interface MensagemRecebida {
  id: string;
  chatId: string;
  /** Telefone normalizado da conversa; null quando não deu para resolver (ex.: @lid sem número). */
  telefone: string | null;
  deMim: boolean;
  /** Mensagem minha na conversa "Mensagem para mim". */
  paraMim: boolean;
  direta: boolean;
  tipo: TipoMensagem;
  texto: string;
  timestamp: string;
  /** Tamanho informado pelo WhatsApp antes do download, quando ele informa. */
  bytesDeclarados?: number;
  baixarMidia?: () => Promise<MidiaBaixada | null>;
}

export interface ConversaPendente {
  chatId: string;
  mensagens: MensagemRecebida[];
}

export interface CanalWhatsApp {
  aoMensagem(handler: (m: MensagemRecebida) => void): void;
  aoPronto(handler: () => void): void;
  enviar(chatId: string, texto: string): Promise<void>;
  /** Mostra "digitando…" por `duracaoMs` (padrão: 4s). */
  digitando(chatId: string, duracaoMs?: number): Promise<void>;
  pararDigitando(chatId: string): Promise<void>;
  marcarComoLida(chatId: string): Promise<void>;
  /** Conversas diretas com mensagens do cliente ainda não lidas. */
  pendentes(): Promise<ConversaPendente[]>;
  meuChatId(): string;
}
