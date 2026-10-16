import { describe, it, expect } from "vitest";
import { eventoSchema, pedidoMensagensSchema, LIMITE_TEXTO } from "../src/contrato/esquemas.js";
import { calcularTurnoId } from "../src/contrato/turno.js";
import { formatarParaWhatsApp, loteParaTexto, MAX_PARTES } from "../src/contrato/texto.js";

const T = "2026-10-14T12:00:00.000Z";

describe("esquemas do contrato", () => {
  const valido = {
    turnoId: "0123456789abcdef",
    telefone: "5583999990000",
    mensagens: [{ id: "a", timestamp: T, texto: "oi" }],
  };

  it("aceita um pedido válido", () => {
    expect(pedidoMensagensSchema.parse(valido)).toEqual(valido);
  });

  it("recusa telefone com símbolos", () => {
    expect(() => pedidoMensagensSchema.parse({ ...valido, telefone: "+55 83 99999-0000" })).toThrow();
  });

  it("recusa lote vazio e lote com mais de 10 mensagens", () => {
    expect(() => pedidoMensagensSchema.parse({ ...valido, mensagens: [] })).toThrow();
    const onze = Array.from({ length: 11 }, (_, i) => ({ id: `m${i}`, timestamp: T, texto: "x" }));
    expect(() => pedidoMensagensSchema.parse({ ...valido, mensagens: onze })).toThrow();
  });

  it("recusa texto acima do limite", () => {
    const longo = [{ id: "a", timestamp: T, texto: "x".repeat(LIMITE_TEXTO + 1) }];
    expect(() => pedidoMensagensSchema.parse({ ...valido, mensagens: longo })).toThrow();
  });

  it("recusa turnoId fora do formato", () => {
    expect(() => pedidoMensagensSchema.parse({ ...valido, turnoId: "abc" })).toThrow();
  });

  it("aceita os dois eventos e recusa tipo desconhecido", () => {
    expect(eventoSchema.parse({ tipo: "devolver", telefone: "5583999990000" })).toEqual({
      tipo: "devolver",
      telefone: "5583999990000",
    });
    const atendente = { tipo: "mensagem_atendente", telefone: "5583999990000", id: "x", texto: "oi", timestamp: T };
    expect(eventoSchema.parse(atendente).tipo).toBe("mensagem_atendente");
    expect(() => eventoSchema.parse({ tipo: "apagar", telefone: "5583999990000" })).toThrow();
  });
});

describe("calcularTurnoId", () => {
  it("é determinístico e tem 16 caracteres hex", () => {
    const id = calcularTurnoId(["a", "b"]);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(calcularTurnoId(["a", "b"])).toBe(id);
  });

  it("muda com a ordem e com os ids", () => {
    expect(calcularTurnoId(["b", "a"])).not.toBe(calcularTurnoId(["a", "b"]));
    expect(calcularTurnoId(["a"])).not.toBe(calcularTurnoId(["a", "b"]));
  });
});

describe("loteParaTexto", () => {
  it("junta as mensagens uma por linha", () => {
    const lote = [
      { id: "1", timestamp: T, texto: "oi" },
      { id: "2", timestamp: T, texto: " quero canecas " },
    ];
    expect(loteParaTexto(lote)).toBe("oi\nquero canecas");
  });

  it("descreve o arquivo antes da legenda", () => {
    const arquivo = { caminho: "data/artes/x.png", mime: "image/png", bytes: 2_048, nome: "logo.png" };
    expect(loteParaTexto([{ id: "1", timestamp: T, texto: "essa é a logo", arquivo }])).toBe(
      "[ARQUIVO recebido: logo.png (image/png, 2 KB)]\nessa é a logo"
    );
  });

  it("arquivo pequeno aparece com 1 KB", () => {
    const arquivo = { caminho: "x.pdf", mime: "application/pdf", bytes: 100, nome: "arte.pdf" };
    expect(loteParaTexto([{ id: "1", timestamp: T, texto: "", arquivo }])).toBe(
      "[ARQUIVO recebido: arte.pdf (application/pdf, 1 KB)]"
    );
  });
});

describe("formatarParaWhatsApp", () => {
  it("troca o negrito do markdown pelo do WhatsApp", () => {
    expect(formatarParaWhatsApp("Total: **R$ 10,00**")).toEqual(["Total: *R$ 10,00*"]);
  });

  it("título vira negrito, sem asterisco dobrado", () => {
    expect(formatarParaWhatsApp("## Resumo\nItem 1")).toEqual(["*Resumo*\nItem 1"]);
    expect(formatarParaWhatsApp("### **Resumo**")).toEqual(["*Resumo*"]);
  });

  it("quebra nos parágrafos", () => {
    expect(formatarParaWhatsApp("a\n\nb\n  \nc")).toEqual(["a", "b", "c"]);
  });

  it(`junta o excedente na última das ${MAX_PARTES} partes`, () => {
    expect(formatarParaWhatsApp("a\n\nb\n\nc\n\nd\n\ne\n\nf")).toEqual(["a", "b", "c", "d\n\ne\n\nf"]);
  });

  it("texto vazio não gera parte", () => {
    expect(formatarParaWhatsApp("  ")).toEqual([]);
  });
});
