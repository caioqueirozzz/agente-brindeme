import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { criarLogPonte } from "../src/whatsapp/log.js";

describe("criarLogPonte", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("[#25] falhas que o dogfooding não viu aparecem no terminal", () => {
    const dir = mkdtempSync(join(tmpdir(), "log-ponte-"));
    dirs.push(dir);
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = criarLogPonte(dir);
    for (const type of ["midia_nao_baixou", "mensagem_nao_convertida", "reconexao_falhou"]) log({ type });
    log({ type: "lote_entregue" });
    expect(aviso.mock.calls.map(([linha]) => JSON.parse(String(linha)).type)).toEqual([
      "midia_nao_baixou",
      "mensagem_nao_convertida",
      "reconexao_falhou",
    ]);
  });
});
