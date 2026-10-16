import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ArquivoEstadoPonte, estadoVazio } from "../src/whatsapp/estadoPonte.js";

const TEL = "5583999990000";

describe("ArquivoEstadoPonte", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ponte-estado-"));
  });

  it("sem arquivo → estado vazio", () => {
    expect(new ArquivoEstadoPonte(join(dir, "ponte.json")).carregar()).toEqual(estadoVazio());
  });

  it("salva e relê, sem deixar .tmp", () => {
    const arquivo = join(dir, "ponte.json");
    const estado = {
      ...estadoVazio(),
      modos: { [TEL]: "humano" as const },
      avisosPendentes: ["resumo"],
      concluidos: ["m1", "m2"],
    };
    new ArquivoEstadoPonte(arquivo).salvar(estado);
    expect(new ArquivoEstadoPonte(arquivo).carregar()).toEqual(estado);
    expect(readdirSync(dir)).toEqual(["ponte.json"]);
  });

  it("estado gravado antes das entregas parciais carrega; entrada inválida é ignorada", () => {
    const arquivo = join(dir, "ponte.json");
    const { entregasParciais: _, ...antigo } = estadoVazio();
    writeFileSync(arquivo, JSON.stringify(antigo), "utf-8");
    expect(new ArquivoEstadoPonte(arquivo).carregar().entregasParciais).toEqual({});

    const valida = { ids: ["m1"], partes: ["parte 1"] };
    writeFileSync(arquivo, JSON.stringify({ ...antigo, entregasParciais: { [TEL]: valida, "5583000": { ids: "m1" } } }), "utf-8");
    expect(new ArquivoEstadoPonte(arquivo).carregar().entregasParciais).toEqual({ [TEL]: valida });
  });

  it("arquivo ilegível vira .corrompido-<data> e a ponte começa do zero, com alerta", () => {
    const arquivo = join(dir, "ponte.json");
    writeFileSync(arquivo, "{ quebrado", "utf-8");
    const alertas: Array<Record<string, unknown>> = [];
    expect(new ArquivoEstadoPonte(arquivo, (e) => alertas.push(e)).carregar()).toEqual(estadoVazio());
    expect(existsSync(arquivo)).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith("ponte.json.corrompido-"))).toBe(true);
    expect(alertas[0]).toMatchObject({ type: "alerta", motivo: "estado_da_ponte_corrompido" });
  });
});
