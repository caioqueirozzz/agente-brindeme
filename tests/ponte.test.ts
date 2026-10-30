import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { alertaAgenteFora, MSG_AUDIO, MSG_INSTABILIDADE, Ponte, type OpcoesPonte } from "../src/whatsapp/ponte.js";
import type { ResultadoLote } from "../src/whatsapp/agenteHttp.js";
import { LIMITE_TEXTO } from "../src/contrato/esquemas.js";
import { WhatsAppFalso } from "./helpers/whatsappFalso.js";
import { AgenteFalso } from "./helpers/agenteFalso.js";

const CLIENTE = "5583999990000@c.us";
const TEL = "5583999990000";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function montar(opcoes: Partial<OpcoesPonte> = {}) {
  const canal = new WhatsAppFalso();
  const agente = new AgenteFalso();
  const ponte = new Ponte(canal, agente, {
    artesDir: mkdtempSync(join(tmpdir(), "artes-")),
    liberados: [],
    lote: { silencioMs: 5_000, maxMs: 30_000, maxMensagens: 10 },
    avisoInstabilidadeMs: 600_000,
    enviosPorMinuto: 20,
    ...opcoes,
  });
  canal.aoMensagem((m) => void ponte.receber(m));
  return { canal, agente, ponte };
}

function segurar(agente: AgenteFalso): (r: ResultadoLote) => void {
  let liberar!: (r: ResultadoLote) => void;
  agente.roteiro.push(() => new Promise<ResultadoLote>((r) => (liberar = r)));
  return (r) => liberar(r);
}

describe("Ponte", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("do cliente até a resposta", () => {
    it("três mensagens picadas viram um lote; resposta sai e a conversa é marcada como lida", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi" }));
      await vi.advanceTimersByTimeAsync(1_000);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "quero canecas" }));
      await vi.advanceTimersByTimeAsync(1_000);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "para o natal" }));
      await vi.advanceTimersByTimeAsync(4_900);
      expect(agente.lotes).toHaveLength(0);
      await vi.runAllTimersAsync();

      expect(agente.lotes).toHaveLength(1);
      expect(agente.lotes[0].telefone).toBe(TEL);
      expect(agente.lotes[0].mensagens.map((m) => m.texto)).toEqual(["oi", "quero canecas", "para o natal"]);
      expect(canal.enviadas).toEqual([{ chatId: CLIENTE, texto: "olá" }]);
      expect(canal.lidas).toEqual([CLIENTE]);
      expect(agente.eventos).toEqual([]);
    });

    it("mensagem que chega durante o turno espera o próximo lote; só marca lida no fim", async () => {
      const { canal, agente, ponte } = montar();
      const liberar = segurar(agente);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "primeira" }));
      await vi.advanceTimersByTimeAsync(5_000);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "segunda" }));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(agente.lotes).toHaveLength(1);

      liberar({ tipo: "ok", resposta: { respostas: ["r1"], modo: "ia" } });
      await vi.runAllTimersAsync();

      expect(agente.lotes).toHaveLength(2);
      expect(agente.lotes[1].mensagens.map((m) => m.texto)).toEqual(["segunda"]);
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("409: pergunta de novo a cada 5s com o mesmo turnoId", async () => {
      const { canal, agente, ponte } = montar();
      agente.roteiro.push({ tipo: "em_andamento" }, { tipo: "em_andamento" });
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi" }));
      await vi.runAllTimersAsync();
      expect(agente.lotes).toHaveLength(3);
      expect(new Set(agente.lotes.map((l) => l.turnoId)).size).toBe(1);
      expect(canal.enviadas).toHaveLength(1);
    });

    it("409 por mais de 120s: desiste, não marca como lida e a varredura repete o mesmo turno", async () => {
      const { canal, agente, ponte } = montar();
      agente.padrao = { tipo: "em_andamento" };
      const msg = canal.mensagem({ chatId: CLIENTE, texto: "oi" });
      await ponte.receber(msg);
      await vi.runAllTimersAsync();
      expect(agente.lotes.length).toBeGreaterThanOrEqual(20);
      expect(canal.enviadas).toEqual([]);
      expect(canal.lidas).toEqual([]);

      agente.padrao = { tipo: "ok", resposta: { respostas: ["enfim"], modo: "ia" } };
      canal.naoLidas = [{ chatId: CLIENTE, mensagens: [msg] }];
      await ponte.varrer();
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([{ chatId: CLIENTE, texto: "enfim" }]);
      expect(agente.lotes.at(-1)?.turnoId).toBe(agente.lotes[0].turnoId);
    });

    it("agente fora por mais de 10 min: um aviso ao cliente e um alerta; volta normal depois", async () => {
      const { canal, agente, ponte } = montar();
      agente.padrao = { tipo: "falha", motivo: "http_503" };
      const msg = canal.mensagem({ chatId: CLIENTE, texto: "oi" });
      canal.naoLidas = [{ chatId: CLIENTE, mensagens: [msg] }];
      await ponte.receber(msg);
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([]);

      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(120_000);
        await ponte.varrer();
        await vi.runAllTimersAsync();
      }
      expect(canal.enviadas.filter((e) => e.chatId === CLIENTE).map((e) => e.texto)).toEqual([MSG_INSTABILIDADE]);
      expect(canal.enviadas.filter((e) => e.chatId === canal.eu).map((e) => e.texto)).toEqual([alertaAgenteFora(10)]);
      expect(canal.lidas).toEqual([]);
      expect(agente.eventos).toEqual([]);

      agente.padrao = { tipo: "ok", resposta: { respostas: ["voltei"], modo: "ia" } };
      await ponte.varrer();
      await vi.runAllTimersAsync();
      expect(canal.enviadas.at(-1)).toEqual({ chatId: CLIENTE, texto: "voltei" });
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("parte que não sai: na repetição pula as partes já enviadas", async () => {
      const { canal, agente, ponte } = montar();
      agente.padrao = { tipo: "ok", resposta: { respostas: ["parte 1", "parte 2", "parte 3"], modo: "ia" } };
      canal.falhar.set("parte 2", 2);
      const msg = canal.mensagem({ chatId: CLIENTE, texto: "oi" });
      await ponte.receber(msg);
      await vi.runAllTimersAsync();
      expect(canal.enviadas.map((e) => e.texto)).toEqual(["parte 1"]);
      expect(canal.lidas).toEqual([]);

      canal.naoLidas = [{ chatId: CLIENTE, mensagens: [msg] }];
      await ponte.varrer();
      await vi.runAllTimersAsync();
      expect(canal.enviadas.map((e) => e.texto)).toEqual(["parte 1", "parte 2", "parte 3"]);
      expect(agente.lotes[1].turnoId).toBe(agente.lotes[0].turnoId);
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("resposta em modo humano não marca como lida", async () => {
      const { canal, agente, ponte } = montar();
      agente.padrao = { tipo: "ok", resposta: { respostas: [], modo: "humano" } };
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi" }));
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([]);
      expect(canal.lidas).toEqual([]);
    });

    it("transferência: cliente recebe a resposta e o resumo vai para Mensagem para mim", async () => {
      const { canal, agente, ponte } = montar();
      agente.padrao = {
        tipo: "ok",
        resposta: { respostas: ["Vou te passar para a equipe."], avisoAtendente: "🔔 Transferência", modo: "humano" },
      };
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "quero falar com alguém" }));
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([
        { chatId: CLIENTE, texto: "Vou te passar para a equipe." },
        { chatId: canal.eu, texto: "🔔 Transferência" },
      ]);
      expect(agente.eventos).toEqual([]);
      expect(canal.lidas).toEqual([]);
    });
  });

  describe("atendente", () => {
    it("atendente escreveu durante o turno: a resposta da IA é descartada", async () => {
      const { canal, agente, ponte } = montar();
      const liberar = segurar(agente);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi" }));
      await vi.advanceTimersByTimeAsync(5_000);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "Oi! Aqui é a Ana", deMim: true }));
      liberar({ tipo: "ok", resposta: { respostas: ["resposta da IA"], modo: "ia" } });
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([]);
      expect(agente.eventos).toEqual([
        expect.objectContaining({ tipo: "mensagem_atendente", telefone: TEL, texto: "Oi! Aqui é a Ana" }),
      ]);
    });

    it("evento pendente segura o lote até o agente receber o evento", async () => {
      const { canal, agente, ponte } = montar();
      agente.eventosFalham = true;
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "assumi", deMim: true }));
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi?" }));
      await vi.runAllTimersAsync();
      expect(agente.lotes).toEqual([]);

      agente.eventosFalham = false;
      await ponte.varrer();
      expect(agente.eventos.map((e) => e.tipo)).toEqual(["mensagem_atendente"]);
    });
  });

  describe("tipos de mensagem", () => {
    // A resposta ao áudio espera o "digitando" (timer): avance o relógio antes de aguardar o receber.
    it("áudio: resposta fixa, não vai ao agente, marca como lida", async () => {
      const { canal, agente, ponte } = montar();
      const recebendo = ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "", tipo: "audio" }));
      await vi.runAllTimersAsync();
      await recebendo;
      expect(canal.enviadas).toEqual([{ chatId: CLIENTE, texto: MSG_AUDIO }]);
      expect(agente.lotes).toEqual([]);
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("áudio com lote pendente não marca como lida", async () => {
      const { canal, ponte } = montar();
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "quero orçamento" }));
      const recebendo = ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "", tipo: "audio" }));
      // "digitando" do aviso de áudio leva 2,55s; o lote só fecha aos 5s.
      await vi.advanceTimersByTimeAsync(4_000);
      await recebendo;
      expect(canal.enviadas).toEqual([{ chatId: CLIENTE, texto: MSG_AUDIO }]);
      expect(canal.lidas).toEqual([]);
      await vi.runAllTimersAsync();
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("figurinha e afins: ignorados e marcados como lidos", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "", tipo: "ignorada" }));
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([]);
      expect(agente.lotes).toEqual([]);
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("grupo e mensagem sem telefone resolvido são ignorados", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(canal.mensagem({ chatId: "1203630@g.us", texto: "oi", direta: false, telefone: null }));
      await ponte.receber(canal.mensagem({ chatId: "123@lid", texto: "oi", telefone: null }));
      await vi.runAllTimersAsync();
      expect(agente.lotes).toEqual([]);
      expect(canal.lidas).toEqual([]);
    });

    it("lista de liberados filtra pelo número normalizado", async () => {
      const { canal, agente, ponte } = montar({ liberados: ["558399990000"] });
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi" }));
      await ponte.receber(canal.mensagem({ chatId: "5583777770000@c.us", texto: "oi" }));
      await vi.runAllTimersAsync();
      expect(agente.lotes.map((l) => l.telefone)).toEqual([TEL]);
    });

    it("texto longo é cortado em 4.000 caracteres", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "x".repeat(5_000) }));
      await vi.runAllTimersAsync();
      expect(agente.lotes[0].mensagens[0].texto).toHaveLength(LIMITE_TEXTO);
    });

    it("arte aceita vai como arquivo; a legenda vai como texto", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(
        canal.mensagem({
          chatId: CLIENTE,
          texto: "essa é a logo",
          tipo: "midia",
          baixarMidia: async () => ({ mime: "image/png", base64: PNG, nome: "logo.png" }),
        })
      );
      await vi.runAllTimersAsync();
      const m = agente.lotes[0].mensagens[0];
      expect(m.texto).toBe("essa é a logo");
      expect(m.arquivo).toMatchObject({ mime: "image/png", nome: "logo.png" });
    });

    it("arte recusada ou que não baixa vira texto para o agente", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(
        canal.mensagem({
          chatId: CLIENTE,
          texto: "",
          tipo: "midia",
          baixarMidia: async () => ({ mime: "video/mp4", base64: PNG, nome: "video.mp4" }),
        })
      );
      await ponte.receber(
        canal.mensagem({
          chatId: CLIENTE,
          texto: "",
          tipo: "midia",
          baixarMidia: async () => {
            throw new Error("download falhou");
          },
        })
      );
      await vi.runAllTimersAsync();
      expect(agente.lotes[0].mensagens.map((m) => m.texto)).toEqual([
        "[arquivo recusado: video.mp4, formato video/mp4 não aceito (aceitos: PNG, JPG, SVG, PDF)]",
        "[arquivo recusado: arquivo, não chegou por falha nossa ao baixar; não é o formato]",
      ]);
      expect(agente.lotes[0].mensagens.every((m) => m.arquivo === undefined)).toBe(true);
    });

    it("recusa com legenda longa continua dentro do limite", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(
        canal.mensagem({
          chatId: CLIENTE,
          texto: "y".repeat(5_000),
          tipo: "midia",
          baixarMidia: async () => ({ mime: "video/mp4", base64: PNG }),
        })
      );
      await vi.runAllTimersAsync();
      expect(agente.lotes[0].mensagens[0].texto.length).toBeLessThanOrEqual(LIMITE_TEXTO);
    });
  });

  describe("varredura", () => {
    it("evento e varredura não duplicam a mesma mensagem", async () => {
      const { canal, agente, ponte } = montar();
      const msg = canal.mensagem({ chatId: CLIENTE, texto: "oi" });
      canal.naoLidas = [{ chatId: CLIENTE, mensagens: [msg] }];
      await ponte.receber(msg);
      await ponte.varrer();
      await vi.runAllTimersAsync();
      expect(agente.lotes).toHaveLength(1);
      expect(agente.lotes[0].mensagens).toHaveLength(1);
    });

    it("mensagem já respondida não volta a ir ao agente", async () => {
      const { canal, agente, ponte } = montar();
      const msg = canal.mensagem({ chatId: CLIENTE, texto: "oi" });
      await ponte.receber(msg);
      await vi.runAllTimersAsync();
      canal.naoLidas = [{ chatId: CLIENTE, mensagens: [msg] }];
      await ponte.varrer();
      await vi.runAllTimersAsync();
      expect(agente.lotes).toHaveLength(1);
    });

    it("varredura que falha não derruba a ponte", async () => {
      const { canal, ponte } = montar();
      canal.pendentes = async () => {
        throw new Error("página travada");
      };
      await expect(ponte.varrer()).resolves.toBeUndefined();
    });
  });
});
