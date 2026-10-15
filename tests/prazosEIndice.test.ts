import { describe, it, expect } from "vitest";
import { conferirPrazos } from "../src/config.js";
import { arquivoIndicePadrao } from "../src/catalogo/indice.js";

describe("prazos do agente e da ponte", () => {
  it("teto do turno com folga abaixo do prazo da ponte passa", () => {
    expect(conferirPrazos(90_000, 120_000)).toBeNull();
  });

  it("teto do turno igual ou maior que o prazo da ponte é recusado com explicação", () => {
    expect(conferirPrazos(120_000, 120_000)).toMatch(/TURNO_TETO_MS.*AGENTE_TIMEOUT_MS/);
    expect(conferirPrazos(115_000, 120_000)).toMatch(/folga/);
  });
});

describe("arquivo padrão do índice do catálogo", () => {
  it("mock e API real nunca dividem o mesmo arquivo", () => {
    expect(arquivoIndicePadrao("http")).toMatch(/produtos-index\.json$/);
    expect(arquivoIndicePadrao("mock")).toMatch(/produtos-index-mock\.json$/);
  });
});
