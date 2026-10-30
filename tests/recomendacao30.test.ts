import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { MemoryProductIndexStore, sincronizarCatalogo } from "../src/catalogo/indice.js";
import { MemoryOccasionTagStore } from "../src/catalogo/ocasioes.js";
import { recomendar, MAX_OPCOES, type PedidoRecomendacao } from "../src/catalogo/recomendar.js";
import { verificarSugestao } from "../src/catalogo/verificacao.js";
import { construirRegistro } from "../src/catalogo/indice.js";
import { ClienteCatalogoFalso } from "./helpers/produtos.js";
import { gerarCatalogo } from "./helpers/catalogoSintetico.js";

/**
 * Critério de pronto da Fase 3: "em um conjunto de 30 pedidos de recomendação,
 * toda sugestão respeita mínimo, estoque e orçamento".
 *
 * Os 30 pedidos vêm de evals/recomendacao/pedidos.json (a loja os substitui por
 * pedidos reais). Aqui rodam contra um catálogo sintético de 400 produtos e CADA
 * sugestão é conferida por um verificador independente (verificacao.ts), que
 * recalcula tudo do produto cru da API sem usar oferta.ts.
 *
 * A parte "a equipe considera as sugestões adequadas" é humana: ver
 * `npm run avaliar:recomendacao`.
 */
interface PedidoJson {
  id: string;
  pedido: string;
  consulta: string;
  quantidade?: number;
  preco_max_unitario?: number;
  orcamento_total?: number;
  ocasiao?: string;
}

const pedidos: PedidoJson[] = JSON.parse(
  readFileSync(join(process.cwd(), "evals/recomendacao/pedidos.json"), "utf-8")
).pedidos;

const T0 = new Date("2026-10-14T10:00:00Z");

describe("30 pedidos de recomendação", () => {
  let client: ClienteCatalogoFalso;
  let index: MemoryProductIndexStore;
  const tags = new MemoryOccasionTagStore();

  beforeAll(async () => {
    client = new ClienteCatalogoFalso(gerarCatalogo(400, 7));
    index = new MemoryProductIndexStore();
    await sincronizarCatalogo(client, index, { agora: T0 });
  });

  it("há 30 pedidos", () => {
    expect(pedidos).toHaveLength(30);
    expect(new Set(pedidos.map((p) => p.id)).size).toBe(30);
  });

  const deJson = (p: PedidoJson): PedidoRecomendacao => ({
    consulta: p.consulta,
    quantidade: p.quantidade,
    precoMaxUnitario: p.preco_max_unitario,
    orcamentoTotal: p.orcamento_total,
    ocasiao: p.ocasiao,
  });

  for (const caso of pedidos) {
    it(`${caso.id} — ${caso.pedido}`, async () => {
      const pedido = deJson(caso);
      const r = await recomendar(pedido, { index, tags, client, agora: () => T0 });

      if (r.tipo === "encontrados") {
        expect(r.itens.length).toBeGreaterThan(0);
        expect(r.itens.length).toBeLessThanOrEqual(MAX_OPCOES);
        expect(new Set(r.itens.map((i) => i.produto.id)).size).toBe(r.itens.length);

        // ordenação por relevância
        for (let i = 1; i < r.itens.length; i++) {
          expect(r.itens[i - 1].relevancia).toBeGreaterThanOrEqual(r.itens[i].relevancia - 1e-9);
        }

        for (const item of r.itens) {
          const cru = client.produtos.find((p) => p.id === item.produto.id);
          expect(cru, `sugeriu produto fora do catálogo: ${item.produto.id}`).toBeDefined();
          const violacoes = verificarSugestao(
            cru!,
            {
              quantidade: item.oferta.quantidade,
              preco_unitario: item.oferta.preco_unitario,
              total_estimado: item.oferta.total_estimado,
              cores: item.oferta.cores,
            },
            { quantidade: pedido.quantidade, precoMaxUnitario: pedido.precoMaxUnitario, orcamentoTotal: pedido.orcamentoTotal }
          );
          expect(violacoes, JSON.stringify(violacoes)).toEqual([]);
        }
      } else if (r.tipo === "nenhum") {
        // sem resultado: nada sugerido, e cada ajuste proposto precisa funcionar de verdade
        for (const a of r.ajustes) {
          const novo: PedidoRecomendacao = { ...pedido };
          if (a.tipo !== "aumentar_orcamento") novo.quantidade = a.quantidade;
          else {
            novo.precoMaxUnitario = a.preco_unitario_minimo;
            novo.orcamentoTotal = undefined;
          }
          const depois = await recomendar(novo, { index, tags, client, agora: () => T0 });
          expect(depois.tipo, `ajuste ${a.tipo} não fecha`).toBe("encontrados");
          if (depois.tipo === "encontrados") {
            expect(depois.itens.map((i) => i.produto.id)).toContain(a.produto_id);
          }
        }
      } else {
        throw new Error(`resultado inesperado: ${r.tipo}`);
      }
    });
  }

  it("a maioria dos pedidos tem resposta (o teste não é vazio)", async () => {
    let comResposta = 0;
    for (const caso of pedidos) {
      const r = await recomendar(deJson(caso), { index, tags, client, agora: () => T0 });
      if (r.tipo === "encontrados") comResposta++;
    }
    expect(comResposta).toBeGreaterThanOrEqual(20);
  });

  it("o pedido impossível ('carro elétrico') não inventa produto", async () => {
    const caso = pedidos.find((p) => p.consulta === "carro elétrico")!;
    const r = await recomendar(deJson(caso), { index, tags, client, agora: () => T0 });
    expect(r).toMatchObject({ tipo: "nenhum", motivo: "sem_correspondencia" });
  });
});

describe("desempenho com o tamanho do catálogo real", () => {
  it("busca em 6.535 produtos responde em tempo de conversa", async () => {
    const produtos = gerarCatalogo(6535, 11);
    const index = new MemoryProductIndexStore({
      versao: 1,
      sincronizado_em: T0.toISOString(),
      completo: true,
      produtos: produtos.filter((p) => p.status).map((p) => construirRegistro(p, T0)),
    });
    const client = new ClienteCatalogoFalso(produtos);
    const deps = { index, tags: new MemoryOccasionTagStore(), client, agora: () => T0 };

    await recomendar({ consulta: "caneca", quantidade: 100 }, deps); // monta o índice BM25 (1ª vez)

    const t = performance.now();
    for (let i = 0; i < 5; i++) await recomendar({ consulta: "caneca térmica", quantidade: 100, ocasiao: "natal" }, deps);
    const media = (performance.now() - t) / 5;

    // Limite folgado de propósito: pega regressão para O(n²), não microvariação.
    expect(media).toBeLessThan(200);
    // e confere poucos produtos na API, não milhares
    expect(client.detalhesLidos.length).toBeLessThan(5 * MAX_OPCOES * 4 + 20);
  });
});
