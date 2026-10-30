import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";

const TENTATIVAS = 3;
const PAUSA_MS = 50;

function pausar(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** No Windows, antivírus e indexador seguram o arquivo por instantes: rename e leitura falham com EBUSY/EPERM. */
export function gravarArquivoAtomico(arquivo: string, conteudo: string): void {
  mkdirSync(dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.tmp`;
  writeFileSync(tmp, conteudo, "utf-8");
  for (let i = 0; i < TENTATIVAS; i++) {
    try {
      renameSync(tmp, arquivo);
      return;
    } catch {
      pausar(PAUSA_MS);
    }
  }
  writeFileSync(arquivo, conteudo, "utf-8");
  try {
    unlinkSync(tmp);
  } catch {
    // fica para a próxima gravação sobrescrever
  }
}

/** null se o arquivo não existe. Erro de leitura que persiste é lançado: nunca vira "arquivo corrompido". */
export function lerArquivo(arquivo: string): string | null {
  for (let i = 0; ; i++) {
    try {
      return readFileSync(arquivo, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (i >= TENTATIVAS - 1) throw err;
      pausar(PAUSA_MS);
    }
  }
}

/** Renomeia para .corrompido-<data>. null se nem isso deu (a próxima gravação sobrescreve o arquivo). */
export function separarCorrompido(arquivo: string): string | null {
  const destino = `${arquivo}.corrompido-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    renameSync(arquivo, destino);
    return destino;
  } catch {
    return null;
  }
}
