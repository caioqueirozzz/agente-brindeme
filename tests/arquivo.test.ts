import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gravarArquivoAtomico, separarCorrompido } from "../src/util/arquivo.js";

describe("gravação de arquivo de estado", () => {
  it("grava pelo temporário e não deixa .tmp", () => {
    const dir = mkdtempSync(join(tmpdir(), "arquivo-"));
    const alvo = join(dir, "sub", "estado.json");
    gravarArquivoAtomico(alvo, '{"a":1}');
    gravarArquivoAtomico(alvo, '{"a":2}');
    expect(readFileSync(alvo, "utf-8")).toBe('{"a":2}');
    expect(readdirSync(join(dir, "sub"))).toEqual(["estado.json"]);
  });

  it("separar um arquivo que não dá para renomear não lança (o próximo salvar sobrescreve)", () => {
    const dir = mkdtempSync(join(tmpdir(), "arquivo-"));
    expect(separarCorrompido(join(dir, "nao-existe.json"))).toBeNull();
  });
});
