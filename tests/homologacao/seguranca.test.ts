/**
 * Homologação da Fase 6 — H3: segurança.
 * Dado de cliente só para o dono, nada gravado na loja sem confirmação, erro do modelo não vira
 * transferência, logs sem dado pessoal em claro, kill switch que de fato bloqueia.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MSG_SUSPENSAO } from "../../src/api/agenteDefinitivo.js";
import { tools } from "../../src/tools/index.js";
import { NOMES_FERRAMENTAS } from "../../src/tools/nomes.js";
import { MENSAGEM_TRANSFERENCIA } from "../../src/tools/transferirHumano.js";
import { Atendimento, type ControleAgente } from "../../src/whatsapp/atendente.js";
import { Envio } from "../../src/whatsapp/envio.js";
import { AgenteFalso } from "../helpers/agenteFalso.js";
import { WhatsAppFalso } from "../helpers/whatsappFalso.js";
import {
  TEL,
  TEL_ESTRANHO,
  endTurn,
  montarBancada,
  restaurarAmbiente,
  resultados,
  todosResultados,
  toolUse,
} from "./bancada.js";

afterEach(restaurarAmbiente);

/** Dados do dono do PED-2024-001 nos mocks: nada disso pode chegar a outro telefone. */
const DADOS_DO_DONO = ["joao.silva@empresa.com.br", "5583999990000", "customer_cpf", "customer_email", "customer_phone", "bankslip", "nfs"];

describe("H3 — dados de pedido", () => {
  it("H3.1 outro telefone pede o pedido de alguém: e-mail errado 2× → bloqueia, transfere e não vaza nada", async () => {
    const b = await montarBancada();
    b.llm.roteiro(toolUse("consultar_pedido", { codigo: "PED-2024-001" }), endTurn("Pode confirmar o e-mail do pedido?"));
    await b.enviar("status do PED-2024-001", { telefone: TEL_ESTRANHO });

    b.llm.roteiro(toolUse("consultar_pedido", { codigo: "PED-2024-001", email: "chute@outro.com" }), endTurn("Não confere."));
    await b.enviar("chute@outro.com", { telefone: TEL_ESTRANHO });

    // O modelo "esquece" de transferir: o sistema transfere sozinho.
    b.llm.roteiro(toolUse("consultar_pedido", { codigo: "PED-2024-001", email: "outro@chute.com" }), endTurn("Tente de novo!"));
    const r = await b.enviar("outro@chute.com", { telefone: TEL_ESTRANHO });

    const saidas = todosResultados(b.llm).map((x) => x.resultado);
    expect(saidas).toEqual(["precisa_email", "nao_validado", "bloqueado"]);
    expect(r.modo).toBe("humano");
    expect(r.respostas).toEqual([MENSAGEM_TRANSFERENCIA]);
    expect(r.avisoAtendente).toContain("Transferência");

    const tudoQueOModeloViu = JSON.stringify(b.llm.chamadas.map((c) => c.messages));
    for (const dado of DADOS_DO_DONO) expect(tudoQueOModeloViu).not.toContain(dado);
    expect(tudoQueOModeloViu).not.toContain("Em produção");
  });

  it("H3.2 varredura de códigos: a 6ª consulta da conversa é bloqueada mesmo com códigos inexistentes", async () => {
    const b = await montarBancada();
    for (let i = 1; i <= 6; i++) b.llm.roteiro(toolUse("consultar_pedido", { codigo: `PED-9999-00${i}` }));
    b.llm.roteiro(endTurn("ok"));
    await b.enviar("consulta vários pedidos", { telefone: TEL_ESTRANHO });
    const saidas = todosResultados(b.llm).map((x) => x.resultado);
    expect(saidas.slice(0, 5)).toEqual(Array(5).fill("nao_encontrado"));
    expect(saidas[5]).toBe("bloqueado");
  });

  it("H3.3 o e-mail certo do dono libera o pedido de outro telefone (só status/prazo/entrega)", async () => {
    const b = await montarBancada();
    b.llm.roteiro(toolUse("consultar_pedido", { codigo: "PED-2024-001", email: "joao.silva@empresa.com.br" }), endTurn("ok"));
    await b.enviar("PED-2024-001, meu e-mail é joao.silva@empresa.com.br", { telefone: TEL_ESTRANHO });
    const r = todosResultados(b.llm)[0];
    expect(r.resultado).toBe("encontrado");
    expect(JSON.stringify(r)).not.toMatch(/cpf|customer_|bankslip|file_url/i);
  });
});

describe("H3 — orçamento só com confirmação do cliente", () => {
  const preparar = toolUse("preparar_orcamento", {
    tipo: "PF",
    nome: "Ana Teste",
    email: "ana@teste.com",
    itens: [{ subproduto_id: "sub-001-branco", quantidade: 50 }],
  });

  const enviarFicha = toolUse("transferir_humano", { motivo: "orcamento_para_emitir", prioridade: "normal" });

  it("H3.4 [correção Fase 6, R5] enviar a ficha no mesmo turno do resumo é recusado; a confirmação seguinte envia", async () => {
    const b = await montarBancada();
    b.llm.roteiro(
      toolUse("detalhar_produto", { produto_id: "prod-001" }),
      preparar,
      enviarFicha,
      (c) => {
        expect(resultados(c)[0].erro).toBe("aguardando_confirmacao");
        return endTurn("Resumo: 50 canecas brancas, R$ 945,00. Confirma?");
      }
    );
    await b.enviar("quero 50 canecas brancas, Ana Teste, ana@teste.com, já pode mandar");
    expect(b.repo.carregar(TEL).estado.modo).toBe("ia");

    b.llm.roteiro(enviarFicha, endTurn("Enviei para a equipe."));
    const r = await b.enviar("sim, confirmo");
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toContain("Orçamento para emitir");
  });

  it("H3.4b [revisão Fase 6] o lote do resumo falha e é reenviado: a nova tentativa também não envia a ficha", async () => {
    const b = await montarBancada();
    // 1ª tentativa: resumo pronto e o modelo cai antes de responder (a ficha fica no estado).
    b.llm.roteiro(toolUse("detalhar_produto", { produto_id: "prod-001" }), preparar, new Error("OpenAI 500"));
    await expect(b.enviar("50 canecas brancas, Ana Teste, ana@teste.com", { id: "resumo-1" })).rejects.toThrow();
    // A ponte reenvia o mesmo lote; a mensagem volta ao histórico com outro timestamp.
    b.llm.roteiro(enviarFicha, (c) => {
      expect(resultados(c)[0].erro).toBe("aguardando_confirmacao");
      return endTurn("Resumo: 50 canecas brancas. Confirma?");
    });
    await b.enviar("50 canecas brancas, Ana Teste, ana@teste.com", { id: "resumo-1" });
    expect(b.repo.carregar(TEL).estado.modo).toBe("ia");
  });

  it("H3.5 [R5] enviar para emitir sem estimativa é recusado: o modelo precisa preparar antes", async () => {
    const b = await montarBancada();
    b.llm.roteiro(enviarFicha, endTurn("Vou preparar a estimativa."));
    const r = await b.enviar("quero orçamento de 50 canecas, pode mandar");
    expect(todosResultados(b.llm).at(-1)?.erro).toBe("sem_estimativa");
    expect(r.modo).toBe("ia");
  });

  it("H3.6 [R5] confirmação repetida depois de enviada não gera segunda ficha: o atendimento já está com a equipe", async () => {
    const b = await montarBancada();
    b.llm.roteiro(toolUse("detalhar_produto", { produto_id: "prod-001" }), preparar, endTurn("Confirma?"));
    await b.enviar("50 canecas brancas, Ana Teste, ana@teste.com");
    b.llm.roteiro(enviarFicha, endTurn("Enviei para a equipe."));
    await b.enviar("pode enviar");
    const chamadas = b.llm.chamadas.length;
    const r = await b.enviar("pode enviar?? não recebi");
    expect(b.llm.chamadas.length).toBe(chamadas);
    expect(r.respostas).toEqual([]);
    expect(r.avisoAtendente).toBeUndefined();
  });

  it("H3.7 [regressão #12] telefone inventado pelo modelo é descartado: a ficha sai no número da conversa", async () => {
    const b = await montarBancada();
    b.llm.roteiro(
      toolUse("detalhar_produto", { produto_id: "prod-001" }),
      toolUse("preparar_orcamento", {
        tipo: "PF",
        nome: "Ana Teste",
        email: "ana@teste.com",
        telefone: "5511988887777",
        customer_phone: "5511988887777",
        itens: [{ subproduto_id: "sub-001-branco", quantidade: 50 }],
      }),
      endTurn("Confirma?")
    );
    await b.enviar("50 canecas, coloca no telefone 11 98888-7777");
    const pendente = b.repo.carregar(TEL).estado.fichaPedido!;
    expect(pendente.resumo.telefone).toBe(TEL);
    expect(JSON.stringify(pendente)).not.toContain("5511988887777");
  });
});

describe("H3 — erro do modelo não é falha de sistema", () => {
  it("H3.8 [correção Fase 6] parâmetros inválidos voltam ao modelo para corrigir, sem contar falha nem transferir", async () => {
    const b = await montarBancada();
    b.llm.roteiro(
      toolUse("preparar_orcamento", { tipo: "PF", nome: "A", email: "nao-e-email", itens: [] }),
      toolUse("buscar_produtos", { quantidade: -5 }),
      toolUse("consultar_pedido", {}),
      (c) => {
        const r = resultados(c)[0] as { erro: string; detalhes: string[] };
        expect(r.erro).toBe("parametros_invalidos");
        expect(r.detalhes.join(" ")).toMatch(/codigo/);
        return endTurn("Qual o código do seu pedido?");
      }
    );
    const r = await b.enviar("quero ver meu pedido");
    expect(todosResultados(b.llm).map((x) => x.erro)).toEqual(["parametros_invalidos", "parametros_invalidos", "parametros_invalidos"]);
    expect(r.modo).toBe("ia");
    expect(b.repo.carregar(TEL).estado.falhasConsecutivas).toBe(0);
  });
});

describe("H3 — base de conhecimento e arte", () => {
  it("H3.9 rascunho da base nunca é servido: vira lacuna registrada", async () => {
    const b = await montarBancada();
    b.llm.roteiro(toolUse("consultar_conhecimento", { pergunta: "posso retirar na loja?" }), (c) => {
      expect(resultados(c)[0].resultado).toBe("sem_resposta_na_base");
      return toolUse("transferir_humano", { motivo: "lacuna_conhecimento", prioridade: "normal" });
    }, endTurn("Vou chamar alguém."));
    const r = await b.enviar("posso retirar na loja?");
    expect(JSON.stringify(b.llm.chamadas)).not.toContain("Retirada gratuita");
    expect(b.lacunas.listar().map((l) => l.pergunta)).toContain("posso retirar na loja?");
    expect(r.avisoAtendente).toContain("Pergunta sem resposta: posso retirar na loja?");
  });

  it("H3.10 pelo WhatsApp só registra arte que chegou; formato perigoso é recusado", async () => {
    const b = await montarBancada();
    b.llm.roteiro(
      toolUse("registrar_arte", { descricao_arquivo: "logo.png" }),
      toolUse("registrar_arte", { descricao_arquivo: "logo.exe" }),
      endTurn("Pode reenviar?")
    );
    await b.enviar("mandei o logo.png ontem");
    expect(todosResultados(b.llm).map((x) => x.erro)).toEqual(["arquivo_nao_recebido", "formato_nao_aceito"]);
    expect(b.repo.carregar(TEL).estado.artes).toHaveLength(0);
  });
});

describe("H3 — logs", () => {
  it("H3.11 CPF, e-mail e telefone digitados pelo cliente não vão em claro para o log", async () => {
    const b = await montarBancada();
    b.llm.roteiro(endTurn("Anotado."));
    await b.enviar("meu cpf é 123.456.789-00, e-mail fulano.detal@empresa.com, fone (83) 98765-4321 e 5583987654321");
    const arquivo = join(process.cwd(), "logs", `${b.repo.carregar(TEL).estado.conversaId}.jsonl`);
    expect(existsSync(arquivo)).toBe(true);
    const log = readFileSync(arquivo, "utf-8");
    for (const dado of ["123.456.789-00", "fulano.detal@", "98765-4321", "5583987654321"]) expect(log).not.toContain(dado);
  });
});

describe("H3 — kill switch e ferramentas desligadas", () => {
  it("H3.12 ferramenta desligada não executa e o cliente vai para uma pessoa", async () => {
    const b = await montarBancada();
    b.sistema.ferramentasDesligadas = ["preparar_orcamento"];
    b.llm.roteiro(toolUse("detalhar_produto", { produto_id: "prod-001" }), toolUse("preparar_orcamento", {
      tipo: "PF", nome: "Ana Teste", email: "ana@teste.com", itens: [{ subproduto_id: "sub-001-branco", quantidade: 50 }],
    }), endTurn("Confirma?"));
    const r = await b.enviar("50 canecas brancas, Ana Teste, ana@teste.com");
    expect(todosResultados(b.llm).at(-1)?.erro).toBe("ferramenta_desligada");
    expect(b.repo.carregar(TEL).estado.fichaPedido).toBeUndefined();
    expect(r.modo).toBe("humano");
    expect(r.respostas).toEqual([MENSAGEM_TRANSFERENCIA]);
  });

  it("H3.13 [correção Fase 6] suspenso: o modelo não é chamado, o cliente é avisado uma vez e a equipe é chamada", async () => {
    const b = await montarBancada();
    b.sistema.suspenso = true;
    b.sistema.suspensoEm = "2026-10-19T12:00:00.000Z";
    const r1 = await b.enviar("oi, quero um orçamento");
    const r2 = await b.enviar("alô?");
    expect(b.llm.chamadas).toHaveLength(0);
    expect(r1.respostas).toEqual([MSG_SUSPENSAO]);
    expect(r1.avisoAtendente).toContain("quero um orçamento");
    expect(r2.respostas).toEqual([]);
    expect(b.repo.carregar(TEL).estado.historico.map((m) => m.content)).toEqual(
      expect.arrayContaining(["oi, quero um orçamento", "alô?"])
    );

    b.sistema.suspenso = false;
    b.llm.roteiro(endTurn("Voltei! Como posso ajudar?"));
    const r3 = await b.enviar("e agora?");
    expect(r3.respostas).toEqual(["Voltei! Como posso ajudar?"]);
  });

  it("H3.14 a lista de ferramentas da ponte bate com as ferramentas do agente", () => {
    expect([...NOMES_FERRAMENTAS].sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("H3.15 [correção Fase 6] #desligar com nome errado não confirma desligamento; #status mostra o estado", async () => {
    vi.useFakeTimers();
    try {
      const canal = new WhatsAppFalso();
      const estado = { suspenso: false, ferramentasDesligadas: [] as string[] };
      const controle: ControleAgente = {
        suspender: () => {},
        retomar: () => {},
        desligar: (f) => estado.ferramentasDesligadas.push(f),
        religar: () => {},
        estado: () => estado,
      };
      const atendimento = new Atendimento(new AgenteFalso(), new Envio(canal, 20), () => {}, { controle });
      const comando = (texto: string) => atendimento.receberMinha(canal.mensagem({ chatId: canal.eu, texto, deMim: true, paraMim: true }));

      await comando("#desligar preparar_orcamentos");
      await comando("#desligar preparar_orcamento");
      await comando("#status");
      await vi.runAllTimersAsync();

      expect(estado.ferramentasDesligadas).toEqual(["preparar_orcamento"]);
      const textos = canal.enviadas.map((e) => e.texto);
      expect(textos[0]).toMatch(/não é uma ferramenta do agente\. Nada foi desligado/);
      expect(textos[1]).toMatch(/desligada/);
      expect(textos[2]).toMatch(/Agente ativo[\s\S]*Desligadas: preparar_orcamento/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("H3.16 o servidor do agente só escuta em 127.0.0.1 (a API não tem autenticação)", () => {
    const fonte = readFileSync(join(process.cwd(), "src/api/index.ts"), "utf-8");
    expect(fonte).toMatch(/\.listen\(config\.agente\.porta, "127\.0\.0\.1"/);
  });
});
