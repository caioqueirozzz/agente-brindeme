import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MAX_IDS_VISTOS, MAX_TURNOS_GUARDADOS, RepositorioConversas, novaConversa } from "../src/conversas/repositorio.js";

const TEL = "5583999990000";

describe("RepositorioConversas", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "conversas-"));
  });

  it("telefone sem arquivo → conversa nova em modo ia", () => {
    const c = new RepositorioConversas(dir).carregar(TEL);
    expect(c.estado.telefone).toBe(TEL);
    expect(c.estado.modo).toBe("ia");
    expect(c.turnos).toEqual([]);
    expect(c.idsVistos).toEqual([]);
  });

  it("salva e relê depois de reiniciar, sem deixar .tmp", () => {
    const repo = new RepositorioConversas(dir);
    const c = repo.carregar(TEL);
    c.estado.modo = "humano";
    c.idsVistos.push("m1");
    repo.salvar(c);
    const relida = new RepositorioConversas(dir).carregar(TEL);
    expect(relida.estado.modo).toBe("humano");
    expect(relida.idsVistos).toEqual(["m1"]);
    expect(readdirSync(dir)).toEqual([`${TEL}.json`]);
  });

  it("as últimas opções apresentadas sobrevivem ao reinício", () => {
    const repo = new RepositorioConversas(dir);
    const c = repo.carregar(TEL);
    c.estado.ultimasOpcoes = [{ id: "caneca", nome: "Caneca de Porcelana" }];
    repo.salvar(c);
    expect(new RepositorioConversas(dir).carregar(TEL).estado.ultimasOpcoes).toEqual([
      { id: "caneca", nome: "Caneca de Porcelana" },
    ]);
  });

  it("arquivo ilegível vira .corrompido-<data>, a conversa recomeça e sai um alerta", () => {
    writeFileSync(join(dir, `${TEL}.json`), "{ quebrado", "utf-8");
    const alertas: Array<Record<string, unknown>> = [];
    const c = new RepositorioConversas(dir, (e) => alertas.push(e)).carregar(TEL);
    expect(c.estado.historico).toEqual([]);
    expect(existsSync(join(dir, `${TEL}.json`))).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith(`${TEL}.json.corrompido-`))).toBe(true);
    expect(alertas[0]).toMatchObject({ type: "alerta", motivo: "estado_corrompido" });
  });

  it("arquivo de outro telefone ou de outro formato também conta como corrompido", () => {
    writeFileSync(join(dir, `${TEL}.json`), JSON.stringify(novaConversa("5583111110000")), "utf-8");
    expect(new RepositorioConversas(dir).carregar(TEL).estado.telefone).toBe(TEL);
    writeFileSync(join(dir, `${TEL}.json`), JSON.stringify({ versao: 0 }), "utf-8");
    expect(new RepositorioConversas(dir).carregar(TEL).estado.telefone).toBe(TEL);
  });

  it("guarda só os últimos turnos e ids", () => {
    const repo = new RepositorioConversas(dir);
    const c = repo.carregar(TEL);
    for (let i = 0; i < MAX_TURNOS_GUARDADOS + 5; i++) {
      c.turnos.push({ turnoId: `t${i}`, resposta: { respostas: [], modo: "ia" } });
    }
    for (let i = 0; i < MAX_IDS_VISTOS + 5; i++) c.idsVistos.push(`m${i}`);
    repo.salvar(c);
    const relida = repo.carregar(TEL);
    expect(relida.turnos).toHaveLength(MAX_TURNOS_GUARDADOS);
    expect(relida.turnos[0].turnoId).toBe("t5");
    expect(relida.idsVistos).toHaveLength(MAX_IDS_VISTOS);
  });

  it("existe só depois de salvar", () => {
    const repo = new RepositorioConversas(dir);
    expect(repo.existe(TEL)).toBe(false);
    repo.salvar(repo.carregar(TEL));
    expect(repo.existe(TEL)).toBe(true);
  });

  it("histórico, arquivos recebidos e falhas guardados têm teto", () => {
    const repo = new RepositorioConversas(dir);
    const c = repo.carregar(TEL);
    for (let i = 0; i < 250; i++) c.estado.historico.push({ role: "user", content: `m${i}`, timestamp: "2026-10-14T12:00:00.000Z" });
    c.estado.arquivosRecebidos = Array.from({ length: 60 }, (_, i) => ({ nome: `a${i}.png`, caminho: `c${i}`, mime: "image/png", bytes: 1 }));
    for (let i = 0; i < 60; i++) c.falhasPorTurno[`t${i}`] = 1;
    repo.salvar(c);
    const relida = repo.carregar(TEL);
    expect(relida.estado.historico).toHaveLength(200);
    expect(relida.estado.historico.at(-1)?.content).toBe("m249");
    expect(relida.estado.arquivosRecebidos).toHaveLength(50);
    expect(Object.keys(relida.falhasPorTurno)).toHaveLength(50);
  });

  it("turno guardado no formato antigo (sem ids) continua válido", () => {
    const repo = new RepositorioConversas(dir);
    const c = repo.carregar(TEL);
    c.turnos.push({ turnoId: "0123456789abcdef", resposta: { respostas: ["x"], modo: "ia" } });
    repo.salvar(c);
    expect(new RepositorioConversas(dir).carregar(TEL).turnos).toHaveLength(1);
  });

  it("telefone fora do formato nunca vira nome de arquivo", () => {
    expect(() => new RepositorioConversas(dir).carregar("../segredo")).toThrow();
  });
});
