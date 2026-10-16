import { createRequire } from "module";
import wwebjs from "whatsapp-web.js";
import type { Message } from "whatsapp-web.js";
import type { CanalWhatsApp, ConversaPendente, MensagemRecebida } from "./canal.js";
import { DIGITANDO_MAX_MS } from "./envio.js";
import type { LogPonte } from "./log.js";
import {
  decidirSaude,
  desconexaoTerminal,
  naoLidasDoCliente,
  novoEstadoSaude,
  tipoDaMensagem,
  type EstadoSaude,
} from "./saude.js";
import { ehConversaDireta, normalizarTelefone } from "./telefone.js";

const { Client, LocalAuth } = wwebjs;
type ClienteWhatsApp = InstanceType<typeof Client>;
// Os tipos de qrcode-terminal não têm export default; o require devolve o module.exports do CJS.
const qrcode = createRequire(import.meta.url)("qrcode-terminal") as typeof import("qrcode-terminal");

const PRONTO_TIMEOUT_MS = 90_000;
const ABERTURA_TIMEOUT_MS = 120_000;
const SAUDE_INTERVALO_MS = 5 * 60_000;
const BATIMENTO_INTERVALO_MS = 2 * 60_000;
const VERSOES_REMOTAS = "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html";

export interface OpcoesSessao {
  sessaoDir: string;
  parearTelefone?: string;
  versaoWeb?: string;
  log: LogPonte;
}

function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<T>((_, rejeitar) => setTimeout(() => rejeitar(new Error("prazo esgotado")), ms)),
  ]);
}

export class CanalWwebjs implements CanalWhatsApp {
  private cliente: ClienteWhatsApp | null = null;
  private aoMensagemHandler: (m: MensagemRecebida) => void = () => {};
  private aoProntoHandler: () => void = () => {};
  private readonly versoes: Array<string | undefined>;
  private indiceVersao = 0;
  private reconectando = false;
  private encerrando = false;
  private vigiasInstalados = false;
  private saude: EstadoSaude = novoEstadoSaude();
  private meuWid = "";
  private meuTelefone = "";
  private meuLid = "";
  private readonly telefonesPorLid = new Map<string, string>();
  private readonly digitandoAte = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly opcoes: OpcoesSessao) {
    this.versoes = opcoes.versaoWeb ? [opcoes.versaoWeb, undefined] : [undefined];
  }

  aoMensagem(handler: (m: MensagemRecebida) => void): void {
    this.aoMensagemHandler = handler;
  }

  aoPronto(handler: () => void): void {
    this.aoProntoHandler = handler;
  }

  meuChatId(): string {
    return this.meuWid;
  }

  async iniciar(): Promise<void> {
    await this.lancar();
    this.instalarVigias();
  }

  async enviar(chatId: string, texto: string): Promise<void> {
    // Sem sendSeen: false a biblioteca marca a conversa como lida a cada envio.
    const enviada = await this.exigirCliente().sendMessage(chatId, texto, { sendSeen: false });
    // A biblioteca resolve vazio, sem lançar, quando não acha a conversa.
    if (!enviada) throw new Error(`WhatsApp não encontrou a conversa ${chatId}`);
  }

  /** Fecha o Chrome do puppeteer e para de reconectar. Sem isso o perfil da sessão fica travado. */
  async encerrar(): Promise<void> {
    this.encerrando = true;
    const cliente = this.cliente;
    this.cliente = null;
    if (cliente) await comPrazo(cliente.destroy(), 10_000).catch(() => {});
  }

  async digitando(chatId: string, duracaoMs = DIGITANDO_MAX_MS): Promise<void> {
    const chat = await this.exigirCliente().getChatById(chatId);
    await chat.sendStateTyping();
    // A biblioteca mantém o "digitando" por 25s se ninguém limpar.
    const anterior = this.digitandoAte.get(chatId);
    if (anterior) clearTimeout(anterior);
    this.digitandoAte.set(
      chatId,
      setTimeout(() => {
        this.digitandoAte.delete(chatId);
        void chat.clearState().catch(() => {});
      }, duracaoMs)
    );
  }

  async pararDigitando(chatId: string): Promise<void> {
    const timer = this.digitandoAte.get(chatId);
    if (timer) clearTimeout(timer);
    this.digitandoAte.delete(chatId);
    const chat = await this.exigirCliente().getChatById(chatId);
    await chat.clearState();
  }

  async marcarComoLida(chatId: string): Promise<void> {
    await this.exigirCliente().sendSeen(chatId);
  }

  async pendentes(): Promise<ConversaPendente[]> {
    const resultado: ConversaPendente[] = [];
    for (const chat of await this.exigirCliente().getChats()) {
      const chatId = chat.id._serialized;
      if (chat.isGroup || chat.unreadCount <= 0 || !ehConversaDireta(chatId)) continue;
      const recentes = await chat.fetchMessages({ limit: chat.unreadCount, fromMe: false });
      const mensagens = await Promise.all(naoLidasDoCliente(recentes, chat.unreadCount).map((m) => this.converter(m)));
      if (mensagens.length > 0) resultado.push({ chatId, mensagens });
    }
    return resultado;
  }

  private exigirCliente(): ClienteWhatsApp {
    if (!this.cliente) throw new Error("WhatsApp não está conectado");
    return this.cliente;
  }

  private async lancar(): Promise<void> {
    const versao = this.versoes[this.indiceVersao];
    const cliente = new Client({
      authStrategy: new LocalAuth({ dataPath: this.opcoes.sessaoDir, clientId: "presentes-especiais" }),
      puppeteer: { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] },
      ...(versao
        ? { webVersion: versao, webVersionCache: { type: "remote" as const, remotePath: VERSOES_REMOTAS, strict: false } }
        : {}),
      ...(this.opcoes.parearTelefone
        ? { pairWithPhoneNumber: { phoneNumber: this.opcoes.parearTelefone, showNotification: true } }
        : {}),
    });
    this.cliente = cliente;
    let pronto = false;
    let vigiaPronto: ReturnType<typeof setTimeout> | undefined;
    // Página que trava ao abrir não mostra QR nem autentica: sem isto a ponte fica parada para sempre.
    let vigiaAbertura: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      if (this.cliente === cliente) void this.reconectar(`não abriu em ${ABERTURA_TIMEOUT_MS / 1000}s`);
    }, ABERTURA_TIMEOUT_MS);
    const abriu = () => {
      if (vigiaAbertura) clearTimeout(vigiaAbertura);
      vigiaAbertura = undefined;
    };

    cliente.on("qr", (qr) => {
      abriu();
      console.log("Escaneie o QR com o celular do chip (WhatsApp → Aparelhos conectados → Conectar aparelho):");
      qrcode.generate(qr, { small: true });
    });
    cliente.on("code", (codigo) => {
      abriu();
      console.log(`Código de pareamento: ${codigo} (WhatsApp → Aparelhos conectados → Conectar com número de telefone)`);
    });
    cliente.on("authenticated", () => {
      abriu();
      if (vigiaPronto) clearTimeout(vigiaPronto);
      vigiaPronto = setTimeout(() => {
        if (!pronto) void this.trocarVersao(cliente);
      }, PRONTO_TIMEOUT_MS);
    });
    cliente.on("ready", () => {
      pronto = true;
      abriu();
      if (vigiaPronto) clearTimeout(vigiaPronto);
      this.meuWid = cliente.info.wid._serialized;
      this.meuTelefone = normalizarTelefone(cliente.info.wid.user);
      this.saude = novoEstadoSaude();
      console.log(`WhatsApp pronto (${this.meuTelefone}).`);
      void this.descobrirMeuLid(cliente);
      this.aoProntoHandler();
    });
    cliente.on("auth_failure", (mensagem) => this.opcoes.log({ type: "auth_failure", mensagem }));
    cliente.on("message_create", (msg) => {
      // Cliente antigo que não morreu direito ecoaria o mesmo envio e viraria "atendente assumiu".
      if (this.cliente !== cliente || msg.type === "ciphertext") return;
      this.converter(msg)
        .then((m) => this.aoMensagemHandler(m))
        .catch((err) => this.opcoes.log({ type: "mensagem_nao_convertida", erro: String(err) }));
    });
    cliente.on("disconnected", (motivo) => void this.aoDesconectar(cliente, String(motivo)));

    await cliente.initialize();
  }

  private async converter(msg: Message): Promise<MensagemRecebida> {
    const chatId = msg.fromMe ? msg.to : msg.from;
    const direta = ehConversaDireta(chatId, msg.author);
    const telefone = direta ? await this.resolverTelefone(chatId) : null;
    const tipo = tipoDaMensagem(msg.type);
    const recebida: MensagemRecebida = {
      id: msg.id._serialized,
      chatId,
      telefone,
      deMim: msg.fromMe,
      paraMim:
        msg.fromMe &&
        ((telefone !== null && telefone === this.meuTelefone) || (this.meuLid !== "" && chatId === this.meuLid)),
      direta,
      tipo,
      texto: msg.body ?? "",
      timestamp: new Date((msg.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    };
    const tamanho = (msg as unknown as { _data?: { size?: unknown } })._data?.size;
    if (typeof tamanho === "number") recebida.bytesDeclarados = tamanho;
    if (tipo === "midia") {
      recebida.baixarMidia = async () => {
        const midia = await msg.downloadMedia();
        if (!midia) return null;
        return { mime: midia.mimetype, base64: midia.data, ...(midia.filename ? { nome: midia.filename } : {}) };
      };
    }
    return recebida;
  }

  /** "Mensagem para mim" pode chegar como @lid do próprio número; guardar o lid evita depender da resolução. */
  private async descobrirMeuLid(cliente: ClienteWhatsApp): Promise<void> {
    try {
      const [par] = await cliente.getContactLidAndPhone([this.meuWid]);
      // Mapeamento que não devolve o próprio número faria o @lid de um cliente passar por "Mensagem para mim".
      if (par?.lid && par.pn && normalizarTelefone(par.pn.split("@")[0]) === this.meuTelefone) {
        this.meuLid = par.lid;
        this.telefonesPorLid.set(par.lid, this.meuTelefone);
      }
    } catch (err) {
      this.opcoes.log({ type: "meu_lid_desconhecido", erro: String(err) });
    }
  }

  private async resolverTelefone(chatId: string): Promise<string | null> {
    if (chatId.endsWith("@c.us")) return normalizarTelefone(chatId.split("@")[0]);
    const conhecido = this.telefonesPorLid.get(chatId);
    if (conhecido) return conhecido;
    try {
      const [par] = await this.exigirCliente().getContactLidAndPhone([chatId]);
      if (par?.pn) {
        const telefone = normalizarTelefone(par.pn.split("@")[0]);
        this.telefonesPorLid.set(chatId, telefone);
        return telefone;
      }
    } catch (err) {
      this.opcoes.log({ type: "lid_sem_telefone", erro: String(err) });
    }
    return null;
  }

  private instalarVigias(): void {
    if (this.vigiasInstalados) return;
    this.vigiasInstalados = true;
    setInterval(() => void this.verificarSaude(), SAUDE_INTERVALO_MS);
    setInterval(() => void this.batimento(), BATIMENTO_INTERVALO_MS);
  }

  private async verificarSaude(): Promise<void> {
    if (this.reconectando) return;
    const estado = this.cliente ? await comPrazo(this.cliente.getState(), 5_000).catch(() => null) : null;
    const decisao = decidirSaude(estado, this.saude);
    if (decisao === "desvinculado") {
      console.error("🚨 WhatsApp DESVINCULADO. A ponte parou de tentar: suba de novo e escaneie o QR (ou use WHATSAPP_PAREAR_TELEFONE).");
    } else if (decisao === "reconectar") {
      await this.reconectar("verificação de saúde");
    }
  }

  private async batimento(): Promise<void> {
    const pagina = this.cliente?.pupPage;
    if (this.reconectando || !pagina) return;
    try {
      await comPrazo(pagina.evaluate(() => true), 10_000);
      this.saude.falhasBatimento = 0;
    } catch {
      this.saude.falhasBatimento += 1;
      this.opcoes.log({ type: "batimento_falhou", falhas: this.saude.falhasBatimento });
    }
  }

  private async reconectar(motivo: string): Promise<void> {
    if (this.reconectando || this.encerrando || this.saude.desvinculado) return;
    this.reconectando = true;
    console.warn(`Reconectando o WhatsApp (${motivo})…`);
    try {
      const antigo = this.cliente;
      this.cliente = null;
      // destroy(), nunca logout(): logout apaga a sessão e obriga a escanear o QR de novo.
      if (antigo) await antigo.destroy().catch(() => {});
      await this.lancar();
    } catch (err) {
      this.opcoes.log({ type: "reconexao_falhou", erro: String(err) });
    } finally {
      this.reconectando = false;
    }
  }

  private async trocarVersao(cliente: ClienteWhatsApp): Promise<void> {
    if (this.cliente !== cliente) return;
    this.indiceVersao = (this.indiceVersao + 1) % this.versoes.length;
    await this.reconectar(`autenticou mas não ficou pronta em ${PRONTO_TIMEOUT_MS / 1000}s`);
  }

  private async aoDesconectar(cliente: ClienteWhatsApp, motivo: string): Promise<void> {
    if (this.encerrando) return;
    // A biblioteca emite o motivo e já começa a destruir o cliente: o getState() abaixo pode nem responder.
    if (desconexaoTerminal(motivo)) {
      this.saude.desvinculado = true;
      if (this.cliente === cliente) this.cliente = null;
      await comPrazo(cliente.destroy(), 10_000).catch(() => {});
      console.error(`🚨 WhatsApp desconectado de vez (${motivo}). Suba de novo e escaneie o QR.`);
      return;
    }
    const estado = await comPrazo(cliente.getState(), 4_000).catch(() => null);
    if (estado === "CONNECTED") return;
    setTimeout(() => {
      if (this.cliente === cliente) void this.reconectar(`desconectado: ${motivo}`);
    }, 5_000);
  }
}
