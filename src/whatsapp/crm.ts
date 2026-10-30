import { readFile } from "fs/promises";
import { join } from "path";
import type { LogPonte } from "./log.js";
import type { MensagemObservada, ObservadorPonte } from "./ponte.js";

/*
 * Envia ao CRM, em tempo real, cada mensagem da conversa e o estado da conversa que o agente gravou.
 * Fila em memória com nova tentativa: o CRM fora do ar não trava a ponte nem perde o que chegou
 * enquanto o processo estiver de pé (o CRM é idempotente pelo id, reenviar não duplica).
 */

const MAX_FILA = 2_000;
const INTERVALO_MS = 2_000;
const ESPERA_MAX_MS = 60_000;
const ATRASO_CONVERSA_MS = 1_500;

type Item =
  | { rota: "mensagens"; corpo: MensagemObservada & { nome?: string } }
  | { rota: "conversas"; telefone: string };

export class ObservadorCrm implements ObservadorPonte {
  private readonly fila: Item[] = [];
  private enviando = false;
  private esperaMs = INTERVALO_MS;
  private proximaTentativa = 0;
  private readonly conversasAgendadas = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly url: string,
    private readonly segredo: string,
    private readonly conversasDir: string,
    private readonly log: LogPonte
  ) {
    setInterval(() => void this.esvaziar(), INTERVALO_MS).unref();
  }

  mensagem(m: MensagemObservada): void {
    this.enfileirar({ rota: "mensagens", corpo: m });
  }

  conversaAtualizada(telefone: string): void {
    // O agente grava o arquivo logo depois de responder: espera um pouco e junta pedidos seguidos
    const anterior = this.conversasAgendadas.get(telefone);
    if (anterior) clearTimeout(anterior);
    this.conversasAgendadas.set(
      telefone,
      setTimeout(() => {
        this.conversasAgendadas.delete(telefone);
        this.enfileirar({ rota: "conversas", telefone });
      }, ATRASO_CONVERSA_MS)
    );
  }

  private enfileirar(item: Item): void {
    if (this.fila.length >= MAX_FILA) {
      this.fila.shift();
      this.log({ type: "crm_fila_cheia" });
    }
    this.fila.push(item);
    void this.esvaziar();
  }

  private async esvaziar(): Promise<void> {
    if (this.enviando || this.fila.length === 0 || Date.now() < this.proximaTentativa) return;
    this.enviando = true;
    try {
      while (this.fila.length > 0) {
        const item = this.fila[0];
        const ok = await this.enviar(item);
        if (!ok) {
          this.proximaTentativa = Date.now() + this.esperaMs;
          this.esperaMs = Math.min(this.esperaMs * 2, ESPERA_MAX_MS);
          return;
        }
        this.fila.shift();
        this.esperaMs = INTERVALO_MS;
      }
    } finally {
      this.enviando = false;
    }
  }

  /** true = entregue (ou sem conserto: não adianta repetir). false = tentar de novo depois. */
  private async enviar(item: Item): Promise<boolean> {
    let corpo: unknown;
    if (item.rota === "conversas") {
      try {
        corpo = JSON.parse(await readFile(join(this.conversasDir, `${item.telefone}.json`), "utf8"));
      } catch {
        return true; // conversa ainda sem arquivo (ex.: só mensagens do atendente)
      }
    } else {
      corpo = item.corpo;
    }
    try {
      const res = await fetch(`${this.url}/api/integracao/${item.rota}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": this.segredo },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return true;
      this.log({ type: "crm_recusou", rota: item.rota, status: res.status, corpo: (await res.text()).slice(0, 300) });
      // 4xx é dado ruim ou segredo errado: repetir não resolve (o 401 aparece no log para corrigir o .env)
      return res.status >= 400 && res.status < 500 && res.status !== 429;
    } catch (err) {
      this.log({ type: "crm_fora", rota: item.rota, erro: String(err) });
      return false;
    }
  }
}
