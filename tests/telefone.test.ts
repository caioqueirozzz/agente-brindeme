import { describe, it, expect } from "vitest";
import { ehConversaDireta, normalizarTelefone } from "../src/whatsapp/telefone.js";

describe("normalizarTelefone", () => {
  it("mantém o número completo", () => {
    expect(normalizarTelefone("5583999990000")).toBe("5583999990000");
  });

  it("acrescenta o 9 no celular brasileiro que veio sem ele", () => {
    expect(normalizarTelefone("558399990000")).toBe("5583999990000");
  });

  it("não mexe em fixo brasileiro", () => {
    expect(normalizarTelefone("558333334444")).toBe("558333334444");
  });

  it("tira formatação", () => {
    expect(normalizarTelefone("+55 (83) 99999-0000")).toBe("5583999990000");
  });

  it("não mexe em número de outro país", () => {
    expect(normalizarTelefone("12025550108")).toBe("12025550108");
  });
});

describe("ehConversaDireta", () => {
  it("aceita @c.us e @lid", () => {
    expect(ehConversaDireta("5583999990000@c.us")).toBe(true);
    expect(ehConversaDireta("123456789012345@lid")).toBe(true);
  });

  it("recusa grupo, status, canal e lista de transmissão", () => {
    expect(ehConversaDireta("1203630@g.us")).toBe(false);
    expect(ehConversaDireta("status@broadcast")).toBe(false);
    expect(ehConversaDireta("1203630@newsletter")).toBe(false);
    expect(ehConversaDireta("1203630@broadcast")).toBe(false);
  });

  it("recusa mensagem com autor (é de grupo)", () => {
    expect(ehConversaDireta("5583999990000@c.us", "5583888880000@c.us")).toBe(false);
  });
});
