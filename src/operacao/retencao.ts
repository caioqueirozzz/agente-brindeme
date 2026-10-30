/**
 * Retenção de dados de cliente (issue #4, LGPD). O prazo é decisão da loja: o padrão de 90 dias
 * é só ponto de partida e vem de RETENCAO_DIAS. Nada é apagado sem `--executar`.
 *
 * Critério: idade = tempo desde a última gravação (mtime). A conversa é regravada a cada mensagem,
 * então mtime antigo = cliente parado. As artes de um telefone saem junto com a conversa dele
 * (ou quando não há conversa), e só se a arte mais nova também passou do prazo.
 *
 * Orçamentos TESTE, lacunas e o estado da ponte guardam vários clientes num arquivo só: saem os
 * registros, e o arquivo é regravado. Na ponte, só sai o telefone cuja conversa também está saindo:
 * um evento do atendente pendente ali ainda não chegou à conversa.
 */
import { existsSync, readdirSync, rmSync, statSync } from "fs";
import { basename, join } from "path";
import { phoneMatches } from "../agent/state.js";
import { gravarArquivoAtomico, lerArquivo } from "../util/arquivo.js";

export interface AlvoRetencao {
  tipo: "conversa" | "artes" | "log" | "registros";
  caminho: string;
  idadeDias: number;
  bytes: number;
  /** Só em "registros": quantos registros saem e como o arquivo fica. */
  registros?: number;
  conteudoNovo?: string;
}

export interface PastasRetencao {
  conversas: string;
  artes: string;
  logs: string;
  orcamentosTeste?: string;
  ponteEstado?: string;
  lacunas?: string;
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

  const telefonesQueSaem = alvos.filter((a) => a.tipo === "conversa").map((a) => basename(a.caminho, ".json"));
  const antigo = (data?: string) => Date.parse(data ?? "") < limite;
  alvos.push(
    ...[
      filtrarOrcamentosTeste(pastas.orcamentosTeste, (b) => antigo(b.created_at), agora),
      filtrarLacunas(pastas.lacunas, (l) => antigo(l.registrado_em), agora),
      filtrarPonte(pastas.ponteEstado, telefonesQueSaem),
    ].filter((a): a is AlvoRetencao => a !== null)
  );
  return alvos;
}

/** Tudo de um cliente que pediu para ser apagado (LGPD), mesmo com a conversa ativa. */
export function selecionarCliente(pastas: PastasRetencao, telefone: string, agora = Date.now()): AlvoRetencao[] {
  if (!/^\d{10,15}$/.test(telefone)) throw new Error("telefone só com dígitos, com DDI");
  const alvos: AlvoRetencao[] = [];
  let conversaId: string | undefined;

  const conversa = join(pastas.conversas, `${telefone}.json`);
  if (existsSync(conversa)) {
    const st = statSync(conversa);
    try {
      conversaId = JSON.parse(lerArquivo(conversa) ?? "{}")?.estado?.conversaId;
    } catch {
      // ilegível: a conversa sai mesmo assim; os logs dela ficam sem como ser achados
    }
    alvos.push({ tipo: "conversa", caminho: conversa, idadeDias: idadeDias(st.mtimeMs, agora), bytes: st.size });
  }

  const artes = join(pastas.artes, telefone);
  if (existsSync(artes)) {
    const { bytes, maisNovo } = tamanhoEMaisNovo(artes);
    alvos.push({ tipo: "artes", caminho: artes, idadeDias: idadeDias(maisNovo, agora), bytes });
  }

  const log = conversaId ? join(pastas.logs, `${conversaId}.jsonl`) : undefined;
  if (log && existsSync(log)) {
    const st = statSync(log);
    alvos.push({ tipo: "log", caminho: log, idadeDias: idadeDias(st.mtimeMs, agora), bytes: st.size });
  }

  alvos.push(
    ...[
      filtrarOrcamentosTeste(pastas.orcamentosTeste, (b) => phoneMatches(b.customer_phone ?? "", telefone), agora),
      filtrarLacunas(pastas.lacunas, (l) => conversaId !== undefined && l.conversa_id === conversaId, agora),
      filtrarPonte(pastas.ponteEstado, [telefone]),
    ].filter((a): a is AlvoRetencao => a !== null)
  );
  return alvos;
}

function alvoDeRegistros(caminho: string, original: string, conteudoNovo: string, registros: number, idade: number): AlvoRetencao | null {
  if (registros === 0) return null;
  const bytes = Buffer.byteLength(original) - Buffer.byteLength(conteudoNovo);
  return { tipo: "registros", caminho, idadeDias: idade, bytes, registros, conteudoNovo };
}

function filtrarOrcamentosTeste(
  caminho: string | undefined,
  sai: (b: { customer_phone?: string; created_at?: string }) => boolean,
  agora: number
): AlvoRetencao | null {
  const original = caminho ? lerArquivo(caminho) : null;
  if (!caminho || original === null) return null;
  const lista = JSON.parse(original) as Array<{ customer_phone?: string; created_at?: string }>;
  const saem = lista.filter(sai);
  const idade = Math.max(0, ...saem.map((b) => idadeDias(Date.parse(b.created_at ?? "") || agora, agora)));
  return alvoDeRegistros(caminho, original, JSON.stringify(lista.filter((b) => !sai(b))), saem.length, idade);
}

/** Linha ilegível fica: sem data nem conversa, não há como saber se passou do prazo. */
function filtrarLacunas(
  caminho: string | undefined,
  sai: (l: { conversa_id?: string; registrado_em?: string }) => boolean,
  agora: number
): AlvoRetencao | null {
  const original = caminho ? lerArquivo(caminho) : null;
  if (!caminho || original === null) return null;
  const ficam: string[] = [];
  const datas: number[] = [];
  for (const linha of original.split("\n").filter((l) => l.trim())) {
    let l: { conversa_id?: string; registrado_em?: string } | undefined;
    try {
      l = JSON.parse(linha);
    } catch {
      l = undefined;
    }
    if (l && sai(l)) datas.push(Date.parse(l.registrado_em ?? "") || agora);
    else ficam.push(linha);
  }
  const conteudoNovo = ficam.length ? `${ficam.join("\n")}\n` : "";
  const idade = Math.max(0, ...datas.map((d) => idadeDias(d, agora)));
  return alvoDeRegistros(caminho, original, conteudoNovo, datas.length, idade);
}

function filtrarPonte(caminho: string | undefined, telefones: string[]): AlvoRetencao | null {
  const original = caminho ? lerArquivo(caminho) : null;
  if (!caminho || original === null || telefones.length === 0) return null;
  const estado = JSON.parse(original) as {
    modos?: Record<string, unknown>;
    entregasParciais?: Record<string, unknown>;
    eventosPendentes?: Array<{ telefone?: string }>;
  };
  const sai = (tel: string) => telefones.some((t) => phoneMatches(tel, t));
  let registros = 0;
  for (const mapa of [estado.modos, estado.entregasParciais]) {
    for (const tel of Object.keys(mapa ?? {})) {
      if (sai(tel)) {
        delete mapa![tel];
        registros++;
      }
    }
  }
  const eventos = estado.eventosPendentes ?? [];
  estado.eventosPendentes = eventos.filter((e) => !sai(e.telefone ?? ""));
  registros += eventos.length - estado.eventosPendentes.length;
  return alvoDeRegistros(caminho, original, JSON.stringify(estado), registros, 0);
}

/** Apaga de vez. Só o script chama, e só com --executar. */
export function apagar(alvos: AlvoRetencao[]): number {
  let apagados = 0;
  for (const a of alvos) {
    if (a.tipo === "registros") gravarArquivoAtomico(a.caminho, a.conteudoNovo ?? "");
    else rmSync(a.caminho, { recursive: a.tipo === "artes", force: true });
    apagados++;
  }
  return apagados;
}
