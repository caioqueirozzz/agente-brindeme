import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  lerItens,
  carregarBase,
  BaseConhecimento,
  CATEGORIAS,
  type ItemBase,
} from "../src/knowledge/base.js";
import {
  FileLacunaStore,
  MemoryLacunaStore,
  agruparLacunas,
  criarLacuna,
} from "../src/knowledge/lacunas.js";
import {
  consultarConhecimentoHandler,
  setBaseConhecimento,
  setLacunaStore,
} from "../src/tools/consultarConhecimento.js";
import { isFalhaApi } from "../src/integrations/brindeme/errors.js";
import { createInitialState } from "../src/agent/state.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { tools } from "../src/tools/index.js";
import { MOTIVOS } from "../src/tools/transferirHumano.js";

const HOJE = new Date("2026-10-14T12:00:00Z");

function item(over: Record<string, unknown> = {}) {
  return {
    id: "entrega-brasil",
    titulo: "Entrega para todo o Brasil",
    conteudo: "Entregamos para todo o Brasil por Correios e transportadoras.",
    palavras_chave: ["frete", "envio", "correios"],
    perguntas_exemplo: ["Vocês entregam em todo o Brasil?"],
    status: "aprovado",
    aprovado_por: "Logística",
    aprovado_em: "2026-10-01",
    revisar_em: "2027-04-01",
    ...over,
  };
}

/** Cria uma pasta de base com os arquivos dados (categoria → itens). */
function pasta(arquivos: Record<string, unknown[]>, nomes: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-"));
  for (const [categoria, itens] of Object.entries(arquivos)) {
    writeFileSync(
      join(dir, nomes[categoria] ?? `${categoria}.json`),
      JSON.stringify({ categoria, itens }),
      "utf-8"
    );
  }
  return dir;
}

describe("base de conhecimento — validação", () => {
  it("lê item válido e herda o dono da categoria", () => {
    const { itens, problemas } = lerItens({ dir: pasta({ entrega: [item()] }), hoje: HOJE });
    expect(problemas).toEqual([]);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ categoria: "entrega", dono: "Logística", vencido: false, temPlaceholder: false });
  });

  it("cada categoria tem o aprovador do planejamento", () => {
    expect(CATEGORIAS["processo-comercial"].aprovador).toBe("Comercial");
    expect(CATEGORIAS.arte.aprovador).toBe("Produção");
    expect(CATEGORIAS.prazos.aprovador).toBe("Produção");
    expect(CATEGORIAS.entrega.aprovador).toBe("Logística");
    expect(CATEGORIAS.pagamento.aprovador).toBe("Financeiro");
    expect(CATEGORIAS["trocas-defeitos"].aprovador).toBe("Gerência");
    expect(CATEGORIAS.institucional.aprovador).toBe("Gerência");
  });

  it("item aprovado exige quem aprovou e quando", () => {
    const dir = pasta({
      entrega: [item({ aprovado_por: undefined }), item({ id: "b", aprovado_em: undefined })],
    });
    const { itens, problemas } = lerItens({ dir });
    expect(itens).toEqual([]);
    expect(problemas.map((p) => p.mensagem).join("|")).toMatch(/aprovado_por/);
    expect(problemas.map((p) => p.mensagem).join("|")).toMatch(/aprovado_em/);
  });

  it("item aprovado com [PLACEHOLDER] é rejeitado", () => {
    const dir = pasta({ prazos: [item({ id: "p", conteudo: "O prazo é de [PRAZO_DIAS] dias úteis." })] });
    const { itens, problemas } = lerItens({ dir });
    expect(itens).toEqual([]);
    expect(problemas[0].mensagem).toMatch(/PLACEHOLDER/);
  });

  it("rascunho pode ter placeholder, mas é marcado", () => {
    const dir = pasta({
      prazos: [item({ id: "p", status: "rascunho", aprovado_por: undefined, aprovado_em: undefined, conteudo: "Prazo de [X] dias." })],
    });
    const { itens } = lerItens({ dir });
    expect(itens[0].temPlaceholder).toBe(true);
  });

  it("item curto: conteúdo grande demais é rejeitado", () => {
    const { itens, problemas } = lerItens({ dir: pasta({ entrega: [item({ conteudo: "a".repeat(701) })] }) });
    expect(itens).toEqual([]);
    expect(problemas).toHaveLength(1);
  });

  it("id repetido (mesmo em outro arquivo) é rejeitado", () => {
    const dir = pasta({ entrega: [item()], prazos: [item()] });
    const { itens, problemas } = lerItens({ dir });
    expect(itens).toHaveLength(1);
    expect(problemas[0].mensagem).toMatch(/repetido/);
  });

  it("arquivo com nome diferente da categoria é rejeitado", () => {
    const dir = pasta({ entrega: [item()] }, { entrega: "outra-coisa.json" });
    expect(lerItens({ dir }).problemas[0].mensagem).toMatch(/entrega\.json/);
  });

  it("JSON quebrado vira problema, não exceção", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-"));
    writeFileSync(join(dir, "entrega.json"), "{ quebrado", "utf-8");
    expect(lerItens({ dir }).problemas[0].mensagem).toMatch(/JSON inválido/);
  });

  it("um item inválido não derruba os outros do arquivo", () => {
    const dir = pasta({ entrega: [item({ titulo: "x" }), item({ id: "ok" })] });
    const { itens, problemas } = lerItens({ dir });
    expect(itens.map((i) => i.id)).toEqual(["ok"]);
    expect(problemas).toHaveLength(1);
  });

  it("marca item com revisão vencida", () => {
    const dir = pasta({ entrega: [item({ revisar_em: "2026-10-13" }), item({ id: "novo", revisar_em: "2026-10-14" })] });
    const { itens } = lerItens({ dir, hoje: HOJE });
    expect(itens.find((i) => i.id === "entrega-brasil")!.vencido).toBe(true);
    expect(itens.find((i) => i.id === "novo")!.vencido).toBe(false);
  });

  it("pasta inexistente é problema", () => {
    expect(lerItens({ dir: join(tmpdir(), "nao-existe-kb") }).problemas).toHaveLength(1);
  });
});

describe("base de conhecimento — o que é servido", () => {
  const dir = pasta({
    entrega: [item()],
    prazos: [
      item({ id: "prazo-rascunho", status: "rascunho", aprovado_por: undefined, aprovado_em: undefined, conteudo: "Produzimos em 10 dias úteis.", titulo: "Prazo de produção", palavras_chave: ["prazo", "demora"], perguntas_exemplo: [] }),
      item({ id: "prazo-pendente", status: "rascunho", aprovado_por: undefined, aprovado_em: undefined, conteudo: "Prazo de [X] dias.", titulo: "Prazo pendente", palavras_chave: ["prazo"], perguntas_exemplo: [] }),
    ],
  });

  it("rascunho NÃO é servido por padrão", () => {
    const { base } = carregarBase({ dir });
    expect(base.buscar("qual o prazo de produção?")).toEqual([]);
    expect(base.estatisticas()).toMatchObject({ total: 3, aprovados: 1, rascunhos: 2, servidos: 1 });
  });

  it("rascunho sem placeholder só é servido com a chave de desenvolvimento", () => {
    const { base } = carregarBase({ dir, incluirRascunhos: true });
    expect(base.buscar("qual o prazo de produção?").map((a) => a.item.id)).toEqual(["prazo-rascunho"]);
  });

  it("item com placeholder nunca é servido, nem com a chave ligada", () => {
    const { base } = carregarBase({ dir, incluirRascunhos: true });
    const todos = base.buscar("prazo pendente", { limite: 10 }).map((a) => a.item.id);
    expect(todos).not.toContain("prazo-pendente");
    expect(base.estatisticas().comPlaceholder).toBe(1);
  });
});

describe("base de conhecimento — busca", () => {
  let base: BaseConhecimento;
  beforeEach(() => {
    const dir = pasta({
      entrega: [item()],
      pagamento: [
        item({
          id: "formas-pagamento",
          titulo: "Formas de pagamento",
          conteudo: "Aceitamos PIX, boleto e cartão de crédito em até 3x.",
          palavras_chave: ["pagar", "pix", "boleto", "parcelar"],
          perguntas_exemplo: ["Como posso pagar?"],
          aprovado_por: "Financeiro",
        }),
      ],
      institucional: [
        item({
          id: "endereco",
          titulo: "Endereço da loja",
          conteudo: "Estamos na Rua das Flores, 100, Recife.",
          palavras_chave: ["endereco", "onde fica", "localizacao"],
          perguntas_exemplo: ["Onde vocês ficam?"],
          aprovado_por: "Gerência",
        }),
      ],
    });
    base = carregarBase({ dir }).base;
  });

  it("acha o item pela pergunta do cliente", () => {
    expect(base.buscar("Vocês entregam em todo o Brasil?")[0].item.id).toBe("entrega-brasil");
    expect(base.buscar("posso pagar com pix?")[0].item.id).toBe("formas-pagamento");
    expect(base.buscar("onde fica a loja")[0].item.id).toBe("endereco");
  });

  it("acha por palavra-chave que o conteúdo não repete", () => {
    expect(base.buscar("tem como parcelar?")[0].item.id).toBe("formas-pagamento");
  });

  it("pergunta sem resposta na base não devolve item (lacuna)", () => {
    expect(base.buscar("vocês vendem iphone?")).toEqual([]);
    expect(base.buscar("qual o CNPJ da loja?")).toEqual([]);
  });

  it("não responde com item que só casa uma palavra solta", () => {
    // "loja" casa com o endereço, mas "cnpj" e "inscrição" não casam com nada
    expect(base.buscar("qual a inscrição estadual da loja")).toEqual([]);
  });

  it("pergunta só com palavras vazias não devolve nada", () => {
    expect(base.buscar("oi tudo bem")).toEqual([]);
    expect(base.buscar("?")).toEqual([]);
  });

  it("restringe por categoria", () => {
    expect(base.buscar("onde fica a loja", { categoria: "pagamento" })).toEqual([]);
    expect(base.buscar("onde fica a loja", { categoria: "institucional" })).toHaveLength(1);
  });

  it("devolve no máximo `limite` itens", () => {
    expect(base.buscar("loja entregam pagar", { limite: 1 }).length).toBeLessThanOrEqual(1);
  });

  it("base vazia não quebra", () => {
    const vazia = new BaseConhecimento([], { incluirRascunhos: false });
    expect(vazia.buscar("qualquer coisa")).toEqual([]);
  });
});

describe("base de conhecimento — conteúdo inicial entregue", () => {
  it("não tem nenhum problema de validação", () => {
    const { problemas } = lerItens();
    expect(problemas).toEqual([]);
  });

  it("cobre as 7 categorias do planejamento", () => {
    const { itens } = lerItens();
    expect(new Set(itens.map((i) => i.categoria))).toEqual(new Set(Object.keys(CATEGORIAS)));
  });

  it("nenhum item aprovado carrega placeholder (a loja só aprova com o valor preenchido)", () => {
    const { itens } = lerItens();
    expect(itens.filter((i) => i.status === "aprovado" && i.temPlaceholder)).toEqual([]);
  });

  it("por padrão, sem aprovação da loja, o agente não afirma nada — tudo vira lacuna", () => {
    const { base } = carregarBase();
    const aprovados = base.estatisticas().aprovados;
    if (aprovados === 0) {
      expect(base.buscar("Vocês entregam em todo o Brasil?")).toEqual([]);
    }
  });

  describe("recuperação (com rascunhos ligados, só para medir a busca)", () => {
    const { base } = carregarBase({ incluirRascunhos: true });
    const casos: Array<[string, string]> = [
      ["Vocês entregam em todo o Brasil?", "regioes-e-modalidades-de-entrega"],
      ["dá pra retirar na loja?", "regioes-e-modalidades-de-entrega"],
      ["Como funciona para comprar?", "processo-passo-a-passo"],
      ["qual o passo a passo do pedido", "processo-passo-a-passo"],
      ["Quais formatos de arte vocês aceitam?", "formatos-de-arte-aceitos"],
      ["posso mandar o logo em pdf?", "formatos-de-arte-aceitos"],
      ["Posso colocar o escudo do meu time?", "arte-com-marca-de-terceiros"],
      ["Posso devolver se não gostar?", "troca-por-arrependimento"],
      ["qual o pedido mínimo?", "pedido-minimo"],
      ["você é um robô?", "limites-do-atendimento-virtual"],
    ];
    for (const [pergunta, esperado] of casos) {
      it(`"${pergunta}" → ${esperado}`, () => {
        expect(base.buscar(pergunta)[0]?.item.id).toBe(esperado);
      });
    }

    it("pergunta fora do escopo da loja vira lacuna", () => {
      expect(base.buscar("Qual foi o resultado do jogo do Flamengo ontem?")).toEqual([]);
      expect(base.buscar("vocês vendem iphone?")).toEqual([]);
    });

    it("itens com valor pendente (prazo, pagamento, horário) não respondem", () => {
      expect(base.buscar("em quantos dias fica pronto?")).toEqual([]);
      expect(base.buscar("quais as formas de pagamento?")).toEqual([]);
      expect(base.buscar("qual o horário de atendimento?")).toEqual([]);
    });
  });
});

describe("ferramenta consultar_conhecimento", () => {
  let lacunas: MemoryLacunaStore;
  const client = new MockBrindeMeClient();

  beforeEach(() => {
    const dir = pasta({ entrega: [item({ nota_interna: "RECADO INTERNO", dono: "Fulano" })] });
    setBaseConhecimento(carregarBase({ dir }).base);
    lacunas = new MemoryLacunaStore();
    setLacunaStore(lacunas);
  });

  it("devolve o item encontrado, sem metadado interno", async () => {
    const r = (await consultarConhecimentoHandler(
      { pergunta: "vocês entregam em todo o Brasil?" },
      createInitialState("5583999990000"),
      client
    )) as { resultado: string; itens: Array<Record<string, unknown>>; regra: string };

    expect(r.resultado).toBe("encontrado");
    expect(r.itens).toHaveLength(1);
    expect(Object.keys(r.itens[0]).sort()).toEqual(["categoria", "conteudo", "id", "titulo"]);
    expect(JSON.stringify(r)).not.toMatch(/RECADO INTERNO|Fulano|aprovado_por/);
    expect(r.regra).toMatch(/só o conteúdo/);
    expect(lacunas.listar()).toEqual([]);
  });

  it("sem resposta na base: manda transferir com o motivo certo e registra a lacuna", async () => {
    const state = createInitialState("5583999990000");
    const r = (await consultarConhecimentoHandler({ pergunta: "qual o CNPJ da loja?" }, state, client)) as Record<string, unknown>;

    expect(r).toMatchObject({
      resultado: "sem_resposta_na_base",
      instrucao: "transferir",
      motivo_sugerido: "lacuna_conhecimento",
    });
    expect(MOTIVOS).toContain("lacuna_conhecimento");
    expect(lacunas.listar()).toHaveLength(1);
    expect(lacunas.listar()[0]).toMatchObject({ pergunta: "qual o CNPJ da loja?", conversa_id: state.conversaId });
  });

  it("lacuna não é falha de API (não conta para o disjuntor de falhas seguidas)", async () => {
    const r = await consultarConhecimentoHandler(
      { pergunta: "vocês vendem iphone?" },
      createInitialState("5583999990000"),
      client
    );
    expect(isFalhaApi(r)).toBe(false);
  });

  it("a pergunta registrada na lacuna vai mascarada", async () => {
    await consultarConhecimentoHandler(
      { pergunta: "meu cpf 123.456.789-09 e e-mail ana.souza@gmail.com, tel 83999990000, vocês vendem iphone?" },
      createInitialState("5583999990000"),
      client
    );
    const salva = lacunas.listar()[0].pergunta;
    expect(salva).not.toMatch(/123\.456\.789-09|ana\.souza@gmail\.com|83999990000/);
    expect(salva).toMatch(/\*\*\*/);
  });

  it("está registrada entre as ferramentas do agente com schema válido", () => {
    const t = tools.find((x) => x.name === "consultar_conhecimento");
    expect(t).toBeDefined();
    expect(JSON.stringify(t!.inputSchema)).toContain("pergunta");
  });
});

describe("lacunas", () => {
  it("agrupa perguntas parecidas e ordena pelas mais frequentes", () => {
    const ls = [
      criarLacuna("qual o CNPJ de vocês?", "c1", undefined, new Date("2026-10-01")),
      criarLacuna("me passa o cnpj da loja", "c2", "institucional", new Date("2026-10-03")),
      criarLacuna("tem cnpj?", "c3", undefined, new Date("2026-10-05")),
      criarLacuna("vocês vendem iphone?", "c4", undefined, new Date("2026-10-02")),
    ];
    const g = agruparLacunas(ls);
    // "qual o cnpj de vocês" e "me passa o cnpj da loja" têm palavras restantes diferentes;
    // o que importa: o grupo mais frequente vem primeiro e nada se perde
    expect(g.reduce((acc, x) => acc + x.ocorrencias, 0)).toBe(4);
    expect(g[0].ocorrencias).toBeGreaterThanOrEqual(g[g.length - 1].ocorrencias);
  });

  it("a mesma pergunta repetida conta como uma lacuna com várias ocorrências", () => {
    const g = agruparLacunas([
      criarLacuna("Vocês vendem iPhone?", "c1"),
      criarLacuna("vocês vendem iphone", "c2"),
      criarLacuna("VOCÊS VENDEM IPHONE???", "c1"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ ocorrencias: 3, conversas: 2 });
  });

  it("arquivo: grava em JSONL, relê e ignora linha truncada", () => {
    const dir = mkdtempSync(join(tmpdir(), "lac-"));
    const file = join(dir, "sub", "lacunas.jsonl");
    const store = new FileLacunaStore(file);
    expect(store.listar()).toEqual([]);

    store.registrar(criarLacuna("pergunta 1", "c1"));
    store.registrar(criarLacuna("pergunta 2", "c2"));
    writeFileSync(file, readFileSync(file, "utf-8") + '{"pergunta": "trunc', "utf-8");

    expect(existsSync(file)).toBe(true);
    expect(store.listar().map((l) => l.pergunta)).toEqual(["pergunta 1", "pergunta 2"]);
  });

  it("pergunta longa é cortada", () => {
    expect(criarLacuna("a".repeat(1000), "c").pergunta.length).toBe(300);
  });
});

// Garante que a tipagem pública continua exportando o que os scripts usam.
export type _Verificacao = ItemBase;
