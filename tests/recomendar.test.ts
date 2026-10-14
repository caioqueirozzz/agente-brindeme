import { describe, it, expect, beforeEach } from "vitest";
import { MemoryProductIndexStore, sincronizarCatalogo } from "../src/catalogo/indice.js";
import { MemoryOccasionTagStore } from "../src/catalogo/ocasioes.js";
import { recomendar, MAX_OPCOES, type Recomendacao, type PedidoRecomendacao } from "../src/catalogo/recomendar.js";
import { ApiError } from "../src/integrations/brindeme/errors.js";
import { ClienteCatalogoFalso, produto, sub } from "./helpers/produtos.js";

const T0 = new Date("2026-10-14T10:00:00Z");

function catalogoBase() {
  return [
    produto({
      id: "caneca",
      nome: "Caneca de Porcelana",
      categoria: "Canecas",
      min: 25,
      destaque: true,
      etiquetas: ["natal", "corporativo"],
      subprodutos: [
        sub("caneca-bco", "Branco", 300, [[25, 99, 18.9], [100, 499, 15.4]]),
        sub("caneca-pto", "Preto", 200, [[25, 99, 19.9], [100, 499, 16.4]]),
      ],
    }),
    produto({
      id: "termica",
      nome: "Caneca Térmica Inox",
      categoria: "Canecas",
      min: 50,
      etiquetas: ["corporativo"],
      subprodutos: [sub("termica-pr", "Prata", 100, [[50, 999, 40]])],
    }),
    produto({
      id: "squeeze",
      nome: "Squeeze de Alumínio",
      categoria: "Garrafas",
      min: 50,
      etiquetas: ["esportivo"],
      subprodutos: [sub("sq-az", "Azul", 150, [[50, 999, 12]])],
    }),
    produto({
      id: "caderno",
      nome: "Caderno A5",
      categoria: "Papelaria",
      min: 50,
      etiquetas: ["dia-dos-professores", "formatura"],
      subprodutos: [sub("cad-az", "Azul", 300, [[50, 999, 9]]), sub("cad-vm", "Vermelho", 300, [[50, 999, 9]])],
    }),
    produto({
      id: "ecobag",
      nome: "Ecobag de Algodão",
      categoria: "Bolsas",
      min: 100,
      etiquetas: ["natal", "sustentabilidade"],
      subprodutos: [sub("eco-nat", "Natural", 500, [[100, 9999, 5]])],
    }),
    produto({
      id: "kit",
      nome: "Kit Escritório",
      categoria: "Kits",
      min: 10,
      etiquetas: ["natal", "executivo"],
      subprodutos: [sub("kit-pr", "Preto", 100, [[10, 999, 80]])],
    }),
    produto({ id: "camiseta", nome: "Camiseta Algodão", min: 25, ativo: false }),
    produto({
      id: "chaveiro",
      nome: "Chaveiro de Acrílico",
      min: 100,
      etiquetas: ["natal"],
      subprodutos: [sub("ch-cr", "Cristal", 0, [[100, 9999, 2]])],
    }),
  ];
}

async function montar(produtos = catalogoBase()) {
  const client = new ClienteCatalogoFalso(produtos);
  const index = new MemoryProductIndexStore();
  await sincronizarCatalogo(client, index, { agora: T0 });
  const tags = new MemoryOccasionTagStore();
  const buscar = (pedido: PedidoRecomendacao) => recomendar(pedido, { index, tags, client, agora: () => T0 });
  return { client, index, tags, buscar };
}

function encontrados(r: Recomendacao) {
  if (r.tipo !== "encontrados") throw new Error(`esperava encontrados, veio ${r.tipo}`);
  return r;
}
const ids = (r: Recomendacao) => encontrados(r).itens.map((i) => i.produto.id);

describe("recomendar — regras rígidas", () => {
  it("respeita a quantidade mínima", async () => {
    const { buscar } = await montar();
    expect(ids(await buscar({ consulta: "ecobag", quantidade: 100 }))).toEqual(["ecobag"]);
    const r = await buscar({ consulta: "ecobag", quantidade: 50 });
    expect(r.tipo).toBe("nenhum");
  });

  it("respeita o estoque de uma cor só", async () => {
    const { buscar } = await montar();
    // 400 > 300 do branco e > 200 do preto, embora 300+200 cubra
    const r = await buscar({ consulta: "caneca de porcelana", quantidade: 400 });
    expect(r.tipo).toBe("nenhum");
    if (r.tipo === "nenhum") expect(r.eliminadosPor.estoque_insuficiente).toBeGreaterThan(0);
  });

  it("respeita o preço unitário máximo", async () => {
    const { buscar } = await montar();
    expect(ids(await buscar({ consulta: "caneca", quantidade: 100, precoMaxUnitario: 16 }))).toEqual(["caneca"]);
    // 40 da térmica estoura 16
    expect(ids(await buscar({ consulta: "caneca", quantidade: 100, precoMaxUnitario: 16 }))).not.toContain("termica");
  });

  it("respeita o orçamento TOTAL", async () => {
    const { buscar } = await montar();
    // 100 canecas a 15,40 = 1.540 > 1.500
    expect((await buscar({ consulta: "caneca de porcelana", quantidade: 100, orcamentoTotal: 1500 })).tipo).toBe("nenhum");
    expect(ids(await buscar({ consulta: "caneca de porcelana", quantidade: 100, orcamentoTotal: 1540 }))).toEqual(["caneca"]);
  });

  it("ignora o total quando não há quantidade", async () => {
    const { buscar } = await montar();
    const r = encontrados(await buscar({ consulta: "caneca", orcamentoTotal: 1 }));
    expect(r.itens.length).toBeGreaterThan(0);
  });

  it("nunca sugere produto inativo nem sem estoque", async () => {
    const { buscar } = await montar();
    const r = await buscar({ consulta: "camiseta" });
    expect(r.tipo).toBe("nenhum"); // inativo nem entra no índice
    const c = await buscar({ consulta: "chaveiro", quantidade: 100 });
    expect(c.tipo).toBe("nenhum");
  });

  it("preço e total vêm da faixa da quantidade", async () => {
    const { buscar } = await montar();
    const item = encontrados(await buscar({ consulta: "caneca de porcelana", quantidade: 100 })).itens[0];
    expect(item.oferta.preco_unitario).toBe(15.4);
    expect(item.oferta.total_estimado).toBe(1540);
    expect(item.oferta.cores.map((c) => c.cor)).toEqual(["Branco", "Preto"]);
  });
});

describe("recomendar — sem quantidade", () => {
  it("avalia no mínimo de cada produto e marca como não informada", async () => {
    const { buscar } = await montar();
    const r = encontrados(await buscar({ consulta: "caneca" }));
    expect(r.quantidadeInformada).toBe(false);
    expect(r.quantidadeConsiderada).toBeNull();
    const porId = Object.fromEntries(r.itens.map((i) => [i.produto.id, i.oferta]));
    expect(porId["caneca"].quantidade).toBe(25);
    expect(porId["termica"].quantidade).toBe(50);
  });
});

describe("recomendar — relevância", () => {
  it("só traz o tipo de produto pedido; a ocasião ordena, não admite", async () => {
    const { buscar } = await montar();
    const r = await buscar({ consulta: "caneca", ocasiao: "natal", quantidade: 100 });
    // ecobag e kit também são de natal, mas não são caneca: ficam de fora
    expect(ids(r)).not.toContain("ecobag");
    expect(ids(r)).not.toContain("kit");
    // a térmica é caneca e entra, mas depois da de porcelana, que é de natal
    expect(ids(r)).toEqual(["caneca", "termica"]);
  });

  it("sinônimo encontra o produto (copo → caneca)", async () => {
    const { buscar } = await montar();
    expect(ids(await buscar({ consulta: "copo", quantidade: 100 }))).toContain("caneca");
    expect(ids(await buscar({ consulta: "bloco de anotações", quantidade: 50 }))).toContain("caderno");
  });

  it("plural e singular dão o mesmo resultado", async () => {
    const { buscar } = await montar();
    expect(ids(await buscar({ consulta: "canecas", quantidade: 100 }))).toEqual(
      ids(await buscar({ consulta: "caneca", quantidade: 100 }))
    );
  });

  it("'algo para professores' acha pelo rótulo da ocasião, sem tipo de produto", async () => {
    const { buscar } = await montar();
    const r = encontrados(await buscar({ consulta: "algo para professores", quantidade: 60 }));
    expect(r.ocasioes).toEqual(["dia-dos-professores"]);
    expect(r.itens.map((i) => i.produto.id)).toEqual(["caderno"]);
    expect(r.itens[0].ocasiaoConfere).toBe(true);
  });

  it("ocasião passada pelo parâmetro funciona igual", async () => {
    const { buscar } = await montar();
    const r = encontrados(await buscar({ consulta: "brinde", ocasiao: "Natal", quantidade: 100 }));
    expect(r.itens.length).toBeGreaterThan(0);
    expect(r.itens.every((i) => i.ocasiaoConfere)).toBe(true);
  });

  it("etiqueta de ocasião pesa na ordem", async () => {
    const { buscar } = await montar();
    // as duas são caneca; só a de porcelana é de natal (e também é destaque)
    const r = encontrados(await buscar({ consulta: "caneca", ocasiao: "natal", quantidade: 100 }));
    expect(r.itens[0].produto.id).toBe("caneca");
    expect(r.itens[0].relevancia).toBeGreaterThan(0.4);
  });

  it("destaque desempata entre produtos igualmente relevantes", async () => {
    const dois = [
      produto({ id: "a", nome: "Caneca Alfa", subprodutos: [sub("a1", "x", 500, [[1, 999, 10]])] }),
      produto({ id: "b", nome: "Caneca Beta", destaque: true, subprodutos: [sub("b1", "x", 500, [[1, 999, 10]])] }),
    ];
    const { buscar } = await montar(dois);
    expect(ids(await buscar({ consulta: "caneca", quantidade: 10 }))).toEqual(["b", "a"]);
  });

  it("devolve no máximo 3 opções", async () => {
    const muitos = Array.from({ length: 12 }, (_, i) =>
      produto({ id: `c${i}`, nome: `Caneca ${i}`, subprodutos: [sub(`c${i}s`, "x", 500, [[1, 999, 10 + i]])] })
    );
    const { buscar } = await montar(muitos);
    const r = encontrados(await buscar({ consulta: "caneca", quantidade: 10 }));
    expect(r.itens).toHaveLength(MAX_OPCOES);
  });

  it("consulta sem relação com o catálogo não inventa nada", async () => {
    const { buscar } = await montar();
    const r = await buscar({ consulta: "carro elétrico", quantidade: 5 });
    expect(r).toMatchObject({ tipo: "nenhum", motivo: "sem_correspondencia", ajustes: [] });
  });
});

describe("recomendar — revalidação na API antes de informar", () => {
  it("estoque que acabou depois da sincronização: o produto não é sugerido", async () => {
    const { buscar, client } = await montar();
    client.alterar("caneca", (p) => p.subproducts.forEach((s) => (s.stock = 0)));
    const r = encontrados(await buscar({ consulta: "caneca", quantidade: 100 }));
    expect(r.itens.map((i) => i.produto.id)).not.toContain("caneca");
    expect(r.descartadosNaRevalidacao).toBe(1);
  });

  it("preço que mudou: o cliente vê o preço atual, não o do índice", async () => {
    const { buscar, client } = await montar();
    client.alterar("caneca", (p) => (p.subproducts[0].prices[1].price = 14));
    const item = encontrados(await buscar({ consulta: "caneca de porcelana", quantidade: 100 })).itens[0];
    expect(item.oferta.preco_unitario).toBe(14);
    expect(item.oferta.total_estimado).toBe(1400);
  });

  it("preço que subiu além do orçamento: descarta", async () => {
    const { buscar, client } = await montar();
    client.alterar("caneca", (p) => p.subproducts.forEach((s) => (s.prices[1].price = 30)));
    const r = await buscar({ consulta: "caneca de porcelana", quantidade: 100, precoMaxUnitario: 16 });
    expect(r.tipo).toBe("nenhum");
  });

  it("produto desativado na plataforma: descarta", async () => {
    const { buscar, client } = await montar();
    client.alterar("caneca", (p) => (p.status = false));
    const r = encontrados(await buscar({ consulta: "caneca", quantidade: 100 }));
    expect(r.itens.map((i) => i.produto.id)).not.toContain("caneca");
  });

  it("404 na conferência (produto saiu do ar): descarta e segue, sem acusar falha de API", async () => {
    const { buscar, client } = await montar();
    client.falhaNoDetalhe.set("caneca", new ApiError(404, {}));
    const r = encontrados(await buscar({ consulta: "caneca", quantidade: 100 }));
    expect(r.itens.map((i) => i.produto.id)).not.toContain("caneca");
    expect(r.naoVerificados).toBe(0);
  });

  it("uma conferência que falha não derruba as outras — e o produto não verificado não é sugerido", async () => {
    const { buscar, client } = await montar();
    client.falhaNoDetalhe.set("caneca", new ApiError(500, {}));
    const r = encontrados(await buscar({ consulta: "caneca", quantidade: 100 }));
    expect(r.itens.map((i) => i.produto.id)).toEqual(["termica"]);
    expect(r.naoVerificados).toBe(1);
  });

  it("TODAS as conferências falhando é falha de API, não 'não temos'", async () => {
    const { buscar, client } = await montar();
    for (const id of ["caneca", "termica"]) client.falhaNoDetalhe.set(id, new ApiError(500, {}));
    const r = await buscar({ consulta: "caneca", quantidade: 100 });
    expect(r).toMatchObject({ tipo: "falha_api", erro: { falha_api: true, erro: "instabilidade" } });
  });

  it("401 na conferência pede transferência imediata", async () => {
    const { buscar, client } = await montar();
    for (const id of ["caneca", "termica"]) client.falhaNoDetalhe.set(id, new ApiError(401, {}));
    const r = await buscar({ consulta: "caneca", quantidade: 100 });
    expect(r).toMatchObject({ tipo: "falha_api", erro: { transferir_imediato: true, alerta: true } });
  });

  it("só confere na API os produtos que podem ser sugeridos (não o catálogo todo)", async () => {
    const { buscar, client } = await montar();
    client.detalhesLidos.length = 0;
    await buscar({ consulta: "caneca", quantidade: 100 });
    expect(client.detalhesLidos.length).toBeLessThanOrEqual(2); // só as duas canecas elegíveis
  });

  it("segue conferindo candidatos seguintes até completar as opções", async () => {
    const muitos = Array.from({ length: 10 }, (_, i) =>
      produto({ id: `c${i}`, nome: `Caneca ${i}`, subprodutos: [sub(`c${i}s`, "x", 500, [[1, 999, 10 + i]])] })
    );
    const { buscar, client } = await montar(muitos);
    // as 4 primeiras do ranking (as mais baratas) perderam o estoque desde a sincronização
    for (const id of ["c0", "c1", "c2", "c3"]) client.alterar(id, (p) => (p.subproducts[0].stock = 0));
    const r = encontrados(await buscar({ consulta: "caneca", quantidade: 10 }));
    expect(r.itens).toHaveLength(3);
    expect(r.itens.every((i) => !["c0", "c1", "c2", "c3"].includes(i.produto.id))).toBe(true);
  });
});

describe("recomendar — sem resultado: explica e propõe o ajuste mais próximo", () => {
  it("abaixo do mínimo → propõe a quantidade mínima, já com preço", async () => {
    const { buscar } = await montar();
    const r = await buscar({ consulta: "ecobag", quantidade: 40 });
    expect(r).toMatchObject({ tipo: "nenhum", motivo: "regras_nao_fecham" });
    if (r.tipo !== "nenhum") return;
    expect(r.eliminadosPor.abaixo_do_minimo).toBe(1);
    expect(r.ajustes).toEqual([
      { tipo: "aumentar_quantidade", produto_id: "ecobag", nome: "Ecobag de Algodão", quantidade: 100, preco_unitario: 5, total_estimado: 500 },
    ]);
  });

  it("acima do orçamento → propõe o orçamento mínimo que fecha", async () => {
    const { buscar } = await montar();
    const r = await buscar({ consulta: "squeeze", quantidade: 50, precoMaxUnitario: 5 });
    if (r.tipo !== "nenhum") throw new Error("esperava nenhum");
    expect(r.ajustes).toEqual([
      { tipo: "aumentar_orcamento", produto_id: "squeeze", nome: "Squeeze de Alumínio", quantidade: 50, preco_unitario_minimo: 12, total_estimado: 600 },
    ]);
  });

  it("estoque insuficiente → propõe reduzir até o que existe", async () => {
    const { buscar } = await montar();
    const r = await buscar({ consulta: "squeeze", quantidade: 400 });
    if (r.tipo !== "nenhum") throw new Error("esperava nenhum");
    expect(r.ajustes).toEqual([
      { tipo: "reduzir_quantidade", produto_id: "squeeze", nome: "Squeeze de Alumínio", quantidade: 150, preco_unitario: 12, total_estimado: 1800 },
    ]);
  });

  it("não propõe ajuste que não fecha (reduzir abaixo do mínimo)", async () => {
    const p = [produto({ id: "x", nome: "Caneca Rara", min: 50, subprodutos: [sub("x1", "a", 30, [[50, 99, 10]])] })];
    const { buscar } = await montar(p);
    const r = await buscar({ consulta: "caneca", quantidade: 60 });
    if (r.tipo !== "nenhum") throw new Error("esperava nenhum");
    expect(r.ajustes).toEqual([]); // 30 em estoque < mínimo 50: nenhum ajuste de quantidade serve
  });

  it("todo ajuste proposto, aplicado ao pedido, de fato devolve aquele produto", async () => {
    const { buscar } = await montar();
    const casos: PedidoRecomendacao[] = [
      { consulta: "ecobag", quantidade: 40 },
      { consulta: "squeeze", quantidade: 50, precoMaxUnitario: 5 },
      { consulta: "squeeze", quantidade: 400 },
      { consulta: "caneca de porcelana", quantidade: 100, orcamentoTotal: 1000 },
      { consulta: "kit", quantidade: 5 },
    ];
    let verificados = 0;
    for (const pedido of casos) {
      const r = await buscar(pedido);
      if (r.tipo !== "nenhum") continue;
      for (const a of r.ajustes) {
        const novo: PedidoRecomendacao = { ...pedido };
        if (a.tipo === "aumentar_quantidade" || a.tipo === "reduzir_quantidade") novo.quantidade = a.quantidade;
        if (a.tipo === "aumentar_orcamento") {
          novo.precoMaxUnitario = a.preco_unitario_minimo;
          novo.orcamentoTotal = undefined;
        }
        // orçamento total acompanha a nova quantidade? não: ajuste de quantidade mantém o total pedido
        const depois = await buscar(novo);
        expect(depois.tipo, JSON.stringify({ pedido, a })).toBe("encontrados");
        expect(ids(depois)).toContain(a.produto_id);
        verificados++;
      }
    }
    expect(verificados).toBeGreaterThanOrEqual(3);
  });

  it("explica o que não fechou", async () => {
    const { buscar } = await montar();
    const r = await buscar({ consulta: "caneca", quantidade: 20 });
    if (r.tipo !== "nenhum") throw new Error("esperava nenhum");
    expect(r.candidatosRelevantes).toBe(2);
    expect(r.eliminadosPor.abaixo_do_minimo).toBe(2);
  });
});

describe("recomendar — índice", () => {
  it("índice vazio é sinalizado, não vira 'nenhum produto'", async () => {
    const client = new ClienteCatalogoFalso([]);
    const r = await recomendar({ consulta: "caneca" }, {
      index: new MemoryProductIndexStore(),
      tags: new MemoryOccasionTagStore(),
      client,
    });
    expect(r.tipo).toBe("indice_vazio");
  });

  it("etiquetas da loja (tabela) valem sem nova sincronização", async () => {
    const { client, index } = await montar();
    const tags = new MemoryOccasionTagStore({ porCategoria: { Papelaria: ["dia-das-maes"] } });
    const r = encontrados(
      await recomendar({ consulta: "algo para o dia das mães", quantidade: 60 }, { index, tags, client })
    );
    expect(r.itens.map((i) => i.produto.id)).toContain("caderno");
  });
});
