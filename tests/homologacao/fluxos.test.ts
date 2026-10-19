/**
 * Homologação da Fase 6 — H1: fluxos completos.
 * A conversa passa pelo AgenteDefinitivo (o mesmo da produção), com as ferramentas e a API de mock reais;
 * só o modelo é roteirizado. Cada teste é uma jornada de cliente do roteiro de homologação (docs/fase-6).
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TEL,
  endTurn,
  montarBancada,
  restaurarAmbiente,
  resultados,
  todosResultados,
  tokenDoPrompt,
  toolUse,
} from "./bancada.js";

afterEach(restaurarAmbiente);

describe("H1 — fluxos completos", () => {
  it("H1.1 jornada de orçamento: saudação → recomendação → detalhe → resumo → confirmação → orçamento criado", async () => {
    const b = await montarBancada();

    b.llm.roteiro(endTurn("Olá! Sou a Lia, assistente virtual. Para qual ocasião é o brinde?"));
    const r1 = await b.enviar("oi");
    expect(r1.respostas[0]).toMatch(/assistente virtual/);

    b.llm.roteiro(
      toolUse("buscar_produtos", { consulta: "caneca", quantidade: 50, ocasiao: "natal" }),
      (c) => {
        const busca = resultados(c)[0] as { resultado: string; produtos: Array<{ id: string; preco_unitario_na_quantidade: number }> };
        expect(busca.resultado).toBe("produtos_encontrados");
        const caneca = busca.produtos.find((p) => p.id === "prod-001")!;
        return endTurn(`A Caneca de Porcelana sai por R$ ${caneca.preco_unitario_na_quantidade} cada em 50 unidades.`);
      }
    );
    const r2 = await b.enviar("quero 50 canecas para o natal da empresa");
    expect(r2.respostas.join(" ")).toContain("18.9");

    b.llm.roteiro(
      toolUse("detalhar_produto", { produto_id: "prod-001", quantidade: 50 }),
      endTurn("Temos branca e preta.")
    );
    await b.enviar("quais cores?");

    b.llm.roteiro(
      toolUse("preparar_orcamento", {
        tipo: "PJ",
        nome: "Empresa Teste Ltda",
        email: "compras@empresa.com",
        itens: [{ subproduto_id: "sub-001-branco", quantidade: 50 }],
      }),
      (c) => {
        const prep = resultados(c)[0] as { status: string; resumo: { total_estimado: number; telefone: string } };
        expect(prep.status).toBe("resumo_pronto");
        expect(prep.resumo.total_estimado).toBe(945);
        expect(prep.resumo.telefone).toBe(TEL);
        return endTurn("Resumo: 50 canecas brancas, total estimado R$ 945,00. Posso criar?");
      }
    );
    const r4 = await b.enviar("branca. Empresa Teste Ltda, PJ, compras@empresa.com");
    expect(r4.respostas.join(" ")).toMatch(/Posso criar/);

    b.llm.roteiro(
      (c) => toolUse("criar_orcamento", { token_confirmacao: tokenDoPrompt(c.system) }),
      (c) => {
        const criado = resultados(c)[0] as { status: string; codigo: string };
        expect(criado.status).toBe("criado");
        return endTurn(`Pronto! Orçamento ${criado.codigo} criado.`);
      }
    );
    const r5 = await b.enviar("pode criar");
    expect(r5.respostas.join(" ")).toMatch(/ORC-\d+/);

    const conversa = b.repo.carregar(TEL);
    expect(conversa.estado.orcamentos).toHaveLength(1);
    expect(conversa.estado.orcamentoPendente).toBeUndefined();
    expect(conversa.estado.cliente).toMatchObject({ tipo: "PJ", nome: "Empresa Teste Ltda" });
    expect(conversa.estado.modo).toBe("ia");
    expect(b.llm.pendentes()).toBe(0);
  });

  it("H1.2 arte enviada pelo WhatsApp entra no orçamento como referência", async () => {
    const b = await montarBancada();
    const arquivo = { nome: "logo.png", caminho: "data/artes/5583999990000/logo.png", mime: "image/png", bytes: 20480 };

    b.llm.roteiro(
      toolUse("registrar_arte", { descricao_arquivo: "logo.png", posicao: "frente" }),
      endTurn("Arte registrada!")
    );
    await b.enviar("segue o logo", { arquivo });

    b.llm.roteiro(
      toolUse("detalhar_produto", { produto_id: "prod-001" }),
      toolUse("preparar_orcamento", {
        tipo: "PF",
        nome: "Maria Souza",
        email: "maria@teste.com",
        itens: [{ subproduto_id: "sub-001-preto", quantidade: 100 }],
      }),
      endTurn("Resumo pronto.")
    );
    await b.enviar("100 canecas pretas, Maria Souza, maria@teste.com");

    const conversa = b.repo.carregar(TEL);
    const pendente = conversa.estado.orcamentoPendente!;
    expect(pendente.resumo.arte_refs).toHaveLength(1);
    expect(pendente.body.comments).toContain(pendente.resumo.arte_refs[0]);
    // 100 pretas: faixa 100–499 da cor preta = 16,40 (a branca seria 15,40).
    expect(pendente.resumo.total_estimado).toBe(1640);
  });

  it("H1.3 status de pedido do próprio cliente: só status, prazo e entrega", async () => {
    const b = await montarBancada();
    b.llm.roteiro(toolUse("consultar_pedido", { codigo: "PED-2024-001" }), endTurn("Seu pedido está em produção."));
    await b.enviar("como está o pedido PED-2024-001?");

    const pedido = todosResultados(b.llm)[0];
    expect(pedido.resultado).toBe("encontrado");
    expect(Object.keys(pedido).sort()).toEqual(
      ["codigo", "prazo_entrega", "resultado", "status", "status_conhecido", "status_frase", "tipo_entrega"].sort()
    );
  });

  it("H1.4 dúvida coberta pela base aprovada responde com o item da base, sem transferir", async () => {
    const b = await montarBancada();
    b.llm.roteiro(
      toolUse("consultar_conhecimento", { pergunta: "vocês entregam em todo o Brasil?" }),
      (c) => {
        const kb = resultados(c)[0] as { resultado: string; itens: Array<{ id: string }> };
        expect(kb.resultado).toBe("encontrado");
        expect(kb.itens.map((i) => i.id)).toContain("entrega-brasil");
        return endTurn("Sim, entregamos para todo o Brasil.");
      }
    );
    const r = await b.enviar("vocês entregam em todo o Brasil?");
    expect(r.modo).toBe("ia");
    expect(r.avisoAtendente).toBeUndefined();
  });

  it("H1.5 o agente reinicia entre o resumo e a confirmação: o 'pode criar' ainda funciona", async () => {
    const dir = mkdtempSync(join(tmpdir(), "homolog-reinicio-"));
    const antes = await montarBancada({ repoDir: dir });
    antes.llm.roteiro(
      toolUse("detalhar_produto", { produto_id: "prod-003" }),
      toolUse("preparar_orcamento", {
        tipo: "PF",
        nome: "Carlos Lima",
        email: "carlos@teste.com",
        itens: [{ subproduto_id: "sub-003-preta", quantidade: 30 }],
      }),
      endTurn("Resumo: 30 garrafas pretas. Confirma?")
    );
    await antes.enviar("30 garrafas térmicas pretas, Carlos Lima, carlos@teste.com");

    // Processo novo, mesmo disco: a conversa volta do arquivo.
    const depois = await montarBancada({ repoDir: dir });
    depois.llm.roteiro(
      (c) => toolUse("criar_orcamento", { token_confirmacao: tokenDoPrompt(c.system) }),
      (c) => endTurn(`Criado: ${(resultados(c)[0] as { codigo: string }).codigo}`)
    );
    const r = await depois.enviar("confirmo");
    expect(r.respostas.join(" ")).toMatch(/ORC-\d+/);
    expect(depois.repo.carregar(TEL).estado.orcamentos).toHaveLength(1);
  });

  it("H1.6 mesma mensagem reenviada pela ponte (mesmo turnoId) não roda o modelo de novo", async () => {
    const b = await montarBancada();
    b.llm.roteiro(endTurn("Olá!"));
    const a = await b.enviar("oi", { id: "dup-1" });
    const chamadas = b.llm.chamadas.length;
    const c = await b.enviar("oi", { id: "dup-1" });
    expect(c).toEqual(a);
    expect(b.llm.chamadas.length).toBe(chamadas);
  });
});
