import { describe, it, expect } from "vitest";

// Test masking logic inline (extracted from logger internals)
function maskCpf(s: string) {
  return s.replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, (m) => `***.***.***-${m.slice(-2)}`);
}
function maskEmail(s: string) {
  return s.replace(/([a-zA-Z0-9._%+-]{1})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+)/g, "$1***@$2");
}
function maskPhone(s: string) {
  return s.replace(/(\d{4})\d{5,7}(\d{4})/g, "$1*****$2");
}

describe("log masking", () => {
  it("mascara CPF", () => {
    expect(maskCpf("CPF: 123.456.789-00 do cliente")).toBe("CPF: ***.***.***-00 do cliente");
  });

  it("mascara email", () => {
    expect(maskEmail("joao.silva@empresa.com.br")).toBe("j***@empresa.com.br");
  });

  it("mascara telefone", () => {
    expect(maskPhone("5583999990000")).toBe("5583*****0000");
  });

  it("não altera texto sem dados sensíveis", () => {
    const text = "Caneca branca, 50 unidades";
    expect(maskCpf(maskEmail(maskPhone(text)))).toBe(text);
  });
});
