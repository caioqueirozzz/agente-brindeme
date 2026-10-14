import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryProductIndexStore,
  FileProductIndexStore,
  sincronizarCatalogo,
  construirRegistro,
} from "../src/catalogo/indice.js";
import { ApiError } from "../src/integrations/brindeme/errors.js";
import { ClienteCatalogoFalso, produto, sub } from "./helpers/produtos.js";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const T0 = new Date("2026-10-14T10:00:00Z");
const maisHoras = (h: number) => new Date(T0.getTime() + h * 3_600_000);

function catalogo(n: number, extra: (i: number) => Partial<Parameters<typeof produto>[0]> = () => ({})) {
  return Array.from({ length: n }, (_, i) =>
    produto({ id: `p${i}`, nome: `Produto ${i}`, atualizadoEm: "2026-10-10T00:00:00Z", ...extra(i) })
  );
}

describe("sincronizarCatalogo", () => {
  let store: MemoryProductIndexStore;
  beforeEach(() => { store = new MemoryProductIndexStore(); });

  it("lê todas as páginas e o detalhe de cada produto ativo", async () => {
    const client = new ClienteCatalogoFalso(catalogo(25));
    const r = await sincronizarCatalogo(client, store, { perPage: 10, agora: T0 });

    expect(client.paginasListadas).toEqual([1, 2, 3]);
    expect(r).toMatchObject({ listados: 25, ativos: 25, lidosNoDetalhe: 25, novos: 25, completo: true });
    expect(store.carregar().produtos).toHaveLength(25);
    expect(store.carregar().completo).toBe(true);
  });

  it("a listagem não traz subprodutos — o índice só tem o que veio do detalhe", async () => {
    const client = new ClienteCatalogoFalso(catalogo(3));
    await sincronizarCatalogo(client, store, { agora: T0 });
    for (const p of store.carregar().produtos) {
      expect(p.subprodutos.length).toBeGreaterThan(0);
      expect(p.imagem_url).toMatch(/^https:/);
    }
  });

  it("não indexa produto inativo nem lê o detalhe dele", async () => {
    const client = new ClienteCatalogoFalso([
      ...catalogo(2),
      produto({ id: "off", nome: "Camiseta", ativo: false }),
    ]);
    const r = await sincronizarCatalogo(client, store, { agora: T0 });
    expect(r.ativos).toBe(2);
    expect(client.detalhesLidos).not.toContain("off");
    expect(store.carregar().produtos.map((p) => p.id)).not.toContain("off");
  });

  it("guarda só subprodutos ativos", async () => {
    const client = new ClienteCatalogoFalso([
      produto({
        id: "a",
        nome: "Caneca",
        subprodutos: [sub("on", "Branco", 10, [[1, 9, 5]]), sub("off", "Preto", 10, [[1, 9, 5]], false)],
      }),
    ]);
    await sincronizarCatalogo(client, store, { agora: T0 });
    expect(store.carregar().produtos[0].subprodutos.map((s) => s.id)).toEqual(["on"]);
  });

  it("respeita o limite de concorrência no detalhe", async () => {
    const client = new ClienteCatalogoFalso(catalogo(30));
    client.latenciaMs = 5;
    await sincronizarCatalogo(client, store, { concorrencia: 4, agora: T0 });
    expect(client.emVooMaximo).toBeGreaterThan(1);
    expect(client.emVooMaximo).toBeLessThanOrEqual(4);
  });

  describe("incremental", () => {
    it("segunda rodada sem mudanças não relê nenhum detalhe", async () => {
      const client = new ClienteCatalogoFalso(catalogo(10));
      await sincronizarCatalogo(client, store, { agora: T0 });
      client.detalhesLidos.length = 0;

      const r = await sincronizarCatalogo(client, store, { agora: maisHoras(1) });
      expect(client.detalhesLidos).toEqual([]);
      expect(r).toMatchObject({ reaproveitados: 10, lidosNoDetalhe: 0, novos: 0, removidos: 0 });
      expect(store.carregar().produtos).toHaveLength(10);
    });

    it("relê só o produto cujo updated_at mudou", async () => {
      const client = new ClienteCatalogoFalso(catalogo(10));
      await sincronizarCatalogo(client, store, { agora: T0 });
      client.detalhesLidos.length = 0;
      client.alterar("p3", (p) => {
        p.updated_at = "2026-10-14T09:00:00Z";
        p.subproducts[0].prices[0].price = 99;
      });

      await sincronizarCatalogo(client, store, { agora: maisHoras(1) });
      expect(client.detalhesLidos).toEqual(["p3"]);
      expect(store.carregar().produtos.find((p) => p.id === "p3")!.subprodutos[0].faixas[0].preco).toBe(99);
    });

    it("relê tudo depois da idade máxima, mesmo sem mudança em updated_at", async () => {
      const client = new ClienteCatalogoFalso(catalogo(5));
      await sincronizarCatalogo(client, store, { agora: T0 });
      client.detalhesLidos.length = 0;

      await sincronizarCatalogo(client, store, { agora: maisHoras(7), maxIdadeHoras: 6 });
      expect(client.detalhesLidos).toHaveLength(5);
    });

    it("forcar relê tudo", async () => {
      const client = new ClienteCatalogoFalso(catalogo(5));
      await sincronizarCatalogo(client, store, { agora: T0 });
      client.detalhesLidos.length = 0;
      await sincronizarCatalogo(client, store, { agora: maisHoras(1), forcar: true });
      expect(client.detalhesLidos).toHaveLength(5);
    });

    it("API sem updated_at nunca reaproveita (não dá para saber se mudou)", async () => {
      const client = new ClienteCatalogoFalso(catalogo(3, () => ({ atualizadoEm: undefined })));
      await sincronizarCatalogo(client, store, { agora: T0 });
      client.detalhesLidos.length = 0;
      await sincronizarCatalogo(client, store, { agora: maisHoras(1) });
      expect(client.detalhesLidos).toHaveLength(3);
    });
  });

  describe("segurança do índice", () => {
    it("falha na LISTAGEM aborta sem alterar o índice existente", async () => {
      const client = new ClienteCatalogoFalso(catalogo(30));
      await sincronizarCatalogo(client, store, { perPage: 10, agora: T0 });
      const antes = store.carregar();

      client.falhaNaPagina = 2;
      await expect(sincronizarCatalogo(client, store, { perPage: 10, agora: maisHoras(1) })).rejects.toBeInstanceOf(
        ApiError
      );
      expect(store.carregar()).toBe(antes);
      expect(store.carregar().produtos).toHaveLength(30);
    });

    it("falha no detalhe mantém o registro anterior do produto", async () => {
      const client = new ClienteCatalogoFalso(catalogo(3));
      await sincronizarCatalogo(client, store, { agora: T0 });
      const anterior = store.carregar().produtos.find((p) => p.id === "p1")!;

      client.alterar("p1", (p) => (p.updated_at = "2026-10-14T09:00:00Z"));
      client.falhaNoDetalhe.set("p1", new ApiError(500, {}));
      const r = await sincronizarCatalogo(client, store, { agora: maisHoras(1) });

      expect(r.falhas.map((f) => f.id)).toEqual(["p1"]);
      expect(store.carregar().produtos.find((p) => p.id === "p1")).toEqual(anterior);
    });

    it("falha no detalhe de produto novo: fica de fora, sem derrubar o resto", async () => {
      const client = new ClienteCatalogoFalso(catalogo(3));
      client.falhaNoDetalhe.set("p0", new ApiError(500, {}));
      const r = await sincronizarCatalogo(client, store, { agora: T0 });
      expect(r.falhas).toHaveLength(1);
      expect(store.carregar().produtos.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    });

    it("produto inativado na listagem sai na hora", async () => {
      const client = new ClienteCatalogoFalso(catalogo(3));
      await sincronizarCatalogo(client, store, { agora: T0 });
      client.alterar("p2", (p) => (p.status = false));

      const r = await sincronizarCatalogo(client, store, { agora: maisHoras(1) });
      expect(r.removidos).toBe(1);
      expect(store.carregar().produtos.map((p) => p.id)).not.toContain("p2");
    });

    it("produto inativado entre a listagem e o detalhe também sai", async () => {
      const client = new ClienteCatalogoFalso(catalogo(2));
      await sincronizarCatalogo(client, store, { agora: T0 });
      client.alterar("p1", (p) => (p.updated_at = "2026-10-14T09:00:00Z")); // força a releitura
      const getProduct = client.getProduct.bind(client);
      // a listagem ainda diz ativo; o detalhe, mais novo, diz inativo
      client.getProduct = async (id) => {
        const r = await getProduct(id);
        return id === "p1" ? { ...r, status: false } : r;
      };

      const r = await sincronizarCatalogo(client, store, { agora: maisHoras(1) });
      expect(r.removidos).toBe(1);
      expect(store.carregar().produtos.map((p) => p.id)).toEqual(["p0"]);
    });

    it("produto que some da listagem só sai após DUAS ausências completas", async () => {
      const client = new ClienteCatalogoFalso(catalogo(3));
      await sincronizarCatalogo(client, store, { agora: T0 });
      const p1 = client.produtos.splice(1, 1)[0];

      let r = await sincronizarCatalogo(client, store, { agora: maisHoras(1) });
      expect(r.removidos).toBe(0);
      expect(store.carregar().produtos.find((p) => p.id === "p1")?.ausencias).toBe(1);

      // voltou: contador zera
      client.produtos.splice(1, 0, p1);
      await sincronizarCatalogo(client, store, { agora: maisHoras(2) });
      expect(store.carregar().produtos.find((p) => p.id === "p1")?.ausencias).toBe(0);

      client.produtos.splice(1, 1);
      await sincronizarCatalogo(client, store, { agora: maisHoras(3) });
      r = await sincronizarCatalogo(client, store, { agora: maisHoras(4) });
      expect(r.removidos).toBe(1);
      expect(store.carregar().produtos.map((p) => p.id)).not.toContain("p1");
    });

    it("listagem cortada pelo teto de páginas não remove ninguém e fica marcada incompleta", async () => {
      const client = new ClienteCatalogoFalso(catalogo(30));
      await sincronizarCatalogo(client, store, { perPage: 10, agora: T0 });

      const r = await sincronizarCatalogo(client, store, { perPage: 10, maxPaginas: 1, agora: maisHoras(1) });
      expect(r.completo).toBe(false);
      expect(r.removidos).toBe(0);
      expect(store.carregar().produtos).toHaveLength(30);
      expect(store.carregar().completo).toBe(false);
    });

    it("é idempotente", async () => {
      const client = new ClienteCatalogoFalso(catalogo(8));
      await sincronizarCatalogo(client, store, { agora: T0 });
      const a = JSON.stringify(store.carregar().produtos);
      await sincronizarCatalogo(client, store, { agora: T0 });
      expect(JSON.stringify(store.carregar().produtos)).toBe(a);
    });
  });
});

describe("construirRegistro", () => {
  it("limpa HTML da descrição e limita o tamanho", () => {
    const p = produto({ id: "x", nome: "Caneta", descricao: "<b>Linda</b> caneta " + "a".repeat(2000) });
    const r = construirRegistro(p, T0);
    expect(r.descricao.startsWith("Linda caneta")).toBe(true);
    expect(r.descricao.length).toBeLessThanOrEqual(600);
  });

  it("junta nome e descrição da categoria (a API real manda o rótulo em description)", () => {
    const p = produto({ id: "x", nome: "Caneta" });
    p.categories = [{ id: "1", name: "Papelaria", description: "Canetas" }];
    expect(construirRegistro(p, T0).categorias).toEqual(["Papelaria", "Canetas"]);
  });

  it("quantidade mínima nunca é menor que 1", () => {
    const p = produto({ id: "x", nome: "Caneta", min: 0 });
    expect(construirRegistro(p, T0).quantidade_minima).toBe(1);
  });
});

describe("FileProductIndexStore", () => {
  it("grava, relê e devolve a mesma referência enquanto o arquivo não muda", async () => {
    const dir = mkdtempSync(join(tmpdir(), "idx-"));
    const file = join(dir, "i.json");
    const store = new FileProductIndexStore(file);
    expect(store.carregar().produtos).toEqual([]);

    await sincronizarCatalogo(new ClienteCatalogoFalso(catalogo(3)), store, { agora: T0 });
    const a = store.carregar();
    expect(a.produtos).toHaveLength(3);
    expect(store.carregar()).toBe(a); // referência estável: o motor de busca depende disso
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("arquivo corrompido vira índice vazio, não exceção", () => {
    const dir = mkdtempSync(join(tmpdir(), "idx-"));
    const file = join(dir, "i.json");
    writeFileSync(file, "{ truncado", "utf-8");
    expect(new FileProductIndexStore(file).carregar().produtos).toEqual([]);
  });

  it("versão desconhecida é ignorada", () => {
    const dir = mkdtempSync(join(tmpdir(), "idx-"));
    const file = join(dir, "i.json");
    writeFileSync(file, JSON.stringify({ versao: 99, produtos: [{ id: "x" }] }), "utf-8");
    expect(new FileProductIndexStore(file).carregar().produtos).toEqual([]);
    expect(readFileSync(file, "utf-8")).toContain("99"); // não sobrescreveu
  });
});
