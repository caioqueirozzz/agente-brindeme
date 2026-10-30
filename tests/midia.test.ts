import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { salvarMidia, TAMANHO_MAXIMO_BYTES } from "../src/whatsapp/midia.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]).toString("base64");

describe("salvarMidia", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "artes-"));
  });

  it("grava a arte em <dir>/<telefone>/<id>.<ext> com tipo e tamanho reais", () => {
    const r = salvarMidia(dir, "5583999990000", "false_5583@c.us_3EB0AB", { mime: "image/png", base64: PNG, nome: "logo.png" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arquivo.caminho).toBe(join(dir, "5583999990000", "false_5583_c_us_3EB0AB.png"));
    expect(r.arquivo.mime).toBe("image/png");
    expect(r.arquivo.nome).toBe("logo.png");
    expect(r.arquivo.bytes).toBe(Buffer.from(PNG, "base64").length);
    expect(readFileSync(r.arquivo.caminho).equals(Buffer.from(PNG, "base64"))).toBe(true);
  });

  it("aceita mime com parâmetros e dá nome quando a imagem não tem", () => {
    const r = salvarMidia(dir, "5583999990000", "abc12345", { mime: "image/jpeg; charset=binary", base64: JPG });
    expect(r.ok && r.arquivo.nome).toBe("arquivo-abc12345.jpg");
  });

  it("[F08] recusa arquivo cujo conteúdo não confere com o formato declarado", () => {
    const texto = Buffer.from("isto não é png").toString("base64");
    expect(salvarMidia(dir, "5583999990000", "f1", { mime: "image/png", base64: texto, nome: "logo.png" })).toEqual({
      ok: false,
      nome: "logo.png",
      motivo: "o conteúdo não é um PNG de verdade",
    });
    expect(salvarMidia(dir, "5583999990000", "f2", { mime: "image/jpeg", base64: PNG })).toMatchObject({ ok: false });
    expect(existsSync(join(dir, "5583999990000"))).toBe(false);
  });

  it("aceita PDF e SVG de verdade", () => {
    const pdf = Buffer.from("%PDF-1.7\n...").toString("base64");
    const svg = Buffer.from('﻿<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64");
    expect(salvarMidia(dir, "5583999990000", "p1", { mime: "application/pdf", base64: pdf }).ok).toBe(true);
    expect(salvarMidia(dir, "5583999990000", "s1", { mime: "image/svg+xml", base64: svg }).ok).toBe(true);
  });

  it("recusa formato fora da lista sem gravar nada", () => {
    const r = salvarMidia(dir, "5583999990000", "x1", { mime: "video/mp4", base64: PNG, nome: "video.mp4" });
    expect(r).toEqual({ ok: false, nome: "video.mp4", motivo: "formato video/mp4 não aceito (aceitos: PNG, JPG, SVG, PDF)" });
    expect(existsSync(join(dir, "5583999990000"))).toBe(false);
  });

  it("recusa arquivo vazio e arquivo grande demais", () => {
    expect(salvarMidia(dir, "5583999990000", "x2", { mime: "application/pdf", base64: "" })).toMatchObject({
      ok: false,
      motivo: "arquivo vazio",
    });
    const grande = Buffer.alloc(TAMANHO_MAXIMO_BYTES + 1).toString("base64");
    expect(salvarMidia(dir, "5583999990000", "x3", { mime: "application/pdf", base64: grande })).toMatchObject({
      ok: false,
      motivo: "arquivo maior que 16 MB",
    });
  });
});
