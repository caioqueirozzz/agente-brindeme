/**
 * Validação de acessos à API da loja (primeira metade da task da Fase 2).
 *
 *   npm run check:api
 *
 * Confirma base URL, token e esquema de auth, e então exercita cada consulta
 * que o agente usa: produtos, detalhe/SKUs/preços/estoque/imagens, admins e
 * pedido (se a API permitir). Não cria nada — só leitura.
 */
import "dotenv/config";
import { HttpBrindeMeClient } from "../src/integrations/brindeme/httpClient.js";
import { ApiError } from "../src/integrations/brindeme/errors.js";
import { config } from "../src/config.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const ok = (s: string) => console.log(`${GREEN}✓${RESET} ${s}`);
const fail = (s: string) => console.log(`${RED}✗${RESET} ${s}`);
const warn = (s: string) => console.log(`${YELLOW}!${RESET} ${s}`);
const info = (s: string) => console.log(`${GRAY}  ${s}${RESET}`);

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `HTTP ${err.status} — ${JSON.stringify(err.body).slice(0, 200)}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

async function main() {
  console.log(`${BOLD}Validação de acesso — API ${config.storeName}${RESET}`);
  info(`base URL: ${config.brindeMe.baseUrl || "(não configurada)"}`);
  info(
    `auth: ${config.brindeMe.authScheme === "bearer" ? "Authorization: Bearer ***" : `${config.brindeMe.authHeader}: ***`}`
  );
  info(`timeout: ${config.brindeMe.timeoutMs}ms · retries: ${config.brindeMe.maxRetries}`);
  console.log("");

  let client: HttpBrindeMeClient;
  try {
    client = new HttpBrindeMeClient();
  } catch (err) {
    fail(describeError(err));
    info("Preencha BRINDEME_BASE_URL e BRINDEME_TOKEN no .env");
    process.exit(1);
  }

  // 1. Acesso
  const acesso = await client.validarAcesso();
  if (!acesso.ok) {
    fail(`acesso negado: ${acesso.motivo}`);
    if (acesso.status === 401 || acesso.status === 403) {
      info("Tente BRINDEME_AUTH_SCHEME=header com BRINDEME_AUTH_HEADER=X-API-Key");
    }
    process.exit(1);
  }
  ok(`acesso validado — ${acesso.produtos} produto(s) no catálogo`);

  // 2. Produtos: SKUs, preços, disponibilidade, imagens
  let primeiroProdutoId: string | undefined;
  try {
    const lista = await client.listProducts({ per_page: 5 });
    ok(`listProducts — ${lista.data.length} de ${lista.total} (página ${lista.current_page})`);
    primeiroProdutoId = lista.data[0]?.id;

    const semSku = lista.data.filter((p) => !p.sku).length;
    const semImagem = lista.data.filter((p) => !p.images?.length).length;
    const semSubproduto = lista.data.filter((p) => !p.subproducts?.length).length;
    if (semSku) warn(`${semSku} produto(s) sem sku`);
    if (semImagem) warn(`${semImagem} produto(s) sem imagem`);
    if (semSubproduto) warn(`${semSubproduto} produto(s) sem subprodutos (cores/estoque/preços)`);
  } catch (err) {
    fail(`listProducts — ${describeError(err)}`);
  }

  // 3. Detalhe do produto
  if (primeiroProdutoId) {
    try {
      const p = await client.getProduct(primeiroProdutoId);
      ok(`getProduct(${primeiroProdutoId}) — "${p.name}"`);
      info(`min_quantity: ${p.min_quantity} · subprodutos: ${p.subproducts?.length ?? 0} · imagens: ${p.images?.length ?? 0}`);
      const sub = p.subproducts?.[0];
      if (sub) {
        info(`sub[0]: sku=${sub.sku} cor=${sub.color} estoque=${sub.stock} faixas=${sub.prices?.length ?? 0}`);
        if (!sub.prices?.length) warn("subproduto sem tabela de preços — preço por faixa indisponível");
      }
      const precosDistintos = new Set(
        (p.subproducts ?? []).map((s) => JSON.stringify(s.prices))
      ).size;
      if (precosDistintos > 1) {
        info("subprodutos têm tabelas de preço diferentes — detalhar_produto devolve a tabela de cada cor");
      }
    } catch (err) {
      fail(`getProduct — ${describeError(err)}`);
    }
  } else {
    warn("sem produto para testar getProduct");
  }

  // 4. Admins (destino das transferências)
  try {
    const admins = await client.listAdmins();
    ok(`listAdmins — ${admins.length} atendente(s)`);
  } catch (err) {
    fail(`listAdmins — ${describeError(err)}`);
  }

  // 5. Pedido — "se a API permitir". O README registra que GET /order filtra
  //    por vendedor e período, sem busca direta por código.
  const pedidoTeste = process.env.BRINDEME_PEDIDO_TESTE;
  if (!pedidoTeste) {
    warn("consulta de pedido não testada — defina BRINDEME_PEDIDO_TESTE=<código> para verificar");
  } else {
    try {
      const o = await client.getOrder(pedidoTeste);
      ok(`getOrder(${pedidoTeste}) — status "${o.status_name}"`);
      info(`entrega: ${o.shipping_type} · prazo: ${o.shipping_time}`);
      const sensiveis = (["customer_cpf", "file_url", "nfs", "bankslips"] as const).filter(
        (k) => o[k] !== undefined && o[k] !== null
      );
      if (sensiveis.length) {
        info(`campos sensíveis presentes na resposta (filtrados antes de chegar ao cliente): ${sensiveis.join(", ")}`);
      }
    } catch (err) {
      fail(`getOrder — ${describeError(err)}`);
      info("Se for 404/405, a busca por código não existe e precisa do workaround da Fase 2");
    }
  }

  console.log("");
  console.log(`${GRAY}createBudget não é exercitado aqui — é escrita. Teste manualmente quando a spec confirmar o shape.${RESET}`);
}

main().catch((err) => {
  fail(describeError(err));
  process.exit(1);
});
