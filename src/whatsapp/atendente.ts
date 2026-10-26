import { LIMITE_TEXTO, type Evento, type Modo } from "../contrato/esquemas.js";
import {
  escreverEstadoSistema,
  lerEstadoSistema,
  type EstadoSistema,
} from "../controle/estadoSistema.js";
import { NOMES_FERRAMENTAS, ehFerramenta } from "../tools/nomes.js";
import type { ClienteAgente } from "./agenteHttp.js";
import type { MensagemRecebida } from "./canal.js";
import { CHAVE_EU, type Envio } from "./envio.js";
import type { LogPonte } from "./log.js";
import { normalizarTelefone } from "./telefone.js";

export type Comando =
  | { tipo: "devolver"; telefone: string; nota?: string }
  | { tipo: "suspender"; motivo?: string }
  | { tipo: "retomar" }
  | { tipo: "desligar"; ferramenta: string }
  | { tipo: "religar"; ferramenta: string }
  | { tipo: "status" }
  | { tipo: "desconhecido" };

export const TEXTO_COMANDOS = [
  "Comandos do agente:",
  "#devolver <telefone com DDI, sem espaços> [nota] — devolve a conversa à IA",
  "Exemplo: #devolver 5583999990000 cliente já recebeu o boleto",
  "#suspender [motivo] — pausa o agente para todos os clientes",
  "#retomar — retoma o agente",
  "#desligar <ferramenta> — desliga uma ferramenta (ex: #desligar preparar_orcamento)",
  "#religar <ferramenta> — religa uma ferramenta",
  "#status — mostra se o agente está suspenso e quais ferramentas estão desligadas",
  `Ferramentas: ${NOMES_FERRAMENTAS.join(", ")}`,
].join("\n");

export function interpretarComando(texto: string): Comando | null {
  const t = texto.trim();
  if (!t.startsWith("#")) return null;

  const mDev = /^#devolver\s+(\S+)(?:\s+([\s\S]+))?$/i.exec(t);
  if (mDev) {
    const telefone = normalizarTelefone(mDev[1]);
    if (!/^[1-9]\d{11,14}$/.test(telefone)) return { tipo: "desconhecido" };
    const nota = mDev[2]?.trim().slice(0, 500);
    return nota ? { tipo: "devolver", telefone, nota } : { tipo: "devolver", telefone };
  }

  const mSusp = /^#suspender(?:\s+([\s\S]+))?$/i.exec(t);
  if (mSusp) {
    const motivo = mSusp[1]?.trim().slice(0, 200);
    return motivo ? { tipo: "suspender", motivo } : { tipo: "suspender" };
  }

  if (/^#retomar$/i.test(t)) return { tipo: "retomar" };
  if (/^#status$/i.test(t)) return { tipo: "status" };

  const mDes = /^#desligar\s+(\S+)$/i.exec(t);
  if (mDes) return { tipo: "desligar", ferramenta: mDes[1].toLowerCase() };

  const mRel = /^#religar\s+(\S+)$/i.exec(t);
  if (mRel) return { tipo: "religar", ferramenta: mRel[1].toLowerCase() };

  return { tipo: "desconhecido" };
}

/** Permite sobrescrever nas operações de controle em testes sem tocar o disco. */
export interface ControleAgente {
  suspender(motivo?: string): void;
  retomar(): void;
  desligar(ferramenta: string): void;
  religar(ferramenta: string): void;
  /** Para o #status. Opcional para não quebrar controles falsos dos testes antigos. */
  estado?(): EstadoSistema;
}

function controleArquivo(): ControleAgente {
  return {
    suspender(motivo) {
      const atual = lerEstadoSistema();
      escreverEstadoSistema({ ...atual, suspenso: true, suspensoPor: motivo, suspensoEm: new Date().toISOString() });
    },
    retomar() {
      const atual = lerEstadoSistema();
      escreverEstadoSistema({ ...atual, suspenso: false, suspensoPor: undefined, suspensoEm: undefined });
    },
    desligar(ferramenta) {
      const atual = lerEstadoSistema();
      const desligadas = new Set(atual.ferramentasDesligadas ?? []);
      desligadas.add(ferramenta);
      escreverEstadoSistema({ ...atual, ferramentasDesligadas: [...desligadas] });
    },
    religar(ferramenta) {
      const atual = lerEstadoSistema();
      const desligadas = new Set(atual.ferramentasDesligadas ?? []);
      desligadas.delete(ferramenta);
      escreverEstadoSistema({ ...atual, ferramentasDesligadas: [...desligadas] });
    },
    estado() {
      return lerEstadoSistema();
    },
  };
}

/** Só o que está em data/estado-sistema.json: FERRAMENTAS_DESLIGADAS do .env vale à parte e só muda com restart. */
export function formatarStatus(estado: EstadoSistema | undefined): string {
  if (!estado) return "ℹ️ Estado do agente indisponível nesta ponte.";
  const linhas = [
    estado.suspenso
      ? `⏸️ Agente SUSPENSO${estado.suspensoPor ? ` — ${estado.suspensoPor}` : ""}${estado.suspensoEm ? ` (desde ${estado.suspensoEm})` : ""}`
      : "▶️ Agente ativo",
  ];
  const desligadas = estado.ferramentasDesligadas ?? [];
  linhas.push(desligadas.length ? `🔒 Desligadas: ${desligadas.join(", ")}` : "🔓 Nenhuma ferramenta desligada pelo chip");
  linhas.push("Obs.: FERRAMENTAS_DESLIGADAS do .env também vale e só muda com restart do agente.");
  return linhas.join("\n");
}

export interface EstadoAtendimento {
  modos: Record<string, Modo>;
  pendentes: Evento[];
}

type Desfecho = "entregue" | "recusado" | "pendente";

export class Atendimento {
  private readonly ultimas = new Map<string, number>();
  /** Último modo conhecido de cada conversa (o agente é a fonte; isto é o que a ponte já ouviu dele). */
  private readonly modos: Map<string, Modo>;
  private readonly pendentes: Evento[];
  private readonly desfechos = new WeakMap<Evento, Desfecho>();
  private readonly confirmarQuandoSair = new WeakSet<Evento>();
  private emCurso: Promise<void> | null = null;
  private readonly aoMudar: () => void;

  private readonly controle: ControleAgente;

  constructor(
    private readonly agente: ClienteAgente,
    private readonly envio: Envio,
    private readonly log: LogPonte = () => {},
    opcoes: { inicial?: Partial<EstadoAtendimento>; aoMudar?: () => void; controle?: ControleAgente } = {}
  ) {
    this.modos = new Map(Object.entries(opcoes.inicial?.modos ?? {}));
    this.pendentes = [...(opcoes.inicial?.pendentes ?? [])];
    this.aoMudar = opcoes.aoMudar ?? (() => {});
    this.controle = opcoes.controle ?? controleArquivo();
  }

  instantaneo(): EstadoAtendimento {
    return { modos: Object.fromEntries(this.modos), pendentes: [...this.pendentes] };
  }

  ultimaDoAtendente(telefone: string): number | undefined {
    return this.ultimas.get(telefone);
  }

  assumiuDepoisDe(telefone: string, instante: number): boolean {
    const ultima = this.ultimas.get(telefone);
    return ultima !== undefined && ultima >= instante;
  }

  modo(telefone: string): Modo {
    return this.modos.get(telefone) ?? "ia";
  }

  registrarModo(telefone: string, modo: Modo): void {
    if (this.modos.get(telefone) === modo) return;
    this.modos.set(telefone, modo);
    this.aoMudar();
  }

  temPendente(telefone: string): boolean {
    return this.pendentes.some((e) => e.telefone === telefone);
  }

  async receberMinha(m: MensagemRecebida): Promise<void> {
    if (m.paraMim) {
      if (this.envio.ehMinha(CHAVE_EU, m.texto)) return;
      await this.tratarComando(m.texto);
      return;
    }
    if (!m.direta || !m.telefone) return;
    if (this.envio.ehMinha(m.telefone, m.texto)) return;
    if (/^#devolver\b/i.test(m.texto.trim())) {
      // Digitado na conversa do cliente: já foi para ele, mas vale como comando para esta conversa.
      const comando = interpretarComando(m.texto);
      const resto = m.texto.trim().replace(/^#devolver\s*/i, "").trim().slice(0, 500);
      const nota = comando?.tipo === "devolver" ? comando.nota : resto || undefined;
      await this.devolver(m.telefone, nota, "o comando foi digitado na conversa do cliente, e ele recebeu a mensagem");
      return;
    }
    this.ultimas.set(m.telefone, Date.now());
    this.registrarModo(m.telefone, "humano");
    this.log({ type: "atendente_assumiu", telefone: m.telefone });
    await this.entregar({
      tipo: "mensagem_atendente",
      telefone: m.telefone,
      id: m.id,
      texto: m.texto.slice(0, LIMITE_TEXTO),
      timestamp: m.timestamp,
    });
  }

  /**
   * Tenta entregar os pendentes. Chamada que chega com uma tentativa em curso espera essa mesma tentativa,
   * em vez de enfileirar outra: com o agente pendurado, uma rodada de espera e não N.
   */
  reenviarEventos(): Promise<void> {
    if (this.emCurso) return this.emCurso;
    if (this.pendentes.length === 0) return Promise.resolve();
    this.emCurso = this.esvaziarPendentes().finally(() => {
      this.emCurso = null;
    });
    return this.emCurso;
  }

  /** Mantém a ordem dentro de cada conversa; a falha de uma conversa não segura as outras. */
  private async esvaziarPendentes(): Promise<void> {
    const bloqueadas = new Set<string>();
    let i = 0;
    while (i < this.pendentes.length) {
      const evento = this.pendentes[i];
      if (bloqueadas.has(evento.telefone)) {
        i++;
        continue;
      }
      const r = await this.agente.enviarEvento(evento);
      if (r.tipo === "falha") {
        bloqueadas.add(evento.telefone);
        i++;
        continue;
      }
      this.pendentes.splice(i, 1);
      this.aoMudar();
      if (r.tipo === "recusado") {
        this.desfechos.set(evento, "recusado");
        this.log({ type: "evento_recusado", tipo: evento.tipo, telefone: evento.telefone, status: r.status });
        await this.envio.paraMim(
          evento.tipo === "devolver" && r.status === 404
            ? `⚠️ #devolver ${evento.telefone}: o agente não tem conversa com esse número. Confira o telefone (DDI + DDD + número, só dígitos).`
            : `⚠️ O agente recusou o aviso "${evento.tipo}" da conversa ${evento.telefone} (HTTP ${r.status}). Confira o terminal do agente.`
        );
        continue;
      }
      this.desfechos.set(evento, "entregue");
      this.registrarModo(evento.telefone, r.resposta.modo);
      if (this.confirmarQuandoSair.has(evento)) await this.envio.paraMim(`✅ ${evento.telefone} devolvido à IA`);
    }
  }

  private async entregar(evento: Evento): Promise<Desfecho> {
    this.pendentes.push(evento);
    this.aoMudar();
    await this.reenviarEventos();
    const desfecho = this.desfechos.get(evento) ?? "pendente";
    if (desfecho === "pendente") this.log({ type: "evento_pendente", tipo: evento.tipo, telefone: evento.telefone });
    return desfecho;
  }

  private async devolver(telefone: string, nota: string | undefined, observacao?: string): Promise<void> {
    const evento: Evento = { tipo: "devolver", telefone, ...(nota ? { nota } : {}) };
    const desfecho = await this.entregar(evento);
    if (desfecho === "entregue") {
      await this.envio.paraMim(`✅ ${telefone} devolvido à IA${observacao ? ` (${observacao})` : ""}`);
    } else if (desfecho === "pendente") {
      this.confirmarQuandoSair.add(evento);
      await this.envio.paraMim(`⏳ Agente fora do ar: o #devolver de ${telefone} será reenviado quando ele voltar.`);
    }
  }

  private async tratarComando(texto: string): Promise<void> {
    const comando = interpretarComando(texto);
    if (!comando) return;
    switch (comando.tipo) {
      case "devolver":
        await this.devolver(comando.telefone, comando.nota);
        break;
      case "suspender":
        this.controle.suspender(comando.motivo);
        this.log({ type: "agente_suspenso", motivo: comando.motivo ?? "" });
        await this.envio.paraMim(
          `⏸️ Agente suspenso${comando.motivo ? ` — ${comando.motivo}` : ""}. Use #retomar para religar.`
        );
        break;
      case "retomar":
        this.controle.retomar();
        this.log({ type: "agente_retomado" });
        await this.envio.paraMim("▶️ Agente retomado. Voltando a responder os clientes.");
        break;
      case "desligar":
        // Nome errado ("criar_orcamentos") confirmava como desligado e nada era bloqueado.
        if (!ehFerramenta(comando.ferramenta)) {
          await this.envio.paraMim(
            `⚠️ "${comando.ferramenta}" não é uma ferramenta do agente. Nada foi desligado.\nFerramentas: ${NOMES_FERRAMENTAS.join(", ")}`
          );
          break;
        }
        this.controle.desligar(comando.ferramenta);
        this.log({ type: "ferramenta_desligada", ferramenta: comando.ferramenta });
        await this.envio.paraMim(
          `🔒 Ferramenta "${comando.ferramenta}" desligada. Use #religar ${comando.ferramenta} para religar.`
        );
        break;
      case "religar":
        if (!ehFerramenta(comando.ferramenta)) {
          await this.envio.paraMim(
            `⚠️ "${comando.ferramenta}" não é uma ferramenta do agente.\nFerramentas: ${NOMES_FERRAMENTAS.join(", ")}`
          );
          break;
        }
        this.controle.religar(comando.ferramenta);
        this.log({ type: "ferramenta_religada", ferramenta: comando.ferramenta });
        await this.envio.paraMim(`🔓 Ferramenta "${comando.ferramenta}" religada.`);
        break;
      case "status":
        await this.envio.paraMim(formatarStatus(this.controle.estado?.()));
        break;
      case "desconhecido":
        await this.envio.paraMim(TEXTO_COMANDOS);
        break;
    }
  }
}
