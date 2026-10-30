import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventEmitter } from "events";

// whatsapp-web.js inteiro trocado por um cliente falso: nada de Chrome nem WhatsApp aqui.
const controle = vi.hoisted(() => ({
  clientes: [] as unknown[],
  chats: [] as unknown[],
  estado: "CONNECTED" as string | null,
  digitando: false,
  lidFalha: false,
  envioRetorna: { id: "enviada" } as unknown,
  proprioLidErrado: false,
}));

vi.mock("whatsapp-web.js", async () => {
  const { EventEmitter } = await import("events");
  class ClienteFalso extends EventEmitter {
    info = { wid: { user: "5583900000000", _serialized: "5583900000000@c.us" } };
    pupPage = { evaluate: async () => true };
    destruido = false;
    constructor(public options: unknown) {
      super();
      controle.clientes.push(this);
    }
    async initialize() {}
    async destroy() {
      this.destruido = true;
    }
    async getState() {
      return controle.estado;
    }
    async getChats() {
      return controle.chats;
    }
    async getContactLidAndPhone(ids: string[]) {
      if (controle.lidFalha) throw new Error("sem mapeamento");
      if (ids[0] === "5583900000000@c.us" && !controle.proprioLidErrado) {
        return [{ pn: "5583900000000@c.us", lid: "999000@lid" }];
      }
      return [{ pn: "558399990000@c.us", lid: "123@lid" }];
    }
    async sendMessage() {
      return controle.envioRetorna;
    }
    async getChatById() {
      return {
        sendStateTyping: async () => {
          controle.digitando = true;
          setTimeout(() => (controle.digitando = false), 25_000);
        },
        clearState: async () => {
          controle.digitando = false;
          return true;
        },
      };
    }
  }
  return { default: { Client: ClienteFalso, LocalAuth: class {} } };
});

import { CanalWwebjs } from "../src/whatsapp/sessao.js";

const TEL = "5583999990000";

function clienteAtual(): EventEmitter & { destruido: boolean } {
  return controle.clientes.at(-1) as EventEmitter & { destruido: boolean };
}

function msg(id: string, extra: Record<string, unknown> = {}) {
  return {
    id: { _serialized: id },
    fromMe: false,
    from: `${TEL}@c.us`,
    to: "5583900000000@c.us",
    type: "chat",
    body: "oi",
    timestamp: 1791979200,
    ...extra,
  };
}

async function montar(): Promise<CanalWwebjs> {
  const canal = new CanalWwebjs({ sessaoDir: "nunca-usado", log: () => {} });
  await canal.iniciar();
  clienteAtual().emit("ready");
  return canal;
}

describe("CanalWwebjs (biblioteca falsa)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    controle.clientes = [];
    controle.chats = [];
    controle.estado = "CONNECTED";
    controle.digitando = false;
    controle.lidFalha = false;
    controle.envioRetorna = { id: "enviada" };
    controle.proprioLidErrado = false;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("evento de um cliente que já foi substituído é ignorado", async () => {
    const canal = await montar();
    const recebidas: unknown[] = [];
    canal.aoMensagem((m) => recebidas.push(m));
    const antigo = clienteAtual();
    controle.estado = null;
    antigo.emit("disconnected", "NAVIGATION");
    await vi.advanceTimersByTimeAsync(6_000);
    expect(controle.clientes).toHaveLength(2);
    antigo.emit("message_create", msg("eco-velho", { fromMe: true, from: "5583900000000@c.us", to: `${TEL}@c.us` }));
    await vi.advanceTimersByTimeAsync(0);
    expect(recebidas).toEqual([]);
  });

  it("envio que a biblioteca devolve vazio (conversa não encontrada) vira erro", async () => {
    const canal = await montar();
    controle.envioRetorna = undefined;
    await expect(canal.enviar(`${TEL}@c.us`, "oi")).rejects.toThrow();
  });

  it("'Mensagem para mim' em @lid é reconhecida mesmo sem resolver o telefone", async () => {
    const canal = await montar();
    await vi.advanceTimersByTimeAsync(0);
    const recebidas: Array<{ paraMim: boolean }> = [];
    canal.aoMensagem((m) => recebidas.push(m));
    controle.lidFalha = true;
    clienteAtual().emit("message_create", msg("nota", { fromMe: true, from: "999000@lid", to: "999000@lid", body: "#ajuda" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(recebidas).toEqual([expect.objectContaining({ paraMim: true })]);
  });

  it("lid do próprio número só é aceito se o telefone devolvido for o do chip", async () => {
    controle.proprioLidErrado = true;
    const canal = await montar();
    await vi.advanceTimersByTimeAsync(0);
    const recebidas: Array<{ telefone: string | null; paraMim: boolean }> = [];
    canal.aoMensagem((m) => recebidas.push(m));
    clienteAtual().emit("message_create", msg("do-cliente", { from: "123@lid" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(recebidas).toEqual([expect.objectContaining({ telefone: TEL, paraMim: false })]);
  });

  it("sessão que não abre em 2 min (sem QR nem autenticação) é relançada", async () => {
    const canal = new CanalWwebjs({ sessaoDir: "nunca-usado", log: () => {} });
    await canal.iniciar();
    await vi.advanceTimersByTimeAsync(119_000);
    expect(controle.clientes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controle.clientes).toHaveLength(2);
  });

  it("com o QR na tela esperando o celular, não relança", async () => {
    const canal = new CanalWwebjs({ sessaoDir: "nunca-usado", log: () => {} });
    await canal.iniciar();
    clienteAtual().emit("qr", "qr-de-teste");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(controle.clientes).toHaveLength(1);
  });

  it("digitando pelo tempo pedido; pararDigitando limpa na hora", async () => {
    const canal = await montar();
    await canal.digitando(`${TEL}@c.us`, 20_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controle.digitando).toBe(true);
    await canal.pararDigitando(`${TEL}@c.us`);
    expect(controle.digitando).toBe(false);
  });

  it("vídeo vem como não suportado e documento traz o tamanho declarado", async () => {
    const canal = await montar();
    const recebidas: Array<Record<string, unknown>> = [];
    canal.aoMensagem((m) => recebidas.push(m as unknown as Record<string, unknown>));
    clienteAtual().emit("message_create", msg("v1", { type: "video" }));
    clienteAtual().emit("message_create", msg("d1", { type: "document", _data: { size: 50_000_000 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(recebidas[0]).toMatchObject({ id: "v1", tipo: "nao_suportada" });
    expect(recebidas[0].baixarMidia).toBeUndefined();
    expect(recebidas[1]).toMatchObject({ id: "d1", tipo: "midia", bytesDeclarados: 50_000_000 });
  });

  it("escuta só message_create; chat da própria vem de to, da recebida de from; @lid resolvido", async () => {
    const canal = await montar();
    const recebidas: unknown[] = [];
    canal.aoMensagem((m) => recebidas.push(m));
    const c = clienteAtual();
    expect(c.listenerCount("message")).toBe(0);
    expect(c.listenerCount("message_create")).toBe(1);
    c.emit("message_create", msg("recebida"));
    c.emit("message_create", msg("enviada", { fromMe: true, from: "5583900000000@c.us", to: `${TEL}@c.us` }));
    c.emit("message_create", msg("lid", { from: "123@lid" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(recebidas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "recebida", chatId: `${TEL}@c.us`, telefone: TEL, deMim: false }),
        expect.objectContaining({ id: "enviada", chatId: `${TEL}@c.us`, telefone: TEL, deMim: true }),
        expect.objectContaining({ id: "lid", telefone: TEL }),
      ])
    );
    controle.lidFalha = true;
    c.emit("message_create", msg("lid-falhou", { from: "999@lid" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(recebidas.at(-1)).toMatchObject({ telefone: null });
  });

  it("mensagem ainda cifrada no evento ao vivo é ignorada (volta decifrada)", async () => {
    const canal = await montar();
    const recebidas: unknown[] = [];
    canal.aoMensagem((m) => recebidas.push(m));
    clienteAtual().emit("message_create", msg("cifrada", { type: "ciphertext" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(recebidas).toEqual([]);
  });

  it("[F12] varredura recupera todas as 120 não lidas, pedindo só as do cliente", async () => {
    const canal = await montar();
    const mensagens = Array.from({ length: 120 }, (_, i) => msg(`m${i}`));
    const pedidos: unknown[] = [];
    controle.chats = [
      {
        id: { _serialized: `${TEL}@c.us` },
        isGroup: false,
        unreadCount: 120,
        fetchMessages: async (opcoes: { limit: number; fromMe?: boolean }) => {
          pedidos.push(opcoes);
          return mensagens.slice(-opcoes.limit);
        },
      },
    ];
    const pendentes = await canal.pendentes();
    expect(pendentes[0].mensagens).toHaveLength(120);
    expect(pedidos).toEqual([{ limit: 120, fromMe: false }]);
  });

  it("[F13] desconectado com UNPAIRED e getState indisponível: não relança nem gera QR", async () => {
    await montar();
    controle.estado = null;
    const antigo = clienteAtual();
    antigo.emit("disconnected", "UNPAIRED");
    await vi.advanceTimersByTimeAsync(6_000);
    expect(controle.clientes).toHaveLength(1);
    expect(antigo.destruido).toBe(true);
  });

  it("[F13b] desconectado com LOGOUT também é terminal", async () => {
    await montar();
    clienteAtual().emit("disconnected", "LOGOUT");
    await vi.advanceTimersByTimeAsync(6_000);
    expect(controle.clientes).toHaveLength(1);
  });

  it("queda comum (NAVIGATION) reconecta com cliente novo", async () => {
    await montar();
    controle.estado = null;
    clienteAtual().emit("disconnected", "NAVIGATION");
    await vi.advanceTimersByTimeAsync(6_000);
    expect(controle.clientes).toHaveLength(2);
  });

  it("[F15] digitando acaba em até 4s", async () => {
    const canal = await montar();
    await canal.digitando(`${TEL}@c.us`);
    await vi.advanceTimersByTimeAsync(4_001);
    expect(controle.digitando).toBe(false);
  });

  it("encerrar destrói o cliente e impede reconexão", async () => {
    const canal = await montar();
    const c = clienteAtual();
    await canal.encerrar();
    expect(c.destruido).toBe(true);
    controle.estado = null;
    c.emit("disconnected", "NAVIGATION");
    await vi.advanceTimersByTimeAsync(6_000);
    expect(controle.clientes).toHaveLength(1);
  });
});
