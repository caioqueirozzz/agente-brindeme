import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { describe, it, expect, beforeEach } from "vitest";
import {
  escreverEstadoSistema,
  invalidarCache,
  lerEstadoSistema,
} from "../src/controle/estadoSistema.js";

function tmpArquivo(): string {
  return join(mkdtempSync(join(tmpdir(), "estado-")), "estado.json");
}

describe("lerEstadoSistema", () => {
  beforeEach(() => invalidarCache());

  it("arquivo inexistente → não suspenso", () => {
    const arq = tmpArquivo();
    expect(lerEstadoSistema(arq)).toEqual({ suspenso: false });
    expect(existsSync(arq)).toBe(false);
  });

  it("arquivo com JSON inválido → não suspenso (nunca lança)", () => {
    const arq = tmpArquivo();
    writeFileSync(arq, "{ quebrado", "utf-8");
    expect(lerEstadoSistema(arq)).toEqual({ suspenso: false });
  });

  it("arquivo com formato inválido (sem suspenso boolean) → não suspenso", () => {
    const arq = tmpArquivo();
    writeFileSync(arq, JSON.stringify({ suspenso: "sim" }), "utf-8");
    expect(lerEstadoSistema(arq)).toEqual({ suspenso: false });
  });

  it("lê o estado corretamente do disco", () => {
    const arq = tmpArquivo();
    escreverEstadoSistema(
      { suspenso: true, suspensoPor: "manutencao", suspensoEm: "2026-10-17T10:00:00.000Z" },
      arq
    );
    invalidarCache();
    const e = lerEstadoSistema(arq);
    expect(e.suspenso).toBe(true);
    expect(e.suspensoPor).toBe("manutencao");
  });

  it("lê ferramentasDesligadas do disco", () => {
    const arq = tmpArquivo();
    escreverEstadoSistema({ suspenso: false, ferramentasDesligadas: ["preparar_orcamento"] }, arq);
    invalidarCache();
    expect(lerEstadoSistema(arq).ferramentasDesligadas).toEqual(["preparar_orcamento"]);
  });

  it("cache: segunda leitura não vai ao disco", () => {
    const arq = tmpArquivo();
    escreverEstadoSistema({ suspenso: true }, arq);
    lerEstadoSistema(arq); // popula cache
    // Escreve um estado diferente no disco sem invalidar o cache
    writeFileSync(arq, JSON.stringify({ suspenso: false }), "utf-8");
    expect(lerEstadoSistema(arq).suspenso).toBe(true); // ainda do cache
  });

  it("invalidarCache força releitura do disco", () => {
    const arq = tmpArquivo();
    escreverEstadoSistema({ suspenso: true }, arq);
    lerEstadoSistema(arq);
    escreverEstadoSistema({ suspenso: false }, arq);
    invalidarCache();
    expect(lerEstadoSistema(arq).suspenso).toBe(false);
  });
});

describe("escreverEstadoSistema", () => {
  beforeEach(() => invalidarCache());

  it("persiste o estado e atualiza o cache", () => {
    const arq = tmpArquivo();
    escreverEstadoSistema({ suspenso: true, suspensoPor: "teste" }, arq);
    expect(existsSync(arq)).toBe(true);
    // Leitura usa o cache atualizado pelo próprio escrever
    expect(lerEstadoSistema(arq).suspenso).toBe(true);
  });

  it("cria a pasta pai se não existir", () => {
    const base = mkdtempSync(join(tmpdir(), "estado-base-"));
    const arq = join(base, "subpasta", "estado.json");
    escreverEstadoSistema({ suspenso: false }, arq);
    expect(existsSync(arq)).toBe(true);
  });
});

describe("[Fase 6] ESTADO_SISTEMA_ARQUIVO", () => {
  it("o caminho do .env é respeitado (antes era ignorado)", async () => {
    const { arquivoEstadoSistema } = await import("../src/controle/estadoSistema.js");
    const antes = process.env.ESTADO_SISTEMA_ARQUIVO;
    try {
      process.env.ESTADO_SISTEMA_ARQUIVO = "outro/estado.json";
      expect(arquivoEstadoSistema().split("\\").join("/")).toMatch(/outro\/estado\.json$/);
      delete process.env.ESTADO_SISTEMA_ARQUIVO;
      expect(arquivoEstadoSistema().split("\\").join("/")).toMatch(/data\/estado-sistema\.json$/);
    } finally {
      if (antes === undefined) delete process.env.ESTADO_SISTEMA_ARQUIVO;
      else process.env.ESTADO_SISTEMA_ARQUIVO = antes;
    }
  });
});
