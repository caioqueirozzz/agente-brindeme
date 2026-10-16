import { LIMITE_TEXTO, type Evento, type Modo } from "../contrato/esquemas.js";
import type { ClienteAgente } from "./agenteHttp.js";
import type { MensagemRecebida } from "./canal.js";
import { CHAVE_EU, type Envio } from "./envio.js";
import type { LogPonte } from "./log.js";
import { normalizarTelefone } from "./telefone.js";

export type Comando = { tipo: "devolver"; telefone: string; nota?: string } | { tipo: "desconhecido" };

export const TEXTO_COMANDOS = [
  "Comandos do agente:",
  "#devolver <telefone com DDI, sem espaços> [nota] — devolve a conversa à IA",
  "Exemplo: #devolver 5583999990000 cliente já recebeu o boleto",
].join("\n");

export function interpretarComando(texto: string): Comando | null {
  const t = texto.trim();
  if (!t.startsWith("#")) return null;
  const m = /^#devolver\s+(\S+)(?:\s+([\s\S]+))?$/i.exec(t);
  if (!m) return { tipo: "desconhecido" };
  const telefone = normalizarTelefone(m[1]);
  if (!/^[1-9]\d{11,14}$/.test(telefone)) return { tipo: "desconhecido" };
  const nota = m[2]?.trim().slice(0, 500);
  return nota ? { tipo: "devolver", telefone, nota } : { tipo: "devolver", telefone };
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

  constructor(
    private readonly agente: ClienteAgente,
    private readonly envio: Envio,
    private readonly log: LogPonte = () => {},
    opcoes: { inicial?: Partial<EstadoAtendimento>; aoMudar?: () => void } = {}
  ) {
    this.modos = new Map(Object.entries(opcoes.inicial?.modos ?? {}));
    this.pendentes = [...(opcoes.inicial?.pendentes ?? [])];
    this.aoMudar = opcoes.aoMudar ?? (() => {});
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
    if (comando.tipo === "desconhecido") {
      await this.envio.paraMim(TEXTO_COMANDOS);
      return;
    }
    await this.devolver(comando.telefone, comando.nota);
  }
}
