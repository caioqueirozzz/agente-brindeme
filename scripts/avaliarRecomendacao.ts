/**
 * Avaliação da recomendação (critério de pronto da Fase 3).
 *
 *   npm run avaliar:recomendacao
 *   npm run avaliar:recomendacao -- --arquivo evals/recomendacao/pedidos.json
 *
 * Para cada pedido do arquivo (a loja escreve 30), roda a recomendação contra o
 * índice e a API configurados e:
 *   1. CONFERE sozinho que toda sugestão respeita mínimo, estoque e orçamento,
 *      relendo cada produto na API e recalculando com o verificador independente
 *      (src/catalogo/verificacao.ts) — parte automática do critério;
 *   2. gera uma planilha em logs/avaliacao-recomendacao-AAAA-MM-DD.md para a
 *      equipe marcar se cada sugestão é adequada — a parte humana do critério.
 *
 * Somente leitura na API. Sai com código 1 se encontrar qualquer violação.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createBrindeMeClient } from "../src/integrations/brindeme/factory.js";
import { FileProductIndexStore } from "../src/catalogo/indice.js";
import { FileOccasionTagStore } from "../src/catalogo/ocasioes.js";
import { recomendar, type PedidoRecomendacao, type Recomendacao } from "../src/catalogo/recomendar.js";
import { verificarSugestao } from "../src/catalogo/verificacao.js";
import { config } from "../src/config.js";

const __dir = dirname(fileURLToPath(import.meta.url));

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

interface PedidoJson {
  id: string;
  pedido: string;
  consulta: string;
  quantidade?: number;
  preco_max_unitario?: number;
  orcamento_total?: number;
  ocasiao?: string;
}

const real = (n: number): string => `R$ ${n.toFixed(2).replace(".", ",")}`;

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const arquivo = resolve(argumento("arquivo") ?? join(__dir, "../evals/recomendacao/pedidos.json"));
  const pedidos: PedidoJson[] = JSON.parse(readFileSync(arquivo, "utf-8")).pedidos;

  const client = createBrindeMeClient({ reqPorMinuto: config.catalogo.reqPorMinuto });
  const index = new FileProductIndexStore();
  const tags = new FileOccasionTagStore();
  const indice = index.carregar();

  if (indice.produtos.length === 0) {
    console.error(`${RED}✗${RESET} índice de catálogo vazio. Rode antes: npm run sync:catalogo`);
    process.exit(1);
  }

  console.log(`${BOLD}Avaliação da recomendação — ${config.storeName}${RESET}`);
  console.log(
    `${GRAY}  ${pedidos.length} pedido(s) · índice com ${indice.produtos.length} produto(s) sincronizado(s) em ${indice.sincronizado_em || "?"} · API: ${config.brindeMe.mode}${RESET}\n`
  );

  let comSugestao = 0;
  let semResposta = 0;
  let violacoesTotal = 0;
  let sugestoesTotal = 0;
  const planilha: string[] = [];

  for (const p of pedidos) {
    const pedido: PedidoRecomendacao = {
      consulta: p.consulta,
      quantidade: p.quantidade,
      precoMaxUnitario: p.preco_max_unitario,
      orcamentoTotal: p.orcamento_total,
      ocasiao: p.ocasiao,
    };
    const r: Recomendacao = await recomendar(pedido, { index, tags, client });

    const parametros = [
      `consulta "${p.consulta}"`,
      p.quantidade ? `${p.quantidade} un` : null,
      p.preco_max_unitario ? `até ${real(p.preco_max_unitario)}/un` : null,
      p.orcamento_total ? `total ${real(p.orcamento_total)}` : null,
      p.ocasiao ? `ocasião ${p.ocasiao}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    planilha.push(`### ${p.id} — ${p.pedido}`, `_${parametros}_`, "");

    if (r.tipo === "encontrados") {
      comSugestao++;
      const violacoesDoPedido: string[] = [];
      planilha.push("| Produto | Preço un. | Total estimado | Cores | Mínimo |", "|---|---|---|---|---|");
      for (const item of r.itens) {
        sugestoesTotal++;
        // Releitura independente: o dado que a recomendação usou veio da mesma API,
        // mas o cálculo do verificador não passa por oferta.ts.
        const cru = await client.getProduct(item.produto.id);
        const v = verificarSugestao(
          cru,
          {
            quantidade: item.oferta.quantidade,
            preco_unitario: item.oferta.preco_unitario,
            total_estimado: item.oferta.total_estimado,
            cores: item.oferta.cores,
          },
          { quantidade: p.quantidade, precoMaxUnitario: p.preco_max_unitario, orcamentoTotal: p.orcamento_total }
        );
        violacoesTotal += v.length;
        violacoesDoPedido.push(...v.map((x) => `${item.produto.nome}: [${x.regra}] ${x.detalhe}`));
        planilha.push(
          `| ${item.produto.nome} (${item.produto.sku}) | ${real(item.oferta.preco_unitario)} | ${real(item.oferta.total_estimado)}${item.oferta.quantidade_informada ? "" : " (no mínimo)"} | ${item.oferta.cores.map((c) => c.cor).join(", ")} | ${item.produto.quantidade_minima} |`
        );
      }
      const marca = violacoesDoPedido.length ? `${RED}✗${RESET}` : `${GREEN}✓${RESET}`;
      console.log(`${marca} ${p.id} ${p.pedido}\n  ${GRAY}${r.itens.map((i) => `${i.produto.nome} ${real(i.oferta.preco_unitario)}`).join(" | ")}${RESET}`);
      for (const v of violacoesDoPedido) console.log(`  ${RED}violação: ${v}${RESET}`);
      if (violacoesDoPedido.length) planilha.push("", ...violacoesDoPedido.map((v) => `> ⚠ VIOLAÇÃO: ${v}`));
    } else if (r.tipo === "nenhum") {
      semResposta++;
      const ajustes = r.ajustes.map((a) =>
        a.tipo === "aumentar_orcamento"
          ? `subir o valor para ${real(a.preco_unitario_minimo)}/un (${a.nome}, ${a.quantidade} un = ${real(a.total_estimado)})`
          : `${a.tipo === "aumentar_quantidade" ? "subir" : "reduzir"} para ${a.quantidade} un (${a.nome}, ${real(a.preco_unitario)}/un = ${real(a.total_estimado)})`
      );
      console.log(`${YELLOW}–${RESET} ${p.id} ${p.pedido}\n  ${GRAY}sem sugestão (${r.motivo})${ajustes.length ? ` · ajustes: ${ajustes.join("; ")}` : ""}${RESET}`);
      planilha.push(
        `**Sem sugestão** — ${r.motivo === "sem_correspondencia" ? "nada no catálogo corresponde ao pedido" : "as regras não fecham"}.`,
        ...(ajustes.length ? ["", ...ajustes.map((a) => `- Ajuste proposto: ${a}`)] : [])
      );
    } else {
      semResposta++;
      const motivo = r.tipo === "falha_api" ? `falha de API (${r.erro.erro})` : "índice vazio";
      console.log(`${RED}✗${RESET} ${p.id} ${p.pedido}\n  ${RED}${motivo}${RESET}`);
      planilha.push(`**Não avaliado** — ${motivo}.`);
      violacoesTotal++;
    }

    planilha.push(
      "",
      "Avaliação da equipe: ☐ adequada  ☐ aceitável  ☐ inadequada — comentário: ____________________",
      ""
    );
  }

  const dir = join(__dir, "../logs");
  mkdirSync(dir, { recursive: true });
  const saida = join(dir, `avaliacao-recomendacao-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(
    saida,
    [
      "# Avaliação da recomendação — Fase 3",
      "",
      `Gerada em ${new Date().toISOString()} · ${pedidos.length} pedidos · índice de ${indice.sincronizado_em || "?"}`,
      "",
      "Marque cada pedido. Critério de pronto: toda sugestão respeita mínimo, estoque e orçamento (conferido automaticamente abaixo) **e** a equipe a considera adequada.",
      "",
      ...planilha,
    ].join("\n"),
    "utf-8"
  );

  console.log(
    `\n${BOLD}Resumo${RESET}: ${comSugestao}/${pedidos.length} com sugestão, ${semResposta} sem sugestão, ${sugestoesTotal} sugestão(ões) conferida(s) na API.`
  );
  if (violacoesTotal === 0) {
    console.log(`${GREEN}✓ nenhuma violação de mínimo, estoque ou orçamento.${RESET}`);
  } else {
    console.log(`${RED}✗ ${violacoesTotal} violação(ões) — veja acima.${RESET}`);
  }
  console.log(`${GRAY}Planilha para a equipe: ${saida}${RESET}`);

  if (violacoesTotal > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`${RED}✗${RESET} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
