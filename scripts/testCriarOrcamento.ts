/**
 * Exercita POST /budget contra a API real (Fase 2, validação de acessos).
 *
 * ATENÇÃO: não há ambiente de testes — isto CRIA UM ORÇAMENTO REAL.
 * Por isso marca origin = agente-ia-teste e nome do cliente com [TESTE],
 * como o planejamento recomenda. Os códigos criados são impressos no fim
 * para a loja excluir ou cancelar.
 *
 *   npm run test:orcamento -- --pf
 *   npm run test:orcamento -- --pj
 */
import "dotenv/config";
import { HttpBrindeMeClient } from "../src/integrations/brindeme/httpClient.js";
import { ApiError } from "../src/integrations/brindeme/errors.js";
import type { CreateBudgetBody } from "../src/integrations/brindeme/types.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const ORIGIN = "agente-ia-teste";

async function main() {
  const client = new HttpBrindeMeClient();

  // Produto real com min_quantity conhecido.
  const lista = await client.listProducts({ per_page: 20 });
  let escolhido: { subId: string; produto: string; min: number } | null = null;
  for (const p of lista.data) {
    const det = await client.getProduct(p.id);
    const sub = det.subproducts.find((s) => s.status && s.stock > det.min_quantity);
    if (sub) {
      escolhido = { subId: sub.id, produto: det.name, min: det.min_quantity };
      break;
    }
  }
  if (!escolhido) throw new Error("nenhum subproduto ativo com estoque encontrado");

  console.log(`${GRAY}produto: ${escolhido.produto} · subproduto: ${escolhido.subId} · min: ${escolhido.min}${RESET}`);

  const pj = process.argv.includes("--pj");
  const base: CreateBudgetBody = {
    type: pj ? "PJ" : "PF",
    customer_name: pj ? "[TESTE AGENTE IA] Empresa Exemplo LTDA" : "[TESTE AGENTE IA] Fulano de Tal",
    customer_phone: "5583900000000",
    customer_email: "teste-agente-ia@exemplo.test",
    items: [{ subproduct_id: escolhido.subId, quantity: escolhido.min }],
    comments: "Orçamento de teste do agente de IA — pode ser excluído.",
    origin: ORIGIN,
  };

  // O planejamento registra que a descrição cita trade_name e cnpj para PJ,
  // mas eles não estão no schema. Testamos se a API aceita os campos extras.
  const body = pj
    ? ({ ...base, cnpj: "11.222.333/0001-81", trade_name: "Empresa Exemplo" } as CreateBudgetBody)
    : base;

  console.log(`${BOLD}POST /budget (${base.type})${RESET}`);
  try {
    const orcamento = await client.createBudget(body, { idempotencyKey: `teste-${Date.now()}` });
    console.log(`${GREEN}✓${RESET} criado — código ${BOLD}${orcamento.code}${RESET} · status "${orcamento.status_name}"`);
    console.log(`${GRAY}  id: ${orcamento.id}${RESET}`);
    console.log(`${GRAY}  itens: ${orcamento.items.length} · total: R$ ${orcamento.items.reduce((a, i) => a + i.subtotal, 0).toFixed(2)}${RESET}`);
    console.log(`${YELLOW}  ⚠ orçamento REAL — peça à loja para excluir (origin=${ORIGIN})${RESET}`);
  } catch (err) {
    if (err instanceof ApiError) {
      console.log(`${RED}✗${RESET} HTTP ${err.status}`);
      console.log(`${GRAY}  ${JSON.stringify(err.body).slice(0, 600)}${RESET}`);
    } else {
      console.log(`${RED}✗${RESET} ${String(err)}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
