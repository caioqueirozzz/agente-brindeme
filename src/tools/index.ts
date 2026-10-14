import { zodToJsonSchema } from "zod-to-json-schema";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import type { ConversationState } from "../agent/state.js";

import { consultarConhecimentoSchema, consultarConhecimentoHandler } from "./consultarConhecimento.js";
import { buscarProdutosSchema, buscarProdutosHandler } from "./buscarProdutos.js";
import { detalharProdutoSchema, detalharProdutoHandler } from "./detalharProduto.js";
import { prepararOrcamentoSchema, prepararOrcamentoHandler } from "./prepararOrcamento.js";
import { criarOrcamentoSchema, criarOrcamentoHandler } from "./criarOrcamento.js";
import { consultarOrcamentoSchema, consultarOrcamentoHandler } from "./consultarOrcamento.js";
import { consultarPedidoSchema, consultarPedidoHandler } from "./consultarPedido.js";
import { registrarArteSchema, registrarArteHandler } from "./registrarArte.js";
import { transferirHumanoSchema, transferirHumanoHandler } from "./transferirHumano.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
  handler(input: unknown, state: ConversationState, client: BrindeMeClient): Promise<unknown>;
}

export const tools: ToolDefinition[] = [
  {
    name: "consultar_conhecimento",
    description:
      "Consulta a base de conhecimento aprovada da loja: como funciona o pedido, formatos de arte, prazos, entrega, formas de pagamento, trocas e defeitos, horário e endereço. Use para qualquer dúvida geral sobre a loja. Se a base não cobrir a pergunta, o retorno manda transferir — nunca responda política, prazo ou condição de memória.",
    inputSchema: zodToJsonSchema(consultarConhecimentoSchema, { target: "openApi3" }),
    handler: consultarConhecimentoHandler as ToolDefinition["handler"],
  },
  {
    name: "buscar_produtos",
    description:
      "Recomenda até 3 produtos da loja a partir do que o cliente procura (palavras-chave, ocasião), da quantidade e do valor (por unidade ou total). Só devolve produtos que respeitam quantidade mínima, estoque e valor, com preço da faixa de quantidade e total estimado, conferidos na plataforma. Use sempre que o cliente pedir recomendação ou sugestão. Nunca cite produto, preço ou estoque que não tenha vindo desta ferramenta ou de detalhar_produto.",
    inputSchema: zodToJsonSchema(buscarProdutosSchema, { target: "openApi3" }),
    handler: buscarProdutosHandler as ToolDefinition["handler"],
  },
  {
    name: "detalhar_produto",
    description:
      "Retorna detalhes completos de um produto: subprodutos ativos, cores, estoque, tabela de preços por faixa e personalizações. Use quando o cliente pedir mais informações sobre um produto específico.",
    inputSchema: zodToJsonSchema(detalharProdutoSchema, { target: "openApi3" }),
    handler: detalharProdutoHandler as ToolDefinition["handler"],
  },
  {
    name: "preparar_orcamento",
    description:
      "Valida os itens, calcula preços estimados e gera um resumo + token de confirmação. DEVE ser chamada antes de criar_orcamento. O cliente precisa ver o resumo e confirmar explicitamente antes da criação.",
    inputSchema: zodToJsonSchema(prepararOrcamentoSchema, { target: "openApi3" }),
    handler: prepararOrcamentoHandler as ToolDefinition["handler"],
  },
  {
    name: "criar_orcamento",
    description:
      "Cria o orçamento na plataforma usando o token gerado por preparar_orcamento. Só chame após confirmação explícita do cliente. Idempotente: chamar duas vezes com o mesmo token retorna o mesmo orçamento.",
    inputSchema: zodToJsonSchema(criarOrcamentoSchema, { target: "openApi3" }),
    handler: criarOrcamentoHandler as ToolDefinition["handler"],
  },
  {
    name: "consultar_orcamento",
    description:
      "Consulta o status de um orçamento pelo código. Só retorna orçamentos criados nesta conversa.",
    inputSchema: zodToJsonSchema(consultarOrcamentoSchema, { target: "openApi3" }),
    handler: consultarOrcamentoHandler as ToolDefinition["handler"],
  },
  {
    name: "consultar_pedido",
    description:
      "Consulta status e prazo de entrega de um pedido. Valida o telefone do cliente; se não bater, solicita o e-mail. Nunca retorna dados sensíveis (CPF, e-mail, boleto, NF).",
    inputSchema: zodToJsonSchema(consultarPedidoSchema, { target: "openApi3" }),
    handler: consultarPedidoHandler as ToolDefinition["handler"],
  },
  {
    name: "registrar_arte",
    description:
      "Registra a arte enviada pelo cliente (simula recebimento de arquivo no terminal via /arte). Valida a extensão do arquivo.",
    inputSchema: zodToJsonSchema(registrarArteSchema, { target: "openApi3" }),
    handler: registrarArteHandler as ToolDefinition["handler"],
  },
  {
    name: "transferir_humano",
    description:
      "Transfere o atendimento para um humano. Use quando: o cliente pedir atendente, houver reclamação, 2 falhas seguidas de ferramenta, desconto/pagamento/frete específico, arte problemática ou intenção não entendida após 2 tentativas.",
    inputSchema: zodToJsonSchema(transferirHumanoSchema, { target: "openApi3" }),
    handler: transferirHumanoHandler as ToolDefinition["handler"],
  },
];

export const toolMap = new Map<string, ToolDefinition>(tools.map((t) => [t.name, t]));
