import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { manterVivo } from "../src/lancador.js";

class FilhoFalso extends EventEmitter {
  constructor(public readonly numero: number) {
    super();
  }
  sair(codigo: number) {
    this.emit("exit", codigo);
  }
}

describe("manterVivo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("religa o processo que caiu depois da espera, e a ponte não é derrubada", async () => {
    let n = 0;
    const subidos: FilhoFalso[] = [];
    const avisos: Array<number | null> = [];
    const vivo = manterVivo(() => {
      const f = new FilhoFalso(++n);
      subidos.push(f);
      return f;
    }, { esperaMs: 5_000, aoReiniciar: (c) => avisos.push(c) });

    subidos[0].sair(1);
    expect(avisos).toEqual([1]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(subidos).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(subidos).toHaveLength(2);
    expect(vivo.atual().numero).toBe(2);
  });

  it("depois de parar, não religa mais", async () => {
    const subidos: FilhoFalso[] = [];
    const vivo = manterVivo(() => {
      const f = new FilhoFalso(subidos.length + 1);
      subidos.push(f);
      return f;
    }, { esperaMs: 5_000 });
    vivo.parar();
    subidos[0].sair(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(subidos).toHaveLength(1);
  });
});

describe("manterVivo — religação com espera crescente", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function subidor() {
    const subidos: FilhoFalso[] = [];
    const subir = () => {
      const f = new FilhoFalso(subidos.length + 1);
      subidos.push(f);
      return f;
    };
    return { subidos, subir };
  }

  it("cai seguido: a espera dobra até o teto; depois de ficar no ar, volta à espera inicial", async () => {
    const { subidos, subir } = subidor();
    const esperas: number[] = [];
    manterVivo(subir, { esperaMs: 5_000, esperaMaxMs: 20_000, estavelMs: 60_000, aoReiniciar: (_c, ms) => esperas.push(ms!) });
    for (let i = 0; i < 4; i++) {
      subidos.at(-1)!.sair(1);
      await vi.advanceTimersByTimeAsync(esperas.at(-1)!);
    }
    expect(esperas).toEqual([5_000, 10_000, 20_000, 20_000]);
    await vi.advanceTimersByTimeAsync(60_000);
    subidos.at(-1)!.sair(1);
    expect(esperas.at(-1)).toBe(5_000);
  });

  it("deveReligar falso: desiste, avisa e não sobe de novo", async () => {
    const { subidos, subir } = subidor();
    const desistiu: Array<number | null> = [];
    manterVivo(subir, { esperaMs: 5_000, deveReligar: () => false, aoDesistir: (c) => desistiu.push(c) });
    subidos[0].sair(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(subidos).toHaveLength(1);
    expect(desistiu).toEqual([1]);
  });
});
