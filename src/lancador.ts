import { spawnSync } from "child_process";

export interface Filho {
  on(evento: "exit", ouvinte: (codigo: number | null) => void): unknown;
}

export interface OpcoesManterVivo {
  esperaMs: number;
  /** A espera dobra a cada queda seguida até este teto (padrão: esperaMs, sem crescer). */
  esperaMaxMs?: number;
  /** No ar por pelo menos isto, a próxima queda volta à espera inicial. */
  estavelMs?: number;
  aoReiniciar?: (codigo: number | null, esperaMs?: number) => void;
  /** Falso: não religa (ex.: caiu antes de responder a primeira vez — o erro é de configuração). */
  deveReligar?: (codigo: number | null) => boolean;
  aoDesistir?: (codigo: number | null) => void;
}

/** Sobe o processo e o religa quando ele sai, até `parar()`. */
export function manterVivo<T extends Filho>(
  subir: () => T,
  opcoes: OpcoesManterVivo
): { atual: () => T; parar: () => void } {
  let parado = false;
  let atual: T;
  let espera = opcoes.esperaMs;
  const iniciar = () => {
    const subiuEm = Date.now();
    atual = subir();
    atual.on("exit", (codigo) => {
      if (parado) return;
      if (opcoes.deveReligar && !opcoes.deveReligar(codigo)) {
        parado = true;
        opcoes.aoDesistir?.(codigo);
        return;
      }
      if (Date.now() - subiuEm >= (opcoes.estavelMs ?? Infinity)) espera = opcoes.esperaMs;
      const agora = espera;
      espera = Math.min(espera * 2, opcoes.esperaMaxMs ?? opcoes.esperaMs);
      opcoes.aoReiniciar?.(codigo, agora);
      setTimeout(() => {
        if (!parado) iniciar();
      }, agora);
    });
  };
  iniciar();
  return {
    atual: () => atual,
    parar: () => {
      parado = true;
    },
  };
}

/** No Windows, kill() mata só o processo e deixa o Chrome do puppeteer órfão segurando o perfil da sessão. */
export function matarArvore(filho: { pid?: number; exitCode: number | null; kill(): boolean }): void {
  if (filho.pid === undefined || filho.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(filho.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    filho.kill();
  }
}
