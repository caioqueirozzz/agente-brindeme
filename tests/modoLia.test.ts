import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Ponte } from "../src/whatsapp/ponte.js";
import { ArquivoModoLia, configLiaPadrao, iaAtende, telefoneDeTeste, validarConfigLia } from "../src/whatsapp/modoLia.js";
import { WhatsAppFalso } from "./helpers/whatsappFalso.js";
import { AgenteFalso } from "./helpers/agenteFalso.js";

const TESTE = "5583999990000";
const OUTRO = "5583777770000";

function montar() {
  const canal = new WhatsAppFalso();
  const agente = new AgenteFalso();
  const ponte = new Ponte(canal, agente, {
    artesDir: mkdtempSync(join(tmpdir(), "artes-")),
    liberados: [],
    lote: { silencioMs: 5_000, maxMs: 30_000, maxMensagens: 10 },
    avisoInstabilidadeMs: 600_000,
    enviosPorMinuto: 20,
  });
  return { canal, agente, ponte };
}

describe("modo da Lia", () => {
  it("número digitado no CRM vira o formato da ponte", () => {
    expect(telefoneDeTeste("(83) 99999-0000")).toBe(TESTE);
    expect(telefoneDeTeste("+55 83 9999-0000")).toBe(TESTE);
    expect(telefoneDeTeste("123")).toBeNull();
  });

  it("valida o que vem do CRM", () => {
    expect(validarConfigLia({ modo: "teste", numerosTeste: ["83999990000", "(83) 99999-0000"] })).toEqual({ modo: "teste", numerosTeste: [TESTE] });
    expect(validarConfigLia({ modo: "teste", numerosTeste: [] })).toMatch(/pelo menos um/);
    expect(validarConfigLia({ modo: "turbo" })).toMatch(/modo/);
    expect(validarConfigLia({ modo: "ligada", numerosTeste: ["abc"] })).toMatch(/inválido/);
  });

  it("ligada atende todos, teste só a lista, desligada ninguém", () => {
    expect(iaAtende({ modo: "ligada", numerosTeste: [], atualizadoEm: null }, OUTRO)).toBe(true);
    expect(iaAtende({ modo: "teste", numerosTeste: [TESTE], atualizadoEm: null }, TESTE)).toBe(true);
    expect(iaAtende({ modo: "teste", numerosTeste: [TESTE], atualizadoEm: null }, OUTRO)).toBe(false);
    expect(iaAtende({ modo: "desligada", numerosTeste: [TESTE], atualizadoEm: null }, TESTE)).toBe(false);
  });

  it("sem arquivo, WHATSAPP_LIBERADOS vira modo teste; arquivo salvo prevalece", () => {
    const arquivo = join(mkdtempSync(join(tmpdir(), "lia-")), "lia-modo.json");
    const armazem = new ArquivoModoLia(arquivo, configLiaPadrao(["558399990000"]));
    expect(armazem.ler()).toMatchObject({ modo: "teste", numerosTeste: [TESTE] });
    armazem.salvar({ modo: "desligada", numerosTeste: [TESTE] });
    expect(armazem.ler()).toMatchObject({ modo: "desligada", numerosTeste: [TESTE] });
    writeFileSync(arquivo, "{quebrado");
    expect(armazem.ler().modo).toBe("teste");
    expect(configLiaPadrao([]).modo).toBe("ligada");
  });

  describe("na ponte", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("troca de modo vale para a próxima mensagem, sem reiniciar", async () => {
      const { canal, agente, ponte } = montar();
      ponte.definirModoLia({ modo: "teste", numerosTeste: [TESTE], atualizadoEm: null });
      await ponte.receber(canal.mensagem({ chatId: `${TESTE}@c.us`, texto: "oi" }));
      await ponte.receber(canal.mensagem({ chatId: `${OUTRO}@c.us`, texto: "oi" }));
      await vi.runAllTimersAsync();
      expect(agente.lotes.map((l) => l.telefone)).toEqual([TESTE]);

      ponte.definirModoLia({ modo: "desligada", numerosTeste: [TESTE], atualizadoEm: null });
      await ponte.receber(canal.mensagem({ chatId: `${TESTE}@c.us`, texto: "de novo" }));
      await vi.runAllTimersAsync();
      expect(agente.lotes).toHaveLength(1);

      ponte.definirModoLia({ modo: "ligada", numerosTeste: [], atualizadoEm: null });
      await ponte.receber(canal.mensagem({ chatId: `${OUTRO}@c.us`, texto: "e agora?" }));
      await vi.runAllTimersAsync();
      expect(agente.lotes.map((l) => l.telefone)).toEqual([TESTE, OUTRO]);
    });
  });
});
