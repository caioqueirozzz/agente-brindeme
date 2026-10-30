import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Ponte, type MensagemObservada } from "../src/whatsapp/ponte.js";
import { WhatsAppFalso } from "./helpers/whatsappFalso.js";
import { AgenteFalso } from "./helpers/agenteFalso.js";

const CLIENTE = "5583999990000@c.us";
const TEL = "5583999990000";

function montar() {
  const canal = new WhatsAppFalso();
  const agente = new AgenteFalso();
  const vistas: MensagemObservada[] = [];
  const atualizadas: string[] = [];
  const ponte = new Ponte(canal, agente, {
    artesDir: mkdtempSync(join(tmpdir(), "artes-")),
    liberados: [],
    lote: { silencioMs: 5_000, maxMs: 30_000, maxMensagens: 10 },
    avisoInstabilidadeMs: 600_000,
    enviosPorMinuto: 20,
    observador: { mensagem: (m) => vistas.push(m), conversaAtualizada: (t) => atualizadas.push(t) },
  });
  canal.aoMensagem((m) => void ponte.receber(m));
  return { canal, agente, ponte, vistas, atualizadas };
}

describe("Observador da ponte (CRM)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("separa cliente, resposta da IA e mensagem de atendente", async () => {
    const { canal, ponte, vistas, atualizadas } = montar();
    await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "quero canecas" }));
    await vi.runAllTimersAsync();
    // A resposta da IA ("olá", do AgenteFalso) volta como eco deMim
    await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "sou da equipe, já te ligo", deMim: true }));
    await vi.runAllTimersAsync();

    expect(vistas.map((v) => [v.autor, v.texto])).toEqual([
      ["CLIENTE", "quero canecas"],
      ["AGENTE", "olá"],
      ["ATENDENTE", "sou da equipe, já te ligo"],
    ]);
    expect(vistas.every((v) => v.telefone === TEL)).toBe(true);
    expect(atualizadas).toContain(TEL);
  });

  it("observar não muda a regra do atendente: mensagem humana ainda pausa a IA", async () => {
    const { canal, agente, ponte } = montar();
    await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi", deMim: true }));
    await vi.runAllTimersAsync();
    expect(agente.eventos.map((e) => e.tipo)).toEqual(["mensagem_atendente"]);
  });

  it("ignora 'Mensagem para mim' (comandos do chip)", async () => {
    const { canal, ponte, vistas } = montar();
    await ponte.receber(canal.mensagem({ chatId: canal.meuChatId(), texto: "#status", deMim: true, paraMim: true }));
    await vi.runAllTimersAsync();
    expect(vistas).toEqual([]);
  });
});
