import type { ZodTypeAny } from "zod";
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

/**
 * Schema da ferramenta no formato que a OpenAI aceita.
 *
 * O alvo `openApi3` emitia a forma booleana do OpenAPI 3.0 para `.positive()`
 * (`exclusiveMinimum: true` + `minimum: 0`), e a OpenAI rejeita com
 * `400 Invalid schema ... True is not of type 'number'`. O alvo padrão
 * (`jsonSchema7`) emite `exclusiveMinimum: 0`, que é o que ela espera.
 * A Anthropic tolerava as duas formas, então isso só apareceu na troca de provedor.
 *
 * `$schema` é removido por ser metadado do documento, não do parâmetro.
 */
function schemaDaFerramenta(schema: ZodTypeAny): object {
  const { $schema: _descartado, ...corpo } = zodToJsonSchema(schema) as Record<string, unknown>;
  return corpo;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
  /** Conferido em runTurn antes do handler: o modelo pode mandar campo errado, a mais ou fora do tipo. */
  schema: ZodTypeAny;
  handler(input: unknown, state: ConversationState, client: BrindeMeClient): Promise<unknown>;
}

export const tools: ToolDefinition[] = [
  {
    name: "consultar_conhecimento",
    description:
      "Consulta a base de conhecimento aprovada da loja: como funciona o pedido, formatos de arte, prazos, entrega, formas de pagamento, trocas e defeitos, horário e endereço. Use para qualquer dúvida geral sobre a loja. Se a base não cobrir a pergunta, o retorno manda transferir — nunca responda política, prazo ou condição de memória.",
    inputSchema: schemaDaFerramenta(consultarConhecimentoSchema),
    schema: consultarConhecimentoSchema,
    handler: consultarConhecimentoHandler as ToolDefinition["handler"],
  },
  {
    name: "buscar_produtos",
    description:
      "Recomenda até 3 produtos da loja a partir do que o cliente procura (palavras-chave, ocasião), da quantidade e do valor (por unidade ou total). Só devolve produtos que respeitam quantidade mínima, estoque e valor, com preço da faixa de quantidade e total estimado, conferidos na plataforma. Use sempre que o cliente pedir recomendação ou sugestão. Nunca cite produto, preço ou estoque que não tenha vindo desta ferramenta ou de detalhar_produto.",
    inputSchema: schemaDaFerramenta(buscarProdutosSchema),
    schema: buscarProdutosSchema,
    handler: buscarProdutosHandler as ToolDefinition["handler"],
  },
  {
    name: "detalhar_produto",
    description:
      "Retorna detalhes completos de um produto: subprodutos ativos, cores, estoque, tabela de preços por faixa e personalizações. Use quando o cliente pedir mais informações sobre um produto específico, com o id que veio de buscar_produtos.",
    inputSchema: schemaDaFerramenta(detalharProdutoSchema),
    schema: detalharProdutoSchema,
    handler: detalharProdutoHandler as ToolDefinition["handler"],
  },
  {
    name: "preparar_orcamento",
    description:
      "Valida os itens, calcula preços estimados e gera um resumo + token de confirmação. DEVE ser chamada antes de criar_orcamento. O cliente precisa ver o resumo e confirmar explicitamente antes da criação.",
    inputSchema: schemaDaFerramenta(prepararOrcamentoSchema),
    schema: prepararOrcamentoSchema,
    handler: prepararOrcamentoHandler as ToolDefinition["handler"],
  },
  {
    name: "criar_orcamento",
    description:
      "Cria o orçamento na plataforma usando o token gerado por preparar_orcamento. Só chame após confirmação explícita do cliente. Idempotente: chamar duas vezes com o mesmo token retorna o mesmo orçamento.",
    inputSchema: schemaDaFerramenta(criarOrcamentoSchema),
    schema: criarOrcamentoSchema,
    handler: criarOrcamentoHandler as ToolDefinition["handler"],
  },
  {
    name: "consultar_orcamento",
    description:
      "Consulta o status de um orçamento pelo código. Só retorna orçamentos criados nesta conversa.",
    inputSchema: schemaDaFerramenta(consultarOrcamentoSchema),
    schema: consultarOrcamentoSchema,
    handler: consultarOrcamentoHandler as ToolDefinition["handler"],
  },
  {
    name: "consultar_pedido",
    description:
      "Consulta status e prazo de entrega de um pedido. Valida o telefone do cliente; se não bater, solicita o e-mail. Nunca retorna dados sensíveis (CPF, e-mail, boleto, NF).",
    inputSchema: schemaDaFerramenta(consultarPedidoSchema),
    schema: consultarPedidoSchema,
    handler: consultarPedidoHandler as ToolDefinition["handler"],
  },
  {
    name: "registrar_arte",
    description:
      "Registra a arte que o cliente enviou. Pelo WhatsApp o arquivo aparece como [ARQUIVO recebido: <nome> (...)]; passe esse <nome> em descricao_arquivo. Valida o formato.",
    inputSchema: schemaDaFerramenta(registrarArteSchema),
    schema: registrarArteSchema,
    handler: registrarArteHandler as ToolDefinition["handler"],
  },
  {
    name: "transferir_humano",
    description:
      "Transfere o atendimento para um humano. Use quando: o cliente pedir atendente, houver reclamação, 2 falhas seguidas de ferramenta, desconto/pagamento/frete específico, arte problemática ou intenção não entendida após 2 tentativas.",
    inputSchema: schemaDaFerramenta(transferirHumanoSchema),
    schema: transferirHumanoSchema,
    handler: transferirHumanoHandler as ToolDefinition["handler"],
  },
];

export const toolMap = new Map<string, ToolDefinition>(tools.map((t) => [t.name, t]));
