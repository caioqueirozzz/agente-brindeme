import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { Arquivo } from "../contrato/esquemas.js";
import type { MidiaBaixada } from "./canal.js";

export const EXTENSOES_POR_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

export const TAMANHO_MAXIMO_BYTES = 16 * 1024 * 1024;

const NOME_DO_FORMATO: Record<string, string> = { png: "PNG", jpg: "JPG", svg: "SVG", pdf: "PDF" };

function comeca(dados: Buffer, bytes: number[]): boolean {
  return bytes.every((b, i) => dados[i] === b);
}

/** Confere a assinatura dos bytes: o tipo declarado vem de quem mandou o arquivo. */
function conteudoConfere(ext: string, dados: Buffer): boolean {
  switch (ext) {
    case "png":
      return comeca(dados, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
      return comeca(dados, [0xff, 0xd8, 0xff]);
    case "pdf":
      return dados.subarray(0, 1024).includes("%PDF-");
    case "svg":
      return /<svg[\s>]/i.test(dados.subarray(0, 4096).toString("utf-8"));
    default:
      return false;
  }
}

export type ResultadoMidia = { ok: true; arquivo: Arquivo } | { ok: false; nome: string; motivo: string };

export function salvarMidia(dirBase: string, telefone: string, id: string, midia: MidiaBaixada): ResultadoMidia {
  const mime = midia.mime.split(";")[0].trim().toLowerCase();
  const ext = EXTENSOES_POR_MIME[mime];
  const idSeguro = id.replace(/[^A-Za-z0-9_-]/g, "_").slice(-60);
  const nome = midia.nome?.trim() || `arquivo-${idSeguro.slice(-8)}${ext ? `.${ext}` : ""}`;
  if (!ext) return { ok: false, nome, motivo: `formato ${mime} não aceito (aceitos: PNG, JPG, SVG, PDF)` };

  const dados = Buffer.from(midia.base64, "base64");
  if (dados.length === 0) return { ok: false, nome, motivo: "arquivo vazio" };
  if (dados.length > TAMANHO_MAXIMO_BYTES) return { ok: false, nome, motivo: "arquivo maior que 16 MB" };
  if (!conteudoConfere(ext, dados)) return { ok: false, nome, motivo: `o conteúdo não é um ${NOME_DO_FORMATO[ext]} de verdade` };

  const dir = resolve(dirBase, telefone);
  mkdirSync(dir, { recursive: true });
  const caminho = join(dir, `${idSeguro}.${ext}`);
  writeFileSync(caminho, dados);
  return { ok: true, arquivo: { caminho, mime, bytes: dados.length, nome } };
}
