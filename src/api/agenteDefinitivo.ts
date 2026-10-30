import { ConversaDesconhecidaError, TurnoEmAndamentoError, type Agente } from "../contrato/agente.js";
import { lerEstadoSistema, type EstadoSistema } from "../controle/estadoSistema.js";
import { config } from "../config.js";
import type {
  Evento,
  MensagemLote,
  PedidoMensagens,
  RespostaEvento,
  RespostaMensagens,
} from "../contrato/esquemas.js";
import { formatarParaWhatsApp, loteParaTexto } from "../contrato/texto.js";
import { addMessage, limparNomeWhatsapp, type ConversationState } from "../agent/state.js";
import { runTurn, type TurnResult } from "../agent/runTurn.js";
import type { LLMProvider } from "../llm/types.js";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { Logger } from "../logging/logger.js";
import type { Conversa, RepositorioConversas, TransferenciaPendente, TurnoGuardado } from "../conversas/repositorio.js";
import { MENSAGEM_TRANSFERENCIA, type MotivoTransferencia } from "../tools/transferirHumano.js";
import { formatarAvisoTransferencia, resumoDoEstado } from "./resumoAtendente.js";

export const MSG_FALHA =
  "Tive um problema técnico agora. Já chamei alguém da nossa equipe para continuar com você por aqui. 🙏";
export const MSG_LIMITE =
  "Recebemos muitas mensagens em pouco tempo. Uma pessoa da nossa equipe vai continuar com você por aqui. 🙏";
export const MSG_SUSPENSAO =
  "Estamos fora do ar temporariamente. A nossa equipe responde em breve. 🙏";
export const FALHAS_DO_LOTE_PARA_TRANSFERIR = 2;
/** Conversa parada há mais que isto sai da memória e volta do disco na próxima mensagem. */
export const MEMORIA_PADRAO_MS = 30 * 60_000;

class TetoDoTurno extends Error {}
class AtendenteAssumiu extends Error {}

export interface DepsAgente {
  repo: RepositorioConversas;
  llm: LLMProvider;
  client: BrindeMeClient;
  tetoMs: number;
  respostasPorHora: number;
  memoriaMs?: number;
  /** Para os evals: recebe o resultado bruto de cada turno. */
  aoTurno?: (resultado: TurnResult) => void;
  /** Override para testes: evita ler data/estado-sistema.json do projeto. */
  lerEstado?: () => EstadoSistema;
}

export class AgenteDefinitivo implements Agente {
  /** Turno e evento da mesma conversa mexem no mesmo objeto: o evento não é sobrescrito quando o turno salva. */
  private readonly conversas = new Map<string, { conversa: Conversa; usadaEm: number }>();
  private readonly emAndamento = new Map<string, AbortController>();

  constructor(private readonly deps: DepsAgente) {}

  async processarLote(pedido: PedidoMensagens): Promise<RespostaMensagens> {
    const conversa = this.conversa(pedido.telefone);
    const guardado = conversa.turnos.find((t) => t.turnoId === pedido.turnoId);
    if (guardado) return vigente(conversa, guardado);
    if (this.emAndamento.has(pedido.telefone)) throw new TurnoEmAndamentoError();
    const sistema = (this.deps.lerEstado ?? lerEstadoSistema)();
    // Em modo humano ou com transferência a concluir o caminho normal já não chama o modelo.
    if (sistema.suspenso && conversa.estado.modo === "ia" && !conversa.transferenciaPendente) {
      return this.responderSuspenso(conversa, pedido, sistema);
    }
    const controle = new AbortController();
    this.emAndamento.set(pedido.telefone, controle);
    try {
      return await this.executar(conversa, pedido, controle);
    } finally {
      this.emAndamento.delete(pedido.telefone);
    }
  }

  async processarEvento(evento: Evento): Promise<RespostaEvento> {
    if (evento.tipo === "devolver" && !this.conversas.has(evento.telefone) && !this.deps.repo.existe(evento.telefone)) {
      throw new ConversaDesconhecidaError();
    }
    const conversa = this.conversa(evento.telefone);
    const { estado } = conversa;
    if (evento.tipo === "mensagem_atendente") {
      if (!conversa.idsVistos.includes(evento.id)) {
        estado.modo = "humano";
        conversa.tomadas = (conversa.tomadas ?? 0) + 1;
        const turno = this.emAndamento.get(evento.telefone);
        // Com turno em andamento, quem limpa é o próprio turno: a ficha da estimativa ainda precisa chegar ao atendente.
        if (!turno) delete conversa.transferenciaPendente;
        addMessage(estado, "assistant", `[Atendente]: ${evento.texto}`);
        conversa.idsVistos.push(evento.id);
        turno?.abort(new AtendenteAssumiu());
      }
    } else {
      estado.modo = "ia";
      estado.falhasConsecutivas = 0;
      conversa.respostasRecentes = [];
      delete conversa.transferenciaPendente;
      addMessage(
        estado,
        "assistant",
        evento.nota
          ? `[Atendente devolveu o atendimento à IA com a nota: "${evento.nota}"]`
          : "[Atendente devolveu o atendimento à IA]"
      );
    }
    this.deps.repo.salvar(conversa);
    return { modo: estado.modo };
  }

  private conversa(telefone: string): Conversa {
    const agora = Date.now();
    const memoriaMs = this.deps.memoriaMs ?? MEMORIA_PADRAO_MS;
    for (const [tel, item] of this.conversas) {
      if (agora - item.usadaEm >= memoriaMs && !this.emAndamento.has(tel)) this.conversas.delete(tel);
    }
    let item = this.conversas.get(telefone);
    if (!item) {
      item = { conversa: this.deps.repo.carregar(telefone), usadaEm: agora };
      item.conversa.estado.canal = "whatsapp";
      this.conversas.set(telefone, item);
    }
    item.usadaEm = agora;
    return item.conversa;
  }

  private async executar(
    conversa: Conversa,
    pedido: PedidoMensagens,
    controle: AbortController
  ): Promise<RespostaMensagens> {
    const { estado } = conversa;
    const logger = new Logger(estado.conversaId, { turnoId: pedido.turnoId });
    const anteriores = respostasAnteriores(conversa, pedido);
    const novas = pedido.mensagens.filter((m) => !conversa.idsVistos.includes(m.id));
    if (novas.length === 0) return juntar(anteriores, { respostas: [], modo: estado.modo });
    const texto = loteParaTexto(novas);
    const concluir = (resposta: RespostaMensagens) => this.concluir(conversa, pedido, novas, juntar(anteriores, resposta));

    registrarArquivos(estado, novas);
    descartarSobra(estado, texto);
    // O perfil pode mudar de nome no meio da conversa: vale o da mensagem mais recente
    const nomeWhatsapp = limparNomeWhatsapp([...novas].reverse().find((m) => m.nomeContato)?.nomeContato);
    if (nomeWhatsapp) estado.cliente.nomeWhatsapp = nomeWhatsapp;

    if (conversa.transferenciaPendente) {
      addMessage(estado, "user", texto);
      return concluir(respostaDeTransferencia(conversa, pedido.telefone, conversa.transferenciaPendente));
    }

    if (estado.modo === "humano") {
      addMessage(estado, "user", texto);
      return concluir({ respostas: [], modo: "humano" });
    }

    if (this.excedeuLimite(conversa)) {
      addMessage(estado, "user", texto);
      return concluir(transferirPeloSistema(estado, pedido.telefone, MSG_LIMITE, "outro", "limite de respostas por hora", logger));
    }

    const posicaoDaMensagem = estado.historico.length;
    const sistema = (this.deps.lerEstado ?? lerEstadoSistema)();
    const ferramentasDesligadas = new Set([
      ...config.agente.ferramentasDesligadas,
      ...(sistema.ferramentasDesligadas ?? []),
    ]);
    const teto = setTimeout(() => controle.abort(new TetoDoTurno()), this.deps.tetoMs);
    try {
      const r = await runTurn(texto, estado, this.deps.llm, this.deps.client, logger, {
        signal: controle.signal,
        aoEfeito: () => this.deps.repo.salvar(conversa),
        aoTransferir: (resumo, lacunas) => {
          conversa.transferenciaPendente = { resumo, lacunas };
        },
        ferramentasDesligadas: ferramentasDesligadas.size > 0 ? ferramentasDesligadas : undefined,
      });
      // Preenchida pelo aoTransferir durante o turno (o TS não vê a atribuição no callback).
      const transferencia = conversa.transferenciaPendente as TransferenciaPendente | undefined;
      if (transferencia) {
        this.deps.aoTurno?.(r);
        if (!r.response) return concluir(respostaDeTransferencia(conversa, pedido.telefone, transferencia));
        return concluir({
          respostas: formatarParaWhatsApp(r.response),
          modo: estado.modo,
          avisoAtendente: formatarAvisoTransferencia(pedido.telefone, transferencia.resumo, transferencia.lacunas),
        });
      }
      if (!r.response) throw new Error("resposta vazia do modelo");
      this.deps.aoTurno?.(r);
      conversa.respostasRecentes.push(new Date().toISOString());
      return concluir({ respostas: formatarParaWhatsApp(r.response), modo: estado.modo });
    } catch (err) {
      if (controle.signal.reason instanceof AtendenteAssumiu) {
        logger.log({ type: "state_change", change: "turno_interrompido_pelo_atendente" });
        return concluir(respostaDaTomada(conversa, pedido.telefone));
      }
      const transferencia = conversa.transferenciaPendente;
      const estourou = controle.signal.reason instanceof TetoDoTurno;
      logger.log({
        type: "alerta",
        gravidade: "alta",
        motivo: estourou ? "teto_do_turno" : `falha_no_turno: ${String(err).slice(0, 200)}`,
        ...(transferencia ? { depois_da_transferencia: true } : {}),
      });
      if (transferencia) return concluir(respostaDeTransferencia(conversa, pedido.telefone, transferencia));

      const falhas = (conversa.falhasPorTurno[pedido.turnoId] ?? 0) + 1;
      conversa.falhasPorTurno[pedido.turnoId] = falhas;
      if (estourou || falhas >= FALHAS_DO_LOTE_PARA_TRANSFERIR) {
        garantirMensagem(estado, posicaoDaMensagem, texto);
        const observacao = estourou ? "turno passou do teto de tempo" : "o modelo falhou duas vezes neste lote";
        return concluir(transferirPeloSistema(estado, pedido.telefone, MSG_FALHA, "falha_sistema", observacao, logger));
      }
      desfazerMensagem(estado, posicaoDaMensagem, texto);
      this.deps.repo.salvar(conversa);
      throw err;
    } finally {
      clearTimeout(teto);
    }
  }

  /**
   * Agente suspenso pelo #suspender. Antes a mensagem era descartada, o aviso saía a cada mensagem
   * e ninguém era avisado, embora o texto prometa que a equipe responde. Agora a mensagem fica no
   * histórico, o cliente recebe o aviso uma vez por suspensão e o atendente é chamado nessa mesma vez.
   */
  private responderSuspenso(conversa: Conversa, pedido: PedidoMensagens, sistema: EstadoSistema): RespostaMensagens {
    const { estado } = conversa;
    const novas = pedido.mensagens.filter((m) => !conversa.idsVistos.includes(m.id));
    if (novas.length === 0) return { respostas: [], modo: estado.modo };
    const texto = loteParaTexto(novas);
    registrarArquivos(estado, novas);
    addMessage(estado, "user", texto);
    new Logger(estado.conversaId, { turnoId: pedido.turnoId }).log({ type: "state_change", change: "mensagem_com_agente_suspenso" });

    const marca = sistema.suspensoEm ?? "suspenso";
    if (conversa.avisoSuspensao === marca) return this.concluir(conversa, pedido, novas, { respostas: [], modo: "ia" });
    conversa.avisoSuspensao = marca;
    addMessage(estado, "assistant", MSG_SUSPENSAO);
    return this.concluir(conversa, pedido, novas, {
      respostas: [MSG_SUSPENSAO],
      modo: "ia",
      avisoAtendente: [
        `⏸️ *Agente suspenso* — ${pedido.telefone} escreveu e recebeu o aviso de fora do ar.`,
        `Mensagem: ${texto.slice(0, 300)}`,
        "Responda pelo chip (ao escrever, você assume a conversa) ou use #retomar.",
      ].join("\n"),
    });
  }

  private excedeuLimite(conversa: Conversa): boolean {
    const umaHoraAtras = Date.now() - 3_600_000;
    conversa.respostasRecentes = conversa.respostasRecentes.filter((t) => Date.parse(t) > umaHoraAtras);
    return conversa.respostasRecentes.length >= this.deps.respostasPorHora;
  }

  private concluir(
    conversa: Conversa,
    pedido: PedidoMensagens,
    novas: MensagemLote[],
    resposta: RespostaMensagens
  ): RespostaMensagens {
    conversa.idsVistos.push(...novas.map((m) => m.id));
    conversa.turnos.push({
      turnoId: pedido.turnoId,
      resposta,
      ids: pedido.mensagens.map((m) => m.id),
      tomadas: conversa.tomadas ?? 0,
    });
    delete conversa.falhasPorTurno[pedido.turnoId];
    delete conversa.transferenciaPendente;
    this.deps.repo.salvar(conversa);
    return resposta;
  }
}

/** Resposta da IA gerada antes de o atendente escrever não sai mais: ele já está na conversa. */
function vigente(conversa: Conversa, turno: TurnoGuardado): RespostaMensagens {
  if ((conversa.tomadas ?? 0) > (turno.tomadas ?? 0)) return { respostas: [], modo: conversa.estado.modo };
  return turno.resposta;
}

/**
 * A ponte reenviou mensagens já respondidas (reiniciou e reagrupou o que não tinha saído):
 * a resposta daquele turno não chegou ao cliente e vai junto. Turno coberto por outro maior não repete.
 */
function respostasAnteriores(conversa: Conversa, pedido: PedidoMensagens): RespostaMensagens[] {
  const ids = new Set(pedido.mensagens.map((m) => m.id));
  const tocados = conversa.turnos.filter((t) => t.ids?.some((id) => ids.has(id)));
  return tocados
    .filter((t) => !tocados.some((u) => u !== t && t.ids!.every((id) => u.ids!.includes(id))))
    .map((t) => vigente(conversa, t));
}

function juntar(anteriores: RespostaMensagens[], atual: RespostaMensagens): RespostaMensagens {
  if (anteriores.length === 0) return atual;
  const avisos = [...anteriores.map((a) => a.avisoAtendente), atual.avisoAtendente].filter(Boolean);
  return {
    respostas: [...anteriores.flatMap((a) => a.respostas), ...atual.respostas],
    modo: atual.modo,
    ...(avisos.length > 0 ? { avisoAtendente: avisos.join("\n\n") } : {}),
  };
}

function respostaDeTransferencia(conversa: Conversa, telefone: string, t: TransferenciaPendente): RespostaMensagens {
  const { estado } = conversa;
  estado.modo = "humano";
  addMessage(estado, "assistant", MENSAGEM_TRANSFERENCIA);
  return {
    respostas: [MENSAGEM_TRANSFERENCIA],
    modo: "humano",
    avisoAtendente: formatarAvisoTransferencia(telefone, t.resumo, t.lacunas),
  };
}

function respostaDaTomada(conversa: Conversa, telefone: string): RespostaMensagens {
  // A transferência com a estimativa saiu antes de o atendente assumir: a ficha ainda precisa chegar a ele.
  const t = conversa.transferenciaPendente;
  return {
    respostas: [],
    modo: conversa.estado.modo,
    ...(t?.resumo.ficha_pedido ? { avisoAtendente: formatarAvisoTransferencia(telefone, t.resumo, t.lacunas) } : {}),
  };
}

function transferirPeloSistema(
  estado: ConversationState,
  telefone: string,
  mensagem: string,
  motivo: MotivoTransferencia,
  observacao: string,
  logger: Logger
): RespostaMensagens {
  estado.modo = "humano";
  addMessage(estado, "assistant", mensagem);
  logger.log({ type: "transfer", motivo, prioridade: "alta" });
  return {
    respostas: [mensagem],
    modo: "humano",
    avisoAtendente: formatarAvisoTransferencia(telefone, resumoDoEstado(estado, motivo, observacao)),
  };
}

function registrarArquivos(estado: ConversationState, novas: MensagemLote[]): void {
  const lista = (estado.arquivosRecebidos ??= []);
  for (const m of novas) {
    if (m.arquivo && !lista.some((a) => a.caminho === m.arquivo!.caminho)) {
      lista.push({ nome: m.arquivo.nome, caminho: m.arquivo.caminho, mime: m.arquivo.mime, bytes: m.arquivo.bytes });
    }
  }
}

/** Tentativa anterior do mesmo lote caiu depois de salvar (aoEfeito) com a mensagem já no histórico. */
function descartarSobra(estado: ConversationState, texto: string): void {
  const ultima = estado.historico.at(-1);
  if (ultima?.role === "user" && ultima.content === texto) estado.historico.pop();
}

function desfazerMensagem(estado: ConversationState, posicao: number, texto: string): void {
  const m = estado.historico[posicao];
  if (m?.role === "user" && m.content === texto) estado.historico.splice(posicao, 1);
}

function garantirMensagem(estado: ConversationState, posicao: number, texto: string): void {
  const m = estado.historico[posicao];
  if (m?.role === "user" && m.content === texto) return;
  estado.historico.splice(posicao, 0, { role: "user", content: texto, timestamp: new Date().toISOString() });
}
