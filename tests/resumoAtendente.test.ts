import { describe, it, expect } from "vitest";
import { addMessage, createInitialState } from "../src/agent/state.js";
import { formatarAvisoTransferencia, resumoDoEstado } from "../src/api/resumoAtendente.js";
const TEL = "5583999990000";

describe("aviso de transferência", () => {
  it("traz cliente, telefone completo, motivo, pergunta sem resposta, conversa e o comando de devolver", () => {
    const estado = createInitialState(TEL);
    estado.cliente = { nome: "Maria", tipo: "PJ" };
    estado.produtosDiscutidos = ["Caneca Branca"];
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
        "",
        "Últimas mensagens:",
        "[cliente]: qual o horário?",
        "[agente]: Vou chamar alguém.",
        "",
        `Para devolver: #devolver ${TEL} [nota]`,
      ].join("\n")
    );
  });

  it("com a estimativa confirmada, mostra a ficha para o atendente emitir o orçamento", () => {
    const estado = createInitialState(TEL);
    estado.fichaPedido = {
      mensagemDoResumo: "x",
      resumo: {
        tipo: "PJ",
        nome: "Empresa Demo",
        email: "compras@demo.test",
        telefone: TEL,
        itens: [{ subproduto_id: "s1", cor: "Branco", nome_produto: "Caneca", quantidade: 50, preco_unitario: 18.9, subtotal: 945 }],
        total_estimado: 945,
        prazo_desejado: "até 10/12",
        personalizacao: "tem arte, 2 cores",
        arte_refs: [],
      },
    };
    const texto = formatarAvisoTransferencia(TEL, resumoDoEstado(estado, "orcamento_para_emitir"));
    expect(texto).toContain("📋 *Orçamento para emitir*");
    expect(texto).toContain("PJ · Empresa Demo · compras@demo.test");
    expect(texto).toMatch(/50× Caneca \(Branco\) — R\$\s?18,90 cada = R\$\s?945,00/);
    expect(texto).toMatch(/Total estimado: R\$\s?945,00/);
    expect(texto).toContain("Prazo desejado: até 10/12");
    expect(texto).toContain("Personalização: tem arte, 2 cores");
    expect(texto).toMatch(/frete e prazo a equipe confirma/);
  });

  it("[#26] no orçamento para emitir, o cabeçalho não traz o texto do modelo nem a lista de produtos discutidos", () => {
    const estado = createInitialState(TEL);
    estado.produtosDiscutidos = ["uuid-xicara", "uuid-vidro", "uuid-caneca"];
    estado.fichaPedido = {
      mensagemDoResumo: "x",
      resumo: {
        tipo: "PJ",
        nome: "Empresa Teste",
        email: "teste@empresa.test",
        telefone: TEL,
        itens: [{ subproduto_id: "s1", cor: "Branco", nome_produto: "Xícara com Pires", quantidade: 100, preco_unitario: 7.8, subtotal: 780 }],
        total_estimado: 780,
        arte_refs: [],
      },
    };
    const texto = formatarAvisoTransferencia(
      TEL,
      resumoDoEstado(estado, "orcamento_para_emitir", "Emitir orçamento para 100 canecas brancas")
    );
    expect(texto.split("\n")[2]).toBe("Motivo: orcamento_para_emitir");
    expect(texto).not.toMatch(/^Produtos:/m);
    // O que o modelo anotou não se perde: vai depois da ficha, marcado para conferir com ela.
    const linhas = texto.split("\n");
    const nota = linhas.indexOf("Nota do agente (confira com a ficha): Emitir orçamento para 100 canecas brancas");
    expect(nota).toBeGreaterThan(linhas.indexOf("📋 *Orçamento para emitir*"));
  });

  it("[#26] produtos discutidos saem pelo nome; id sem nome conhecido fica como está", () => {
    const estado = createInitialState(TEL);
    estado.produtosDiscutidos = ["p1", "p2", "p3"];
    estado.ultimasOpcoes = [{ id: "p1", nome: "Caneca Cerâmica 330ml" }];
    estado.produtosDetalhados = [{ id: "p2", nome: "Garrafa Térmica", cores: [] }];
    const texto = formatarAvisoTransferencia(TEL, resumoDoEstado(estado, "desconto"));
    expect(texto).toContain("Produtos: Caneca Cerâmica 330ml, Garrafa Térmica, p3");
  });

  it("resumo gravado antes de produtos_nomes existir ainda formata (deploy no meio de uma transferência)", () => {
    const { produtos_nomes: _, ...antigo } = resumoDoEstado(
      Object.assign(createInitialState(TEL), { produtosDiscutidos: ["prod-x"] }),
      "pedido_cliente"
    );
    const texto = formatarAvisoTransferencia(TEL, antigo as ReturnType<typeof resumoDoEstado>);
    expect(texto).toContain("Produtos: prod-x");
  });

  it("[#26] últimas mensagens saem formatadas para o WhatsApp, sem Markdown cru", () => {
    const estado = createInitialState(TEL);
    addMessage(estado, "assistant", "### Estimativa\n**Xícara** por R$ 7,80");
    const texto = formatarAvisoTransferencia(TEL, resumoDoEstado(estado, "outro"));
    expect(texto).toContain("[agente]: *Estimativa*\n*Xícara* por R$ 7,80");
    expect(texto).not.toMatch(/###|\*\*/);
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
