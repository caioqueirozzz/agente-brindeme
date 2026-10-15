import { describe, it, expect } from "vitest";
import { addMessage, createInitialState } from "../src/agent/state.js";
import { formatarAvisoTransferencia, resumoDoEstado } from "../src/api/resumoAtendente.js";

const TEL = "5583999990000";

describe("aviso de transferência", () => {
  it("traz cliente, telefone completo, motivo, pergunta sem resposta, conversa e o comando de devolver", () => {
    const estado = createInitialState(TEL);
    estado.cliente = { nome: "Maria", tipo: "PJ" };
    estado.produtosDiscutidos = ["Caneca Branca"];
    estado.orcamentos = ["TESTE-1"];
    addMessage(estado, "user", "qual o horário?");
    addMessage(estado, "assistant", "Vou chamar alguém.");

    const texto = formatarAvisoTransferencia(TEL, resumoDoEstado(estado, "lacuna_conhecimento"), ["qual o horário de vocês?"]);

    expect(texto).toBe(
      [
        "🔔 *Transferência* — prioridade ALTA",
        `Cliente: Maria · PJ · ${TEL}`,
        "Motivo: lacuna_conhecimento",
        "Pergunta sem resposta: qual o horário de vocês?",
        "Produtos: Caneca Branca",
        "Orçamentos: TESTE-1",
        "",
        "Últimas mensagens:",
        "[cliente]: qual o horário?",
        "[agente]: Vou chamar alguém.",
        "",
        `Para devolver: #devolver ${TEL} [nota]`,
      ].join("\n")
    );
  });

  it("prioridade normal e cliente sem nome", () => {
    const resumo = { ...resumoDoEstado(createInitialState(TEL), "pedido_cliente", "quer falar com o dono"), prioridade: "normal" as const };
    const texto = formatarAvisoTransferencia(TEL, resumo);
    expect(texto.split("\n").slice(0, 3)).toEqual([
      "🔔 *Transferência*",
      `Cliente: sem nome · ${TEL}`,
      "Motivo: pedido_cliente — quer falar com o dono",
    ]);
  });
});
