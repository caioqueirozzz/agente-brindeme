/**
 * Homologação da Fase 6 — H4: transferência humana.
 * Todo caminho que deve levar o cliente a uma pessoa leva: pedido explícito, reclamação, falha da API,
 * falha do modelo, teto de tempo, limite de mensagens. Em modo humano a IA fica calada, e o #devolver
 * a traz de volta com o contexto.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MSG_FALHA, MSG_LIMITE } from "../../src/api/agenteDefinitivo.js";
import { MENSAGEM_TRANSFERENCIA, maskPhone } from "../../src/tools/transferirHumano.js";
import { TEL, endTurn, montarBancada, restaurarAmbiente, todosResultados, toolUse } from "./bancada.js";

afterEach(restaurarAmbiente);

describe("H4 — transferência humana", () => {
  it("H4.1 cliente pede atendente → modo humano, aviso completo à equipe, IA calada, #devolver traz a IA de volta", async () => {
    const b = await montarBancada();
    b.llm.roteiro(toolUse("buscar_produtos", { consulta: "caneca", quantidade: 50 }), endTurn("Temos canecas."));
    await b.enviar("quero 50 canecas");

    b.llm.roteiro(toolUse("transferir_humano", { motivo: "pedido_cliente", prioridade: "normal" }), endTurn("Vou te passar para alguém."));
    const r = await b.enviar("quero falar com uma pessoa");
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toMatch(/Transferência/);
    expect(r.avisoAtendente).toMatch(/Motivo: pedido_cliente/);
    expect(r.avisoAtendente).toMatch(/Produtos: Caneca de Porcelana Personalizada/);
    expect(r.avisoAtendente).toMatch(/quero falar com uma pessoa/);
    expect(r.avisoAtendente).toContain(`#devolver ${TEL}`);

    const chamadas = b.llm.chamadas.length;
    const calada = await b.enviar("alô?");
    expect(calada).toEqual({ respostas: [], modo: "humano" });
    expect(b.llm.chamadas.length).toBe(chamadas);

    await b.agente.processarEvento({ tipo: "devolver", telefone: TEL, nota: "cliente já recebeu o boleto" });
    b.llm.roteiro(endTurn("Oi de novo! Posso ajudar em algo mais?"));
    const volta = await b.enviar("obrigado");
    expect(volta.modo).toBe("ia");
    expect(JSON.stringify(b.llm.chamadas.at(-1)!.messages)).toContain("cliente já recebeu o boleto");
  });

  it("H4.2 reclamação vai com prioridade ALTA", async () => {
    const b = await montarBancada();
    b.llm.roteiro(
      toolUse("transferir_humano", { motivo: "reclamacao", prioridade: "alta", observacao: "caneca chegou quebrada" }),
      endTurn("Sinto muito! Já chamei alguém.")
    );
    const r = await b.enviar("a caneca chegou quebrada, que absurdo");
    expect(r.avisoAtendente).toMatch(/prioridade ALTA/);
    expect(r.avisoAtendente).toMatch(/caneca chegou quebrada/);
  });

  it("H4.3 duas falhas seguidas da API → transfere por falha_sistema mesmo se o modelo não obedecer", async () => {
    const b = await montarBancada();
    b.client.injectFault({ type: "500", remaining: 10 });
    b.llm.roteiro(
      toolUse("detalhar_produto", { produto_id: "prod-001" }),
      toolUse("detalhar_produto", { produto_id: "prod-001" }),
      endTurn("Vou tentar de novo daqui a pouco!")
    );
    const r = await b.enviar("me fala da caneca");
    const ultimos = todosResultados(b.llm);
    expect(ultimos[1]).toMatchObject({ instrucao: "transferir", motivo_sugerido: "falha_sistema" });
    expect(r.modo).toBe("humano");
    expect(r.respostas).toEqual([MENSAGEM_TRANSFERENCIA]);
    expect(r.avisoAtendente).toMatch(/Motivo: falha_sistema/);
  });

  it("H4.4 erro que exige ação imediata (412) transfere na primeira falha", async () => {
    const b = await montarBancada();
    b.client.injectFault({ type: "412", remaining: 1 });
    b.llm.roteiro(toolUse("detalhar_produto", { produto_id: "prod-001" }), endTurn("..."));
    const r = await b.enviar("me fala da caneca");
    expect(todosResultados(b.llm)[0]).toMatchObject({ instrucao: "transferir" });
    expect(r.modo).toBe("humano");
  });

  it("H4.5 o modelo falha duas vezes no mesmo lote → aviso de problema técnico e pessoa assume", async () => {
    const b = await montarBancada();
    b.llm.roteiro(new Error("OpenAI 500"), new Error("OpenAI 500"));
    // Como a ponte: 503 na 1ª, reenvia o mesmo lote.
    await expect(b.enviar("oi", { id: "falha-1" })).rejects.toThrow();
    const r = await b.enviar("oi", { id: "falha-1" });
    expect(r.respostas).toEqual([MSG_FALHA]);
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toMatch(/o modelo falhou duas vezes/);
    // A mensagem do cliente não se perde.
    expect(b.repo.carregar(TEL).estado.historico.filter((m) => m.content === "oi")).toHaveLength(1);
  });

  it("H4.6 turno que passa do teto de tempo → pessoa assume", async () => {
    const b = await montarBancada({ tetoMs: 50 });
    b.llm.atrasoMs = 300;
    const r = await b.enviar("oi");
    expect(r.respostas).toEqual([MSG_FALHA]);
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toMatch(/teto de tempo/);
  });

  it("H4.7 limite de respostas por hora → pessoa assume (proteção contra abuso e custo)", async () => {
    const b = await montarBancada({ respostasPorHora: 2 });
    b.llm.roteiro(endTurn("1"), endTurn("2"));
    await b.enviar("a");
    await b.enviar("b");
    const r = await b.enviar("c");
    expect(r.respostas).toEqual([MSG_LIMITE]);
    expect(r.modo).toBe("humano");
    expect(b.llm.chamadas).toHaveLength(2);
  });

  it("H4.8 atendente escreve enquanto a IA pensa → a resposta da IA é descartada", async () => {
    const b = await montarBancada();
    b.llm.atrasoMs = 200;
    b.llm.roteiro(endTurn("resposta atrasada da IA"));
    const turno = b.enviar("oi");
    await new Promise((r) => setTimeout(r, 50));
    await b.agente.processarEvento({
      tipo: "mensagem_atendente",
      telefone: TEL,
      id: "at-1",
      texto: "Oi, aqui é a Ana da loja",
      timestamp: new Date().toISOString(),
    });
    const r = await turno;
    expect(r.respostas).toEqual([]);
    expect(r.modo).toBe("humano");
  });

  it("H4.9 a transferência funciona com a API da loja fora do ar", async () => {
    const b = await montarBancada();
    b.client.injectFault({ type: "500", remaining: 50 });
    b.llm.roteiro(toolUse("transferir_humano", { motivo: "pedido_cliente", prioridade: "normal" }), endTurn("Já chamei."));
    const r = await b.enviar("atendente por favor");
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toMatch(/Transferência/);
  });

  it("H4.10 o resumo para a equipe mascara o telefone do cliente", async () => {
    const b = await montarBancada();
    b.llm.roteiro(toolUse("transferir_humano", { motivo: "pagamento", prioridade: "normal" }), endTurn("ok"));
    await b.enviar("quero pagar no boleto");
    const resumo = todosResultados(b.llm)[0].resumo_para_atendente as { telefone_cliente: string };
    expect(resumo.telefone_cliente).toBe("5583*****0000");
  });

  it("H4.11 [correção Fase 6] telefone curto no resumo não derruba a transferência", () => {
    // Antes: 6–7 dígitos → "*".repeat(negativo) → RangeError no meio da transferência; 8 dígitos saíam em claro.
    expect(maskPhone("1234567")).toBe("***");
    expect(maskPhone("12345678")).toBe("***");
    expect(maskPhone("8399990000")).toBe("8399**0000");
  });
});
