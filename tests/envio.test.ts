import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CHAVE_EU, Envio, LimitadorEnvios, RegistroSaida, tempoDigitando } from "../src/whatsapp/envio.js";
import { WhatsAppFalso } from "./helpers/whatsappFalso.js";

const CLIENTE = "5583999990000@c.us";

describe("envio", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("limitador deixa 20 por minuto e segura o 21º até a janela abrir", async () => {
    const limitador = new LimitadorEnvios(20);
    for (let i = 0; i < 20; i++) await limitador.aguardarVez();
    let liberado = false;
    const vez = limitador.aguardarVez().then(() => {
      liberado = true;
    });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(liberado).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await vez;
    expect(liberado).toBe(true);
  });

  it("registro de saída casa uma vez, por chave, e expira em 2 min", async () => {
    const r = new RegistroSaida();
    r.registrar("5583999990000", "olá ");
    expect(r.consumir("5583888880000", "olá")).toBe(false);
    expect(r.consumir("5583999990000", "olá")).toBe(true);
    expect(r.consumir("5583999990000", "olá")).toBe(false);
    r.registrar(CHAVE_EU, "aviso");
    await vi.advanceTimersByTimeAsync(120_001);
    expect(r.consumir(CHAVE_EU, "aviso")).toBe(false);
  });

  it("digitando é proporcional e para em 4s", () => {
    expect(tempoDigitando("oi")).toBe(850);
    expect(tempoDigitando("x".repeat(1_000))).toBe(4_000);
  });

  it("registra antes de enviar: o eco do próprio envio é reconhecido como nosso", async () => {
    const canal = new WhatsAppFalso();
    const envio = new Envio(canal, 20);
    const ecos: boolean[] = [];
    canal.aoMensagem((m) => ecos.push(envio.ehMinha(m.telefone!, m.texto)));
    const enviado = envio.paraCliente("5583999990000", CLIENTE, "Olá!");
    await vi.runAllTimersAsync();
    expect(await enviado).toBe(true);
    expect(canal.digitandoEm).toEqual([CLIENTE]);
    expect(ecos).toEqual([true]);
  });

  it("tenta de novo uma vez; duas falhas → false", async () => {
    const canal = new WhatsAppFalso();
    const envio = new Envio(canal, 20);
    canal.falhar.set("a", 1);
    canal.falhar.set("b", 2);
    const a = envio.paraCliente("5583999990000", CLIENTE, "a");
    await vi.runAllTimersAsync();
    expect(await a).toBe(true);
    const b = envio.paraCliente("5583999990000", CLIENTE, "b");
    await vi.runAllTimersAsync();
    expect(await b).toBe(false);
    expect(canal.enviadas.map((e) => e.texto)).toEqual(["a"]);
  });

  it("paraMim vai para o próprio número, sem digitando", async () => {
    const canal = new WhatsAppFalso();
    const envio = new Envio(canal, 20);
    expect(await envio.paraMim("resumo")).toBe(true);
    expect(canal.enviadas).toEqual([{ chatId: canal.eu, texto: "resumo" }]);
    expect(canal.digitandoEm).toEqual([]);
  });
});
