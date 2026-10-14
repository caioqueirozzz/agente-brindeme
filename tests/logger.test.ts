import { describe, it, expect } from "vitest";
import { mascararTexto } from "../src/logging/logger.js";

describe("log masking", () => {
  it("mascara CPF", () => {
    expect(mascararTexto("CPF: 123.456.789-00 do cliente")).toBe("CPF: ***.***.***-00 do cliente");
  });

  it("mascara email", () => {
    expect(mascararTexto("joao.silva@empresa.com.br")).toBe("j***@empresa.com.br");
  });

  it("mascara telefone com DDI", () => {
    expect(mascararTexto("5583999990000")).toBe("5583*****0000");
  });

  describe("telefone como o cliente digita", () => {
    const sensiveis = [
      "83999990000",
      "8333334444",
      "(83) 99999-0000",
      "(83)99999-0000",
      "83 99999-0000",
      "99999-0000",
      "3333-4444",
      "(83) 3333-4444",
      "+55 83 99999-0000",
    ];
    for (const t of sensiveis) {
      it(`mascara "${t}"`, () => {
        const saida = mascararTexto(`me liga no ${t} por favor`);
        expect(saida).not.toMatch(/9999|3333|8333/);
        expect(saida).toMatch(/^me liga no .*\*+.* por favor$/);
      });
    }

    it("mascara dentro de JSON, como o logger grava", () => {
      const saida = mascararTexto(JSON.stringify({ content: "meu zap 83999990000 e (83) 98888-7777" }));
      expect(saida).not.toMatch(/83999990000|98888-7777/);
      expect(() => JSON.parse(saida)).not.toThrow();
    });
  });

  it("não altera texto sem dados sensíveis", () => {
    const textos = [
      "Caneca branca, 50 unidades",
      "100 canecas por R$ 1.540,00",
      "preciso de 1000 a 2000 unidades",
      "pedido 2026-10-14 prazo 30 dias",
      "SKU 09319-PRE",
      "quantidade 12345",
    ];
    for (const t of textos) expect(mascararTexto(t)).toBe(t);
  });
});
