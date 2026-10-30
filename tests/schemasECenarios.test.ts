import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tools } from "../src/tools/index.js";

/**
 * Dois bugs que a suíte não pegava e que travavam o agente inteiro na OpenAI.
 * Ambos passaram por 620 testes verdes, porque nenhum deles olhava para estes
 * dois artefatos: o schema que vai ao provedor e os arquivos de cenário.
 */

describe("schema das ferramentas — compatível com a OpenAI", () => {
  it("nenhum schema usa a forma booleana de exclusiveMinimum/Maximum", () => {
    // O alvo openApi3 do zod-to-json-schema emitia `exclusiveMinimum: true`,
    // e a OpenAI responde 400: "True is not of type 'number'".
    const ofensores: string[] = [];
    for (const t of tools) {
      const json = JSON.stringify(t.inputSchema);
      for (const m of json.matchAll(/"(exclusiveMinimum|exclusiveMaximum)":(true|false)/g)) {
        ofensores.push(`${t.name}: ${m[0]}`);
      }
    }
    expect(ofensores).toEqual([]);
  });

  it("limites numéricos são números, não booleanos", () => {
    const percorrer = (no: unknown): void => {
      if (!no || typeof no !== "object") return;
      for (const [chave, valor] of Object.entries(no as Record<string, unknown>)) {
        if (
          (chave === "exclusiveMinimum" || chave === "exclusiveMaximum" ||
            chave === "minimum" || chave === "maximum") &&
          valor !== undefined
        ) {
          expect(typeof valor, `${chave} deve ser número`).toBe("number");
        }
        percorrer(valor);
      }
    };
    for (const t of tools) percorrer(t.inputSchema);
  });

  it("toda ferramenta tem schema de objeto com propriedades", () => {
    for (const t of tools) {
      const s = t.inputSchema as { type?: string; properties?: object };
      expect(s.type, `${t.name} sem type`).toBe("object");
      expect(s.properties, `${t.name} sem properties`).toBeTruthy();
    }
  });

  it("não vaza $schema para o provedor", () => {
    // Metadado do documento, não do parâmetro.
    for (const t of tools) {
      expect(Object.keys(t.inputSchema)).not.toContain("$schema");
    }
  });
});

describe("arquivos de cenário dos evals", () => {
  const dir = join(process.cwd(), "evals/scenarios");
  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

  it("existem cenários", () => {
    expect(arquivos.length).toBeGreaterThan(0);
  });

  // Um cenário com JSON inválido derrubava a rodada inteira, inclusive os
  // cenários corretos — o JSON.parse do laço em runEvals.ts não tem try.
  it.each(arquivos)("%s é JSON válido", (arquivo) => {
    const bruto = readFileSync(join(dir, arquivo), "utf-8");
    expect(() => JSON.parse(bruto)).not.toThrow();
  });

  it.each(arquivos)("%s tem id, mensagens e expectativas", (arquivo) => {
    const c = JSON.parse(readFileSync(join(dir, arquivo), "utf-8")) as {
      id?: string;
      mensagens?: unknown[];
      expectativas?: unknown[];
    };
    expect(c.id, "sem id").toBeTruthy();
    expect(Array.isArray(c.mensagens) && c.mensagens.length > 0).toBe(true);
    expect(Array.isArray(c.expectativas) && c.expectativas.length > 0).toBe(true);
  });

  it("todo padrão de expectativa compila como regex", () => {
    for (const arquivo of arquivos) {
      const c = JSON.parse(readFileSync(join(dir, arquivo), "utf-8")) as {
        expectativas: Array<{ padrao?: string }>;
      };
      for (const e of c.expectativas) {
        if (e.padrao) {
          expect(() => new RegExp(e.padrao!, "i"), `${arquivo}: ${e.padrao}`).not.toThrow();
        }
      }
    }
  });
});
