import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Atendimento, interpretarComando, TEXTO_COMANDOS } from "../src/whatsapp/atendente.js";
import { Envio } from "../src/whatsapp/envio.js";
import { WhatsAppFalso } from "./helpers/whatsappFalso.js";
import { AgenteFalso } from "./helpers/agenteFalso.js";

const CLIENTE = "5583999990000@c.us";
const TEL = "5583999990000";

describe("interpretarComando", () => {
  it("texto sem # não é comando", () => {
    expect(interpretarComando("anotação qualquer")).toBeNull();
  });

  it("#devolver com e sem nota", () => {
    expect(interpretarComando("#devolver 5583999990000")).toEqual({ tipo: "devolver", telefone: TEL });
    expect(interpretarComando("  #Devolver 5583999990000   cliente já pagou ")).toEqual({
      tipo: "devolver",
      telefone: TEL,
      nota: "cliente já pagou",
    });
  });

  it("corrige o 9 e aceita +55", () => {
    expect(interpretarComando("#devolver 558399990000")).toEqual({ tipo: "devolver", telefone: TEL });
    expect(interpretarComando("#devolver +5583999990000")).toEqual({ tipo: "devolver", telefone: TEL });
  });

  it("número sem DDI, com espaço ou ausente → desconhecido", () => {
    expect(interpretarComando("#devolver 83999990000")).toEqual({ tipo: "desconhecido" });
    expect(interpretarComando("#devolver 55 83 99999-0000")).toEqual({ tipo: "desconhecido" });
    expect(interpretarComando("#devolver")).toEqual({ tipo: "desconhecido" });
    expect(interpretarComando("#ajuda")).toEqual({ tipo: "desconhecido" });
  });

  it("número com 0 de longa distância → desconhecido, nunca devolve outra conversa", () => {
    expect(interpretarComando("#devolver 083999990000")).toEqual({ tipo: "desconhecido" });
    expect(interpretarComando("#devolver 0558399990000")).toEqual({ tipo: "desconhecido" });
    expect(interpretarComando("#devolver 04183999990000")).toEqual({ tipo: "desconhecido" });
  });
});

describe("Atendimento", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function montar() {
    const canal = new WhatsAppFalso();
    const agente = new AgenteFalso();
    const envio = new Envio(canal, 20);
    const atendimento = new Atendimento(agente, envio);
    canal.aoMensagem((m) => {
      if (m.deMim) void atendimento.receberMinha(m);
    });
    return { canal, agente, envio, atendimento };
  }

  it("o eco de uma mensagem enviada pela ponte não vira atendente", async () => {
    const { agente, envio } = montar();
    const enviado = envio.paraCliente(TEL, CLIENTE, "Olá! Sou a Lia");
    await vi.runAllTimersAsync();
    expect(await enviado).toBe(true);
    expect(agente.eventos).toEqual([]);
  });

  it("mensagem que sai do número sem registro é do atendente", async () => {
    const { canal, agente, atendimento } = montar();
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    await atendimento.receberMinha(canal.mensagem({ chatId: CLIENTE, texto: "Oi, aqui é a Ana", deMim: true }));
    expect(agente.eventos).toEqual([
      {
        tipo: "mensagem_atendente",
        telefone: TEL,
        id: expect.any(String),
        texto: "Oi, aqui é a Ana",
        timestamp: "2026-10-16T10:00:00.000Z",
      },
    ]);
    expect(atendimento.ultimaDoAtendente(TEL)).toBe(Date.parse("2026-10-16T10:00:00Z"));
  });

  it("#devolver com nota devolve à IA e confirma em Mensagem para mim", async () => {
    const { canal, agente, atendimento } = montar();
    await atendimento.receberMinha(
      canal.mensagem({ chatId: canal.eu, texto: "#devolver 5583999990000 cliente já pagou", deMim: true, paraMim: true })
    );
    await vi.runAllTimersAsync();
    expect(agente.eventos).toEqual([{ tipo: "devolver", telefone: TEL, nota: "cliente já pagou" }]);
    expect(canal.enviadas).toEqual([{ chatId: canal.eu, texto: `✅ ${TEL} devolvido à IA` }]);
  });

  it("comando desconhecido responde a lista de comandos", async () => {
    const { canal, agente, atendimento } = montar();
    await atendimento.receberMinha(canal.mensagem({ chatId: canal.eu, texto: "#ajuda", deMim: true, paraMim: true }));
    await vi.runAllTimersAsync();
    expect(canal.enviadas).toEqual([{ chatId: canal.eu, texto: TEXTO_COMANDOS }]);
    expect(agente.eventos).toEqual([]);
  });

  it("anotação sem # em Mensagem para mim é ignorada", async () => {
    const { canal, agente, atendimento } = montar();
    await atendimento.receberMinha(canal.mensagem({ chatId: canal.eu, texto: "lembrar de ligar", deMim: true, paraMim: true }));
    await vi.runAllTimersAsync();
    expect(canal.enviadas).toEqual([]);
    expect(agente.eventos).toEqual([]);
  });

  it("reenviar sem nada pendente não trava os eventos seguintes", async () => {
    const { canal, agente, atendimento } = montar();
    await atendimento.reenviarEventos();
    await atendimento.receberMinha(canal.mensagem({ chatId: CLIENTE, texto: "assumi", deMim: true }));
    expect(agente.eventos.map((e) => e.tipo)).toEqual(["mensagem_atendente"]);
  });

  it("evento que falha fica pendente e sai na ordem quando o agente volta; o #devolver adiado confirma com ✅", async () => {
    const { canal, agente, atendimento } = montar();
    agente.eventosFalham = true;
    await atendimento.receberMinha(canal.mensagem({ chatId: CLIENTE, texto: "assumi", deMim: true }));
    await atendimento.receberMinha(
      canal.mensagem({ chatId: canal.eu, texto: "#devolver 5583999990000", deMim: true, paraMim: true })
    );
    await vi.runAllTimersAsync();
    expect(canal.enviadas.at(-1)?.texto).toMatch(/^⏳/);
    await atendimento.reenviarEventos();
    expect(atendimento.temPendente(TEL)).toBe(true);

    agente.eventosFalham = false;
    await atendimento.reenviarEventos();
    expect(agente.eventos.map((e) => e.tipo)).toEqual(["mensagem_atendente", "devolver"]);
    expect(atendimento.temPendente(TEL)).toBe(false);
    expect(atendimento.modo(TEL)).toBe("ia");
    expect(canal.enviadas.at(-1)).toEqual({ chatId: canal.eu, texto: `✅ ${TEL} devolvido à IA` });
  });

  it("evento recusado pelo agente (4xx) é descartado, com alerta em Mensagem para mim", async () => {
    const { canal, agente, atendimento } = montar();
    agente.eventosRecusados = true;
    await atendimento.receberMinha(canal.mensagem({ chatId: CLIENTE, texto: "assumi", deMim: true }));
    expect(atendimento.temPendente(TEL)).toBe(false);
    expect(atendimento.modo(TEL)).toBe("humano");
    expect(canal.enviadas).toEqual([
      { chatId: canal.eu, texto: `⚠️ O agente recusou o aviso "mensagem_atendente" da conversa ${TEL} (HTTP 400). Confira o terminal do agente.` },
    ]);
  });

  it("#devolver de número que o agente não conhece (404): diz para conferir o número", async () => {
    const { canal, agente, atendimento } = montar();
    agente.eventosRecusados = true;
    agente.statusRecusa = 404;
    await atendimento.receberMinha(
      canal.mensagem({ chatId: canal.eu, texto: "#devolver 5583999990001", deMim: true, paraMim: true })
    );
    expect(canal.enviadas).toEqual([
      {
        chatId: canal.eu,
        texto: "⚠️ #devolver 5583999990001: o agente não tem conversa com esse número. Confira o telefone (DDI + DDD + número, só dígitos).",
      },
    ]);
  });

  it("pendência de um telefone não segura o evento de outro", async () => {
    const { canal, agente, atendimento } = montar();
    const OUTRO = "5583888880000";
    agente.falhamPara.add(TEL);
    await atendimento.receberMinha(canal.mensagem({ chatId: CLIENTE, texto: "assumi", deMim: true }));
    await atendimento.receberMinha(canal.mensagem({ chatId: `${OUTRO}@c.us`, texto: "assumi também", deMim: true }));
    expect(atendimento.temPendente(TEL)).toBe(true);
    expect(atendimento.temPendente(OUTRO)).toBe(false);
    expect(agente.eventos.map((e) => e.telefone)).toEqual([OUTRO]);
  });

  it("chamadas simultâneas com o agente pendurado viram uma tentativa só", async () => {
    const { canal, agente, atendimento } = montar();
    let tentativas = 0;
    let liberar!: () => void;
    agente.enviarEvento = async () => {
      tentativas++;
      await new Promise<void>((r) => (liberar = r));
      return { tipo: "falha", motivo: "TimeoutError" };
    };
    void atendimento.receberMinha(canal.mensagem({ chatId: CLIENTE, texto: "assumi", deMim: true }));
    const chamadas = [atendimento.reenviarEventos(), atendimento.reenviarEventos(), atendimento.reenviarEventos()];
    await vi.advanceTimersByTimeAsync(0);
    liberar();
    await Promise.all(chamadas);
    expect(tentativas).toBe(1);
  });

  it("#devolver digitado na conversa do cliente devolve aquela conversa e não vira atendente", async () => {
    const { canal, agente, atendimento } = montar();
    atendimento.registrarModo(TEL, "humano");
    await atendimento.receberMinha(canal.mensagem({ chatId: CLIENTE, texto: "#devolver pode seguir", deMim: true }));
    await vi.runAllTimersAsync();
    expect(agente.eventos).toEqual([{ tipo: "devolver", telefone: TEL, nota: "pode seguir" }]);
    expect(atendimento.modo(TEL)).toBe("ia");
    expect(canal.enviadas.at(-1)?.texto).toBe(
      `✅ ${TEL} devolvido à IA (o comando foi digitado na conversa do cliente, e ele recebeu a mensagem)`
    );
  });

  it("começa com o estado salvo e avisa a cada mudança", async () => {
    const { canal, agente, envio } = montar();
    const mudancas: number[] = [];
    const pendente = { tipo: "mensagem_atendente" as const, telefone: TEL, id: "x", texto: "assumi", timestamp: "2026-10-14T12:00:00.000Z" };
    const atendimento = new Atendimento(agente, envio, () => {}, {
      inicial: { modos: { [TEL]: "humano" }, pendentes: [pendente] },
      aoMudar: () => mudancas.push(1),
    });
    expect(atendimento.modo(TEL)).toBe("humano");
    expect(atendimento.temPendente(TEL)).toBe(true);
    await atendimento.reenviarEventos();
    expect(agente.eventos).toEqual([pendente]);
    expect(atendimento.instantaneo()).toEqual({ modos: { [TEL]: "humano" }, pendentes: [] });
    expect(mudancas.length).toBeGreaterThan(0);
    void canal;
  });
});
