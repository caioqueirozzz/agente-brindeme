import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConjuntoLimitado, FilaConversas } from "../src/whatsapp/fila.js";
import type { MensagemLote } from "../src/contrato/esquemas.js";

const OPCOES = { silencioMs: 5_000, maxMs: 30_000, maxMensagens: 10 };
let seq = 0;
const msg = (texto: string): MensagemLote => ({ id: `id${++seq}`, timestamp: new Date().toISOString(), texto });

describe("FilaConversas", () => {
  let lotes: Array<{ telefone: string; textos: string[] }>;
  let processar: (telefone: string, chatId: string, m: MensagemLote[]) => Promise<void>;

  beforeEach(() => {
    vi.useFakeTimers();
    lotes = [];
    processar = async (telefone, _chatId, m) => {
      lotes.push({ telefone, textos: m.map((x) => x.texto) });
    };
  });
  afterEach(() => vi.useRealTimers());

  it("fecha o lote com 5s de silêncio desde a última mensagem", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    fila.adicionar("a", "a@c.us", msg("oi"));
    await vi.advanceTimersByTimeAsync(3_000);
    fila.adicionar("a", "a@c.us", msg("tudo bem?"));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(lotes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(lotes).toEqual([{ telefone: "a", textos: ["oi", "tudo bem?"] }]);
  });

  it("fecha em 30s desde a primeira mesmo sem silêncio", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    for (let i = 0; i < 8; i++) {
      fila.adicionar("a", "a@c.us", msg(`m${i}`));
      await vi.advanceTimersByTimeAsync(4_000);
    }
    expect(lotes).toHaveLength(1);
    expect(lotes[0].textos).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
  });

  it("fecha na hora com 10 mensagens", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    for (let i = 0; i < 11; i++) fila.adicionar("a", "a@c.us", msg(`m${i}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes).toHaveLength(1);
    expect(lotes[0].textos).toHaveLength(10);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lotes[1].textos).toEqual(["m10"]);
  });

  it("com turno rodando só acumula; o acumulado vira o próximo lote", async () => {
    let liberar!: () => void;
    const fila = new FilaConversas(OPCOES, async (telefone, chatId, m) => {
      await processar(telefone, chatId, m);
      if (lotes.length === 1) await new Promise<void>((r) => (liberar = r));
    });
    fila.adicionar("a", "a@c.us", msg("primeira"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fila.ocupada("a")).toBe(true);
    fila.adicionar("a", "a@c.us", msg("segunda"));
    expect(fila.temNoBuffer("a")).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(lotes).toHaveLength(1);
    liberar();
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes[1].textos).toEqual(["segunda"]);
  });

  it("id repetido não entra; depois de esquecer, entra de novo", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    const m = msg("oi");
    expect(fila.adicionar("a", "a@c.us", m)).toBe(true);
    expect(fila.adicionar("a", "a@c.us", m)).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    fila.esquecer([m.id]);
    expect(fila.adicionar("a", "a@c.us", m)).toBe(true);
  });

  it("conversas diferentes não se misturam", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    fila.adicionar("a", "a@c.us", msg("de a"));
    fila.adicionar("b", "b@c.us", msg("de b"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lotes).toEqual([
      { telefone: "a", textos: ["de a"] },
      { telefone: "b", textos: ["de b"] },
    ]);
  });

  it("mídia reservada segura o lote e mantém a ordem de chegada", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    expect(fila.reservar("a", "a@c.us", "img1")).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    fila.adicionar("a", "a@c.us", msg("essa é a logo"));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(lotes).toEqual([]);
    expect(fila.temNoBuffer("a")).toBe(true);
    fila.preencher("a", "img1", { id: "img1", timestamp: new Date().toISOString(), texto: "[imagem]" });
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes).toEqual([{ telefone: "a", textos: ["[imagem]", "essa é a logo"] }]);
  });

  it("reserva repetida é recusada, como id repetido", () => {
    const fila = new FilaConversas(OPCOES, processar);
    expect(fila.reservar("a", "a@c.us", "img1")).toBe(true);
    expect(fila.reservar("a", "a@c.us", "img1")).toBe(false);
    expect(fila.adicionar("a", "a@c.us", { id: "img1", timestamp: new Date().toISOString(), texto: "x" })).toBe(false);
  });

  it("cancelar a reserva libera o lote do que veio depois", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    fila.reservar("a", "a@c.us", "img1");
    fila.adicionar("a", "a@c.us", msg("depois"));
    fila.cancelar("a", "img1");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lotes).toEqual([{ telefone: "a", textos: ["depois"] }]);
  });

  it("erro no processamento libera os ids para a varredura", async () => {
    const m = msg("oi");
    const fila = new FilaConversas(OPCOES, async () => {
      throw new Error("quebrou");
    });
    fila.adicionar("a", "a@c.us", m);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fila.ocupada("a")).toBe(false);
    expect(fila.adicionar("a", "a@c.us", m)).toBe(true);
  });
});

describe("ConjuntoLimitado", () => {
  it("descarta o mais antigo acima do limite", () => {
    const c = new ConjuntoLimitado(2);
    c.add("a");
    c.add("b");
    c.add("c");
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
    expect(c.has("c")).toBe(true);
  });
});
