/**
 * Retenção de dados de cliente (issue #4, LGPD). O prazo é decisão da loja: o padrão de 90 dias
 * é só ponto de partida e vem de RETENCAO_DIAS. Nada é apagado sem `--executar`.
 *
 * Critério: idade = tempo desde a última gravação (mtime). A conversa é regravada a cada mensagem,
 * então mtime antigo = cliente parado. As artes de um telefone saem junto com a conversa dele
 * (ou quando não há conversa), e só se a arte mais nova também passou do prazo.
 */
import { existsSync, readdirSync, rmSync, statSync } from "fs";
import { basename, join } from "path";

export interface AlvoRetencao {
  tipo: "conversa" | "artes" | "log";
  caminho: string;
  idadeDias: number;
  bytes: number;
}

export interface PastasRetencao {
  conversas: string;
  artes: string;
  logs: string;
}

/** Logs que não são de conversa: ficam, mesmo antigos (api.jsonl só tem rota, status e duração). */
const LOGS_PRESERVADOS = new Set(["api.jsonl"]);

const DIA_MS = 86_400_000;

function idadeDias(mtimeMs: number, agora: number): number {
  return Math.floor((agora - mtimeMs) / DIA_MS);
}

/** Idade pelos arquivos de dentro; pasta vazia vale pela própria data. */
function tamanhoEMaisNovo(dir: string): { bytes: number; maisNovo: number } {
  let bytes = 0;
  let maisNovo = 0;
  for (const nome of readdirSync(dir)) {
    const st = statSync(join(dir, nome));
    if (st.isDirectory()) {
      const sub = tamanhoEMaisNovo(join(dir, nome));
      bytes += sub.bytes;
      maisNovo = Math.max(maisNovo, sub.maisNovo);
    } else {
      bytes += st.size;
      maisNovo = Math.max(maisNovo, st.mtimeMs);
    }
  }
  return { bytes, maisNovo: maisNovo || statSync(dir).mtimeMs };
}

export function selecionarParaLimpeza(pastas: PastasRetencao, dias: number, agora = Date.now()): AlvoRetencao[] {
  if (!Number.isFinite(dias) || dias < 1) throw new Error("prazo de retenção precisa ser de pelo menos 1 dia");
  const limite = agora - dias * DIA_MS;
  const alvos: AlvoRetencao[] = [];
  const conversasVivas = new Set<string>();

  if (existsSync(pastas.conversas)) {
    for (const nome of readdirSync(pastas.conversas)) {
      if (!/^\d{10,15}\.json$/.test(nome)) continue;
      const caminho = join(pastas.conversas, nome);
      const st = statSync(caminho);
      if (st.mtimeMs < limite) alvos.push({ tipo: "conversa", caminho, idadeDias: idadeDias(st.mtimeMs, agora), bytes: st.size });
      else conversasVivas.add(basename(nome, ".json"));
    }
  }

  if (existsSync(pastas.artes)) {
    for (const nome of readdirSync(pastas.artes)) {
      const caminho = join(pastas.artes, nome);
      if (!statSync(caminho).isDirectory() || conversasVivas.has(nome)) continue;
      const { bytes, maisNovo } = tamanhoEMaisNovo(caminho);
      if (maisNovo < limite) alvos.push({ tipo: "artes", caminho, idadeDias: idadeDias(maisNovo, agora), bytes });
    }
  }

  if (existsSync(pastas.logs)) {
    for (const nome of readdirSync(pastas.logs)) {
      if (!nome.endsWith(".jsonl") || LOGS_PRESERVADOS.has(nome)) continue;
      const caminho = join(pastas.logs, nome);
      const st = statSync(caminho);
      if (st.mtimeMs < limite) alvos.push({ tipo: "log", caminho, idadeDias: idadeDias(st.mtimeMs, agora), bytes: st.size });
    }
  }

  return alvos;
}

/** Apaga de vez. Só o script chama, e só com --executar. */
export function apagar(alvos: AlvoRetencao[]): number {
  let apagados = 0;
  for (const a of alvos) {
    rmSync(a.caminho, { recursive: a.tipo === "artes", force: true });
    apagados++;
  }
  return apagados;
}
