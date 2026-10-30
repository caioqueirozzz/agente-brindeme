import type { MensagemLote } from "../contrato/esquemas.js";

export interface OpcoesFila {
  silencioMs: number;
  maxMs: number;
  maxMensagens: number;
}

export type ProcessarLote = (telefone: string, chatId: string, mensagens: MensagemLote[]) => Promise<void>;

/** mensagem null = lugar reservado para uma mídia que ainda está baixando. */
interface Item {
  id: string;
  mensagem: MensagemLote | null;
}

interface EstadoConversa {
  chatId: string;
  buffer: Item[];
  primeiraEm: number;
  ultimaEm: number;
  timer?: ReturnType<typeof setTimeout>;
  ocupada: boolean;
}

export class ConjuntoLimitado {
  private readonly itens = new Set<string>();

  constructor(private readonly limite: number) {}

  has(id: string): boolean {
    return this.itens.has(id);
  }

  add(id: string): void {
    this.itens.add(id);
    if (this.itens.size > this.limite) {
      const maisAntigo = this.itens.values().next().value;
      if (maisAntigo !== undefined) this.itens.delete(maisAntigo);
    }
  }

  /** Do mais antigo ao mais recente. */
  valores(): string[] {
    return [...this.itens];
  }
}

export class FilaConversas {
  private readonly conversas = new Map<string, EstadoConversa>();
  private readonly naFila = new Set<string>();

  constructor(
    private readonly opcoes: OpcoesFila,
    private readonly processar: ProcessarLote
  ) {}

  adicionar(telefone: string, chatId: string, mensagem: MensagemLote): boolean {
    return this.entrar(telefone, chatId, { id: mensagem.id, mensagem });
  }

  /** Guarda o lugar de uma mídia antes do download; o lote não fecha enquanto ela não for preenchida ou cancelada. */
  reservar(telefone: string, chatId: string, id: string): boolean {
    return this.entrar(telefone, chatId, { id, mensagem: null });
  }

  preencher(telefone: string, id: string, mensagem: MensagemLote): void {
    const c = this.conversas.get(telefone);
    const item = c?.buffer.find((i) => i.id === id);
    if (!c || !item) return;
    item.mensagem = mensagem;
    this.agendar(telefone, c);
  }

  cancelar(telefone: string, id: string): void {
    const c = this.conversas.get(telefone);
    if (!c) return;
    c.buffer = c.buffer.filter((i) => i.id !== id);
    this.naFila.delete(id);
    this.agendar(telefone, c);
  }

  ocupada(telefone: string): boolean {
    const c = this.conversas.get(telefone);
    return !!c && (c.ocupada || c.buffer.length > 0);
  }

  temNoBuffer(telefone: string): boolean {
    return (this.conversas.get(telefone)?.buffer.length ?? 0) > 0;
  }

  esquecer(ids: string[]): void {
    for (const id of ids) this.naFila.delete(id);
  }

  /** Roda um turno sem mensagem nova, para repetir o que ficou pendente na conversa. */
  cutucar(telefone: string): void {
    const c = this.conversas.get(telefone);
    if (!c || c.ocupada || c.buffer.length > 0) return;
    void this.executar(telefone, c, []);
  }

  private entrar(telefone: string, chatId: string, item: Item): boolean {
    if (this.naFila.has(item.id)) return false;
    this.naFila.add(item.id);
    let c = this.conversas.get(telefone);
    if (!c) {
      c = { chatId, buffer: [], primeiraEm: 0, ultimaEm: 0, ocupada: false };
      this.conversas.set(telefone, c);
    }
    c.chatId = chatId;
    const agora = Date.now();
    if (c.buffer.length === 0) c.primeiraEm = agora;
    c.ultimaEm = agora;
    c.buffer.push(item);
    this.agendar(telefone, c);
    return true;
  }

  private agendar(telefone: string, c: EstadoConversa): void {
    if (c.timer) clearTimeout(c.timer);
    c.timer = undefined;
    if (c.ocupada || c.buffer.length === 0) return;
    if (c.buffer.some((i) => i.mensagem === null)) return;
    if (c.buffer.length >= this.opcoes.maxMensagens) {
      void this.fechar(telefone, c);
      return;
    }
    const prazo = Math.min(c.ultimaEm + this.opcoes.silencioMs, c.primeiraEm + this.opcoes.maxMs);
    c.timer = setTimeout(() => void this.fechar(telefone, c), Math.max(0, prazo - Date.now()));
  }

  private async fechar(telefone: string, c: EstadoConversa): Promise<void> {
    c.timer = undefined;
    if (c.ocupada || c.buffer.length === 0 || c.buffer.some((i) => i.mensagem === null)) return;
    const lote = c.buffer.splice(0, this.opcoes.maxMensagens).map((i) => i.mensagem as MensagemLote);
    await this.executar(telefone, c, lote);
  }

  private async executar(telefone: string, c: EstadoConversa, lote: MensagemLote[]): Promise<void> {
    c.ocupada = true;
    try {
      await this.processar(telefone, c.chatId, lote);
    } catch {
      this.esquecer(lote.map((m) => m.id));
    } finally {
      c.ocupada = false;
      this.agendar(telefone, c);
    }
  }
}
