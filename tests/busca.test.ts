import { describe, it, expect } from "vitest";
import { normalizar, tokenizar, radical, removerHtml } from "../src/busca/texto.js";
import { sinonimosDe } from "../src/busca/sinonimos.js";
import { IndiceBM25 } from "../src/busca/bm25.js";
import {
  detectarOcasioes,
  normalizarOcasiao,
  MemoryOccasionTagStore,
} from "../src/catalogo/ocasioes.js";

describe("texto", () => {
  it("normaliza acento, caixa e pontuação", () => {
    expect(normalizar("  Caneca de Porcelana — 325ml! ")).toBe("caneca de porcelana 325ml");
    expect(normalizar("AÇÃO São João")).toBe("acao sao joao");
  });

  it("radical junta singular e plural sem juntar palavras diferentes", () => {
    expect(radical("canecas")).toBe(radical("caneca"));
    expect(radical("cores")).toBe("cor");
    expect(radical("itens")).toBe("item");
    expect(radical("botoes")).toBe("botao");
    expect(radical("animais")).toBe("animal");
    expect(radical("squeezes")).toBe(radical("squeeze"));
    // não pode achatar palavras que terminam em ss/us/is
    expect(radical("onibus")).toBe("onibus");
    expect(radical("lapis")).toBe("lapis");
    // curtas ficam como estão
    expect(radical("pen")).toBe("pen");
  });

  it("tokeniza sem stopwords e mantém número", () => {
    expect(tokenizar("Quero uma caneca para 50 pessoas")).toEqual(["caneca", "50", "pessoa"]);
  });

  it("na consulta de catálogo as palavras genéricas de produto saem", () => {
    expect(tokenizar("brinde de caneca personalizada", { semGenericasDeProduto: true })).toEqual(["caneca"]);
    // mas continuam nos documentos
    expect(tokenizar("brinde de caneca")).toContain("brinde");
  });

  it("'produtos para natal' busca natal: produto e item também são genéricos (eval 11)", () => {
    expect(tokenizar("produtos para Natal", { semGenericasDeProduto: true })).toEqual(["natal"]);
    expect(tokenizar("itens de escritório", { semGenericasDeProduto: true })).toEqual([radical("escritorio")]);
  });

  it("removerHtml limpa as tags que a API manda", () => {
    expect(removerHtml("<b>Altura:</b>  13,3 cm<br/>Peso&nbsp;5g")).toBe("Altura: 13,3 cm Peso 5g");
  });
});

describe("sinônimos", () => {
  it("são simétricos", () => {
    expect(sinonimosDe(radical("copo"))).toContain(radical("caneca"));
    expect(sinonimosDe(radical("caneca"))).toContain(radical("copo"));
  });

  it("palavra sem grupo não tem sinônimo", () => {
    expect(sinonimosDe("xyz")).toEqual([]);
  });
});

describe("BM25", () => {
  const docs = [
    { id: "caneca", campos: [{ tokens: tokenizar("Caneca de porcelana"), peso: 3 }, { tokens: tokenizar("branca resistente"), peso: 1 }] },
    { id: "caderno", campos: [{ tokens: tokenizar("Caderno A5"), peso: 3 }, { tokens: tokenizar("capa dura"), peso: 1 }] },
    { id: "garrafa", campos: [{ tokens: tokenizar("Garrafa térmica"), peso: 3 }, { tokens: tokenizar("aço inox"), peso: 1 }] },
  ];
  const motor = new IndiceBM25(docs);
  const q = (...termos: string[]) => termos.map((t) => ({ termo: radical(t), alternativas: sinonimosDe(radical(t)) }));

  it("só pontua documentos que casam", () => {
    const r = motor.pontuar(q("caneca"));
    expect([...r.keys()]).toEqual(["caneca"]);
    expect(r.get("caneca")!.cobertura).toBe(1);
  });

  it("casa por sinônimo, valendo menos que a palavra exata", () => {
    const exato = motor.pontuar(q("caneca")).get("caneca")!.score;
    const sinonimo = motor.pontuar(q("copo")).get("caneca")!;
    expect(sinonimo.score).toBeGreaterThan(0);
    expect(sinonimo.score).toBeLessThan(exato);
    expect(sinonimo.cobertura).toBe(1);
  });

  it("cobertura cai quando a consulta tem termo que o documento não tem", () => {
    const r = motor.pontuar(q("caneca", "zebra")).get("caneca")!;
    expect(r.cobertura).toBeGreaterThan(0);
    expect(r.cobertura).toBeLessThan(0.6);
  });

  it("termo desconhecido pesa o máximo (não some da conta)", () => {
    expect(motor.idf("zebra")).toBeGreaterThan(motor.idf(radical("caneca")));
  });

  it("consulta vazia não pontua nada", () => {
    expect(motor.pontuar([]).size).toBe(0);
  });
});

describe("ocasiões", () => {
  it("detecta ocasião por frase inteira", () => {
    expect(detectarOcasioes("algo para o dia das mães")).toEqual(["dia-das-maes"]);
    expect(detectarOcasioes("brinde de Natal para a equipe")).toContain("natal");
    expect(detectarOcasioes("presente para professores")).toEqual(["dia-dos-professores"]);
  });

  it("não confunde pedaço de palavra", () => {
    expect(detectarOcasioes("natalidade")).toEqual([]);
    expect(detectarOcasioes("economia")).toEqual([]); // "eco" não vale dentro de outra palavra
  });

  it("normaliza etiqueta escrita de jeitos diferentes", () => {
    expect(normalizarOcasiao("Dia das Mães")).toBe("dia-das-maes");
    expect(normalizarOcasiao("dia-dos-professores")).toBe("dia-dos-professores");
    expect(normalizarOcasiao("NATAL")).toBe("natal");
    // ocasião que a loja inventou continua comparável
    expect(normalizarOcasiao("Black Friday")).toBe("black-friday");
  });

  it("junta etiquetas por produto, sku, categoria e as embutidas", () => {
    const tags = new MemoryOccasionTagStore({
      porProduto: { p1: ["natal"] },
      porSku: { "SKU-1": ["Dia das Mães"] },
      porCategoria: { Canecas: ["corporativo"] },
    });
    const r = tags.etiquetasDe({
      id: "p1",
      sku: "SKU-1",
      categorias: ["canecas"], // caixa diferente da tabela
      etiquetas_embutidas: ["formatura"],
    });
    expect(r.sort()).toEqual(["corporativo", "dia-das-maes", "formatura", "natal"]);
  });
});
