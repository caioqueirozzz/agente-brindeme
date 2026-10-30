import {
  LIMITE_TEXTO,
  type MensagemLote,
  type PedidoMensagens,
  type RespostaMensagens,
} from "../contrato/esquemas.js";
import { calcularTurnoId } from "../contrato/turno.js";
import type { ClienteAgente, ResultadoLote } from "./agenteHttp.js";
import { Atendimento } from "./atendente.js";
import type { CanalWhatsApp, MensagemRecebida, MidiaBaixada } from "./canal.js";
import { Envio, esperar } from "./envio.js";
import { MemoriaEstadoPonte, type ArmazemPonte, type EntregaParcial } from "./estadoPonte.js";
import { ConjuntoLimitado, FilaConversas, type OpcoesFila } from "./fila.js";
import type { LogPonte } from "./log.js";
import { salvarMidia, TAMANHO_MAXIMO_BYTES } from "./midia.js";
import { iaAtende, type ConfigLia } from "./modoLia.js";
import { normalizarTelefone } from "./telefone.js";

export const ESPERA_EM_ANDAMENTO_MS = 5_000;
export const LIMITE_EM_ANDAMENTO_MS = 120_000;
export const PRAZO_DOWNLOAD_MS = 60_000;
/** O WhatsApp segura o "digitando" por 25s; renovar a cada 20s mantém o sinal enquanto o agente pensa. */
export const DIGITANDO_PENSANDO_MS = 25_000;
export const RENOVAR_DIGITANDO_MS = 20_000;
const SALVAR_APOS_MS = 300;
const CONCLUIDOS_GUARDADOS = 2_000;
const ENTREGAS_PARCIAIS_GUARDADAS = 200;

export const MSG_AUDIO = "Ainda não consigo ouvir áudios por aqui 🙏 Pode me mandar por escrito?";
export const MSG_INSTABILIDADE = "Estamos com uma instabilidade agora, mas já te respondemos por aqui. 🙏";
const RECUSA_VIDEO = "[arquivo recusado: vídeo, formato não aceito (aceitos: PNG, JPG, SVG, PDF)]";

export function alertaAgenteFora(minutos: number): string {
  return `⚠️ O agente não responde há ${minutos} min. Quem escrever recebe o aviso de instabilidade. Veja o terminal do agente.`;
}

/** Quem escreveu, do ponto de vista da loja. ATENDENTE: alguém da equipe (pelo celular ou pelo CRM). */
export type AutorMensagem = "CLIENTE" | "AGENTE" | "ATENDENTE";

export interface MensagemObservada {
  id: string;
  telefone: string;
  autor: AutorMensagem;
  tipo: MensagemRecebida["tipo"];
  texto: string;
  timestamp: string;
}

/** Quem acompanha a ponte de fora (o CRM). Chamadas sem esperar: a ponte nunca trava por causa dele. */
export interface ObservadorPonte {
  mensagem(m: MensagemObservada): void;
  /** O agente terminou (ou desistiu de) um lote desta conversa: o estado dela pode ter mudado. */
  conversaAtualizada(telefone: string): void;
}

export interface OpcoesPonte {
  artesDir: string;
  liberados: string[];
  lote: OpcoesFila;
  avisoInstabilidadeMs: number;
  enviosPorMinuto: number;
  /** Onde a ponte guarda o que precisa lembrar depois de reiniciar (padrão: só memória). */
  armazem?: ArmazemPonte;
  observador?: ObservadorPonte;
}

/** entregue: tudo saiu · vazio: o agente não respondeu nada · descartado: o atendente assumiu · pendente: repetir depois */
type ResultadoEntrega = "entregue" | "vazio" | "descartado" | "pendente";

/** O agente trata estes colchetes como aviso do sistema; digitados pelo cliente, chegam marcados. */
const MARCADOR_DO_SISTEMA = /\[(?=\s*(?:arquivo|atendente|imagem|in[íi]cio do trecho))/gi;

export function neutralizarMarcadores(texto: string): string {
  return texto.replace(MARCADOR_DO_SISTEMA, "(o cliente escreveu) [");
}

/** O nome de perfil viaja com a mensagem até o agente; cortado no limite do contrato. */
function nomeDoContato(m: MensagemRecebida): { nomeContato?: string } {
  return m.nomeContato ? { nomeContato: m.nomeContato.slice(0, 100) } : {};
}

function juntar(primeira: string, segunda: string): string {
  return (segunda ? `${primeira}\n${segunda}` : primeira).slice(0, LIMITE_TEXTO);
}

function comPrazo<T>(promessa: Promise<T>, ms: number, noPrazo: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(noPrazo), Math.max(0, ms));
  });
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(timer));
}

export class Ponte {
  private readonly fila: FilaConversas;
  private readonly envio: Envio;
  private readonly atendimento: Atendimento;
  private readonly armazem: ArmazemPonte;
  private readonly concluidos = new ConjuntoLimitado(5_000);
  /** Ids sendo tratados fora da fila (aviso de áudio): a outra via que trouxer o mesmo id desiste. */
  private readonly reservados = new Set<string>();
  /** Pedidos que falharam ou não terminaram de sair, na ordem; voltam antes de qualquer lote novo da conversa. */
  private readonly aRepetir = new Map<string, PedidoMensagens[]>();
  /** Gravado em disco a cada parte enviada: depois de reiniciar, o que já chegou ao cliente não sai de novo. */
  private readonly entregasParciais: Map<string, EntregaParcial>;
  private avisosPendentes: string[];
  private readonly liberados: Set<string>;
  /** Modo escolhido no CRM; quando definido, vale no lugar de liberados. */
  private modoLia: ConfigLia | null = null;
  private queda: { desde: number; alertado: boolean; avisados: Set<string> } | null = null;
  private varrendo = false;
  private salvamento: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly canal: CanalWhatsApp,
    private readonly agente: ClienteAgente,
    private readonly opcoes: OpcoesPonte,
    private readonly log: LogPonte = () => {}
  ) {
    this.armazem = opcoes.armazem ?? new MemoriaEstadoPonte();
    const salvo = this.armazem.carregar();
    for (const id of salvo.concluidos) this.concluidos.add(id);
    this.avisosPendentes = [...salvo.avisosPendentes];
    this.entregasParciais = new Map(Object.entries(salvo.entregasParciais ?? {}));
    this.envio = new Envio(canal, opcoes.enviosPorMinuto, log);
    this.atendimento = new Atendimento(agente, this.envio, log, {
      inicial: { modos: salvo.modos, pendentes: salvo.eventosPendentes },
      aoMudar: () => this.agendarSalvar(),
    });
    this.fila = new FilaConversas(opcoes.lote, (telefone, chatId, mensagens) =>
      this.processarLote(telefone, chatId, mensagens).finally(() => this.opcoes.observador?.conversaAtualizada(telefone))
    );
    this.liberados = new Set(opcoes.liberados.map(normalizarTelefone));
  }

  /** Troca o modo da Lia na hora (aba Conexão do CRM). Vale para a próxima mensagem que chegar. */
  definirModoLia(config: ConfigLia): void {
    this.modoLia = config;
  }

  private iaAtende(telefone: string): boolean {
    if (this.modoLia) return iaAtende(this.modoLia, telefone);
    return this.liberados.size === 0 || this.liberados.has(telefone);
  }

  iniciar(intervaloVarreduraMs: number): void {
    this.canal.aoMensagem((m) => void this.receber(m));
    this.canal.aoPronto(() => void this.varrer());
    setInterval(() => void this.varrer(), intervaloVarreduraMs);
  }

  async receber(m: MensagemRecebida): Promise<void> {
    this.observar(m);
    try {
      if (m.deMim) await this.atendimento.receberMinha(m);
      else await this.receberDoCliente(m);
    } catch (err) {
      this.log({ type: "erro_ao_receber", id: m.id, erro: String(err) });
    }
  }

  /** Devolve a conversa à IA a pedido de fora (o CRM), como o #devolver digitado no chip. */
  devolverParaIa(telefone: string, nota?: string): Promise<void> {
    return this.atendimento.devolver(normalizarTelefone(telefone), nota, "pelo CRM");
  }

  /**
   * Repassa a mensagem ao observador antes do Atendimento consumir o registro de saída:
   * é esse registro que diz se a mensagem "minha" foi da IA ou de uma pessoa.
   */
  private observar(m: MensagemRecebida): void {
    const observador = this.opcoes.observador;
    if (!observador || !m.direta || !m.telefone || m.paraMim || m.tipo === "ignorada") return;
    const autor: AutorMensagem = !m.deMim ? "CLIENTE" : this.envio.seriaMinha(m.telefone, m.texto) ? "AGENTE" : "ATENDENTE";
    try {
      observador.mensagem({ id: m.id, telefone: m.telefone, autor, tipo: m.tipo, texto: m.texto, timestamp: m.timestamp });
    } catch (err) {
      this.log({ type: "observador_falhou", erro: String(err) });
    }
  }

  async varrer(): Promise<void> {
    if (this.varrendo) return;
    this.varrendo = true;
    try {
      await this.atendimento.reenviarEventos();
      const avisos = this.avisosPendentes.splice(0);
      for (const aviso of avisos) {
        if (!(await this.envio.paraMim(aviso))) this.avisosPendentes.push(aviso);
      }
      if (avisos.length > 0) this.agendarSalvar();
      for (const conversa of await this.canal.pendentes()) {
        for (const m of conversa.mensagens) await this.receber(m);
      }
      for (const telefone of this.aRepetir.keys()) this.fila.cutucar(telefone);
    } catch (err) {
      this.log({ type: "varredura_falhou", erro: String(err) });
    } finally {
      this.varrendo = false;
    }
  }

  /** Grava o estado já (na saída do processo); no dia a dia ele é gravado logo depois de cada mudança. */
  salvarAgora(): void {
    if (this.salvamento) clearTimeout(this.salvamento);
    this.salvamento = undefined;
    const { modos, pendentes } = this.atendimento.instantaneo();
    try {
      this.armazem.salvar({
        versao: 1,
        modos,
        eventosPendentes: pendentes,
        avisosPendentes: [...this.avisosPendentes],
        concluidos: this.concluidos.valores().slice(-CONCLUIDOS_GUARDADOS),
        entregasParciais: Object.fromEntries([...this.entregasParciais].slice(-ENTREGAS_PARCIAIS_GUARDADAS)),
      });
    } catch (err) {
      this.log({ type: "estado_nao_salvo", erro: String(err) });
    }
  }

  private agendarSalvar(): void {
    if (this.salvamento) return;
    this.salvamento = setTimeout(() => this.salvarAgora(), SALVAR_APOS_MS);
  }

  private async receberDoCliente(m: MensagemRecebida): Promise<void> {
    if (!m.direta || !m.telefone || this.concluidos.has(m.id) || this.reservados.has(m.id)) return;
    if (!this.iaAtende(m.telefone)) return;
    const telefone = m.telefone;

    if (m.tipo === "audio" || m.tipo === "ignorada") {
      this.reservados.add(m.id);
      try {
        const comIa = this.atendimento.modo(telefone) === "ia";
        if (m.tipo === "audio" && comIa && !(await this.envio.paraCliente(telefone, m.chatId, MSG_AUDIO))) return;
        this.concluir([m.id]);
        if (this.podeMarcarLida(telefone, false)) await this.marcarComoLida(m.chatId);
      } finally {
        this.reservados.delete(m.id);
      }
      return;
    }

    if (m.tipo === "midia") {
      // O lugar na fila é reservado antes do download para a imagem não chegar depois do texto que veio atrás dela.
      if (!this.fila.reservar(telefone, m.chatId, m.id)) return;
      this.fila.preencher(telefone, m.id, { ...(await this.mensagemDeMidia(telefone, m)), ...nomeDoContato(m) });
      return;
    }

    const doCliente = neutralizarMarcadores(m.texto);
    const texto = m.tipo === "nao_suportada" ? juntar(RECUSA_VIDEO, doCliente.trim()) : doCliente.slice(0, LIMITE_TEXTO);
    this.fila.adicionar(telefone, m.chatId, { id: m.id, timestamp: m.timestamp, texto, ...nomeDoContato(m) });
  }

  private async mensagemDeMidia(telefone: string, m: MensagemRecebida): Promise<MensagemLote> {
    const legenda = neutralizarMarcadores(m.texto).trim();
    const recusa = (motivo: string): MensagemLote => ({ id: m.id, timestamp: m.timestamp, texto: juntar(motivo, legenda) });
    if (m.bytesDeclarados !== undefined && m.bytesDeclarados > TAMANHO_MAXIMO_BYTES) {
      return recusa("[arquivo recusado: arquivo, maior que 16 MB]");
    }
    let midia: MidiaBaixada | null = null;
    try {
      midia = await comPrazo(m.baixarMidia?.() ?? Promise.resolve(null), PRAZO_DOWNLOAD_MS, null);
    } catch (err) {
      this.log({ type: "midia_nao_baixou", id: m.id, erro: String(err) });
    }
    if (!midia) return recusa("[arquivo recusado: arquivo, não foi possível baixar]");
    const salvo = salvarMidia(this.opcoes.artesDir, telefone, m.id, midia);
    if (!salvo.ok) return recusa(`[arquivo recusado: ${salvo.nome}, ${salvo.motivo}]`);
    return { id: m.id, timestamp: m.timestamp, texto: legenda.slice(0, LIMITE_TEXTO), arquivo: salvo.arquivo };
  }

  /** Só marca como lida com a conversa na IA e sem nada pendente: lote, mídia baixando, turno ou pedido a repetir. */
  private podeMarcarLida(telefone: string, dentroDoTurno: boolean): boolean {
    if (this.atendimento.modo(telefone) !== "ia") return false;
    if (this.aRepetir.has(telefone)) return false;
    return dentroDoTurno ? !this.fila.temNoBuffer(telefone) : !this.fila.ocupada(telefone);
  }

  private async processarLote(telefone: string, chatId: string, mensagens: MensagemLote[]): Promise<void> {
    const pedidos = this.aRepetir.get(telefone) ?? [];
    this.aRepetir.delete(telefone);
    if (mensagens.length > 0) {
      pedidos.push({ turnoId: calcularTurnoId(mensagens.map((m) => m.id)), telefone, mensagens });
    }
    let tudoEntregue = true;
    for (let i = 0; i < pedidos.length; i++) {
      const resultado = await this.tentar(telefone, chatId, pedidos[i]);
      if (resultado === "pendente") {
        this.aRepetir.set(telefone, pedidos.slice(i));
        return;
      }
      if (resultado !== "entregue") tudoEntregue = false;
    }
    if (tudoEntregue && pedidos.length > 0 && this.podeMarcarLida(telefone, true)) await this.marcarComoLida(chatId);
  }

  private async tentar(telefone: string, chatId: string, pedido: PedidoMensagens): Promise<ResultadoEntrega> {
    await this.atendimento.reenviarEventos();
    if (this.atendimento.temPendente(telefone)) {
      await this.registrarQueda(telefone, chatId, pedido, "eventos_do_atendente_pendentes");
      return "pendente";
    }
    const comIa = this.atendimento.modo(telefone) === "ia";
    const pararDeRenovar = comIa ? this.manterDigitando(chatId) : () => {};
    let resultado: ResultadoEntrega;
    try {
      resultado = await this.chamarAgente(telefone, chatId, pedido, pararDeRenovar);
    } finally {
      pararDeRenovar();
    }
    if (comIa && resultado !== "entregue") void this.canal.pararDigitando(chatId).catch(() => {});
    return resultado;
  }

  private async chamarAgente(
    telefone: string,
    chatId: string,
    pedido: PedidoMensagens,
    pararDeRenovar: () => void
  ): Promise<ResultadoEntrega> {
    const inicio = Date.now();
    const prazo = inicio + LIMITE_EM_ANDAMENTO_MS;
    for (;;) {
      const restante = prazo - Date.now();
      const r = await comPrazo<ResultadoLote>(this.agente.enviarLote(pedido, restante), restante, {
        tipo: "falha",
        motivo: "prazo_total",
      });
      if (r.tipo === "ok") {
        this.queda = null;
        pararDeRenovar();
        return this.entregar(telefone, chatId, pedido, r.resposta, inicio);
      }
      if (r.tipo === "em_andamento" && Date.now() + ESPERA_EM_ANDAMENTO_MS <= prazo) {
        await esperar(ESPERA_EM_ANDAMENTO_MS);
        continue;
      }
      await this.registrarQueda(telefone, chatId, pedido, r.tipo === "falha" ? r.motivo : "em_andamento_por_120s");
      return "pendente";
    }
  }

  private manterDigitando(chatId: string): () => void {
    const renovar = () => void this.canal.digitando(chatId, DIGITANDO_PENSANDO_MS).catch(() => {});
    renovar();
    const timer = setInterval(renovar, RENOVAR_DIGITANDO_MS);
    return () => clearInterval(timer);
  }

  private async entregar(
    telefone: string,
    chatId: string,
    pedido: PedidoMensagens,
    resposta: RespostaMensagens,
    inicio: number
  ): Promise<ResultadoEntrega> {
    const ids = pedido.mensagens.map((m) => m.id);
    const assumiu = () => this.atendimento.assumiuDepoisDe(telefone, inicio);
    const parcial = this.entregaParcial(telefone, ids);
    const esquecerParcial = () => {
      const atual = this.entregasParciais.get(telefone);
      if (atual && (atual === parcial || atual.ids === ids)) this.entregasParciais.delete(telefone);
    };
    const descartar = async (): Promise<ResultadoEntrega> => {
      esquecerParcial();
      // O aviso conta ao atendente o que o agente já fez (ex.: orçamento criado) mesmo sem resposta ao cliente.
      if (resposta.avisoAtendente) await this.avisar(resposta.avisoAtendente);
      this.concluir(ids);
      this.log({ type: "resposta_descartada", turnoId: pedido.turnoId, motivo: "atendente_assumiu" });
      return "descartado";
    };
    if (assumiu()) return descartar();
    this.atendimento.registrarModo(telefone, resposta.modo);

    // Lote reagrupado depois de reiniciar: a resposta começa pelas partes do turno antigo, já entregues em parte.
    let jaSaiu = 0;
    while (parcial && jaSaiu < parcial.partes.length && resposta.respostas[jaSaiu] === parcial.partes[jaSaiu]) jaSaiu++;
    for (let i = jaSaiu; i < resposta.respostas.length; i++) {
      const saiu = await this.envio.paraCliente(telefone, chatId, resposta.respostas[i], () => !assumiu());
      if (assumiu()) return descartar();
      if (!saiu) {
        this.log({ type: "entrega_interrompida", turnoId: pedido.turnoId, parte: i });
        return "pendente";
      }
      this.entregasParciais.set(telefone, { ids, partes: resposta.respostas.slice(0, i + 1) });
      this.salvarAgora();
    }
    esquecerParcial();
    if (resposta.avisoAtendente) await this.avisar(resposta.avisoAtendente);
    this.concluir(ids);
    this.log({ type: "lote_entregue", turnoId: pedido.turnoId, partes: resposta.respostas.length, modo: resposta.modo });
    if (resposta.modo === "ia" && resposta.respostas.length === 0) {
      this.log({ type: "resposta_vazia", turnoId: pedido.turnoId });
      return "vazio";
    }
    return "entregue";
  }

  /** Só vale para um pedido que contém todas as mensagens daquela entrega (o mesmo, ou ele reagrupado). */
  private entregaParcial(telefone: string, ids: string[]): EntregaParcial | undefined {
    const e = this.entregasParciais.get(telefone);
    return e && e.ids.every((id) => ids.includes(id)) ? e : undefined;
  }

  private async avisar(aviso: string): Promise<void> {
    if (!(await this.envio.paraMim(aviso))) this.avisosPendentes.push(aviso);
  }

  private async registrarQueda(telefone: string, chatId: string, pedido: PedidoMensagens, motivo: string): Promise<void> {
    this.log({ type: "lote_falhou", turnoId: pedido.turnoId, motivo });
    const agora = Date.now();
    this.queda ??= { desde: agora, alertado: false, avisados: new Set() };
    const queda = this.queda;
    if (agora - queda.desde < this.opcoes.avisoInstabilidadeMs) return;
    if (!queda.avisados.has(telefone) && this.atendimento.modo(telefone) === "ia") {
      if (await this.envio.paraCliente(telefone, chatId, MSG_INSTABILIDADE)) queda.avisados.add(telefone);
    }
    if (!queda.alertado) {
      if (await this.envio.paraMim(alertaAgenteFora(Math.round(this.opcoes.avisoInstabilidadeMs / 60_000)))) {
        queda.alertado = true;
      }
    }
  }

  private concluir(ids: string[]): void {
    for (const id of ids) this.concluidos.add(id);
    this.fila.esquecer(ids);
    this.agendarSalvar();
  }

  private async marcarComoLida(chatId: string): Promise<void> {
    await this.canal.marcarComoLida(chatId).catch((err) => this.log({ type: "marcar_lida_falhou", erro: String(err) }));
  }
}
