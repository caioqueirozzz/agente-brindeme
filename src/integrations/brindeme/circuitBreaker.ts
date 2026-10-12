/**
 * Disjuntor da Fase 2: após N falhas seguidas, as ferramentas param de chamar a
 * API por alguns minutos — em vez de cada conversa continuar batendo numa API
 * que já se sabe fora. Enquanto aberto, as chamadas falham na hora com
 * `servico_indisponivel`, e o agente avisa o cliente e transfere.
 *
 * Só falha de infraestrutura abre o disjuntor. 404 e 422 são respostas válidas
 * da API — significam que ela está de pé.
 */
import { ApiError, NetworkError } from "./errors.js";

export type EstadoDisjuntor = "fechado" | "aberto" | "meio_aberto";

export interface DisjuntorOptions {
  /** Falhas seguidas para abrir. */
  limiteFalhas?: number;
  /** Quanto tempo fica aberto antes de deixar passar uma sonda. */
  cooldownMs?: number;
  /** Injetável para teste. */
  agora?: () => number;
}

export class CircuitOpenError extends Error {
  constructor(public readonly reabreEmMs: number) {
    super(`Disjuntor aberto — nova tentativa em ${Math.ceil(reabreEmMs / 1000)}s`);
    this.name = "CircuitOpenError";
  }
}

/** 401/403 também abrem: chave inválida não melhora com retry. */
function contaComoFalha(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (err instanceof ApiError) {
    return err.status === 401 || err.status === 403 || err.status === 408 || err.status >= 500;
  }
  return false;
}

export class CircuitBreaker {
  private falhas = 0;
  private abertoAte = 0;
  private readonly limiteFalhas: number;
  private readonly cooldownMs: number;
  private readonly agora: () => number;

  constructor(options?: DisjuntorOptions) {
    this.limiteFalhas = options?.limiteFalhas ?? 3;
    this.cooldownMs = options?.cooldownMs ?? 2 * 60 * 1000;
    this.agora = options?.agora ?? Date.now;
  }

  get estado(): EstadoDisjuntor {
    if (this.abertoAte === 0) return "fechado";
    return this.agora() >= this.abertoAte ? "meio_aberto" : "aberto";
  }

  /** Lança CircuitOpenError se o disjuntor estiver aberto. */
  verificar(): void {
    if (this.estado === "aberto") {
      throw new CircuitOpenError(this.abertoAte - this.agora());
    }
  }

  registrarSucesso(): void {
    this.falhas = 0;
    this.abertoAte = 0;
  }

  registrarFalha(err: unknown): void {
    if (!contaComoFalha(err)) {
      // Resposta válida da API (404, 422): o serviço está de pé.
      this.registrarSucesso();
      return;
    }
    this.falhas += 1;

    // Chave inválida ou sem permissão desativa as ferramentas na hora:
    // insistir só queima requisição e atrasa o alerta.
    const authInvalida = err instanceof ApiError && (err.status === 401 || err.status === 403);
    if (authInvalida || this.falhas >= this.limiteFalhas) {
      this.abertoAte = this.agora() + this.cooldownMs;
    }
  }

  /** Para diagnóstico e logs. */
  resumo(): { estado: EstadoDisjuntor; falhas: number; reabreEmMs: number } {
    return {
      estado: this.estado,
      falhas: this.falhas,
      reabreEmMs: Math.max(0, this.abertoAte - this.agora()),
    };
  }
}
