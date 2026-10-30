import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import type { ConversationState } from "../agent/state.js";

import { consultarConhecimentoSchema, consultarConhecimentoHandler } from "./consultarConhecimento.js";
import { buscarProdutosSchema, buscarProdutosHandler } from "./buscarProdutos.js";
import { detalharProdutoSchema, detalharProdutoHandler } from "./detalharProduto.js";
import { prepararOrcamentoSchema, prepararOrcamentoHandler } from "./prepararOrcamento.js";
import { consultarPedidoSchema, consultarPedidoHandler } from "./consultarPedido.js";
import { registrarArteSchema, registrarArteHandler } from "./registrarArte.js";
import { transferirHumanoSchema, transferirHumanoHandler } from "./transferirHumano.js";
import { registrarContextoSchema, registrarContextoHandler } from "./registrarContexto.js";
import { andamentoPedidoSchema, andamentoPedidoHandler } from "./andamentoPedido.js";

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
      "Consulta a base de conhecimento aprovada da loja: como funciona o pedido, formatos de arte, prazos, entrega, formas de pagamento, trocas e defeitos, horário e endereço. Use para dúvida sobre como a loja funciona. Não use para pedido de orçamento, produto, preço, estoque ou status de pedido (use as ferramentas de catálogo, orçamento e pedido), nem para assunto fora da loja. Se a base não cobrir a pergunta, o retorno manda transferir — nunca responda política, prazo ou condição de memória.",
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
      "Retorna detalhes completos de um produto: subprodutos ativos, cores, estoque, tabela de preços por faixa e personalizações. Use quando o cliente pedir mais informações sobre um produto específico, com o id que veio de buscar_produtos. Com quantidade, diga quais cores cobrem o pedido pelo campo cores_que_atendem_quantidade, sem comparar estoque de cabeça.",
    inputSchema: schemaDaFerramenta(detalharProdutoSchema),
    schema: detalharProdutoSchema,
    handler: detalharProdutoHandler as ToolDefinition["handler"],
  },
  {
    name: "preparar_orcamento",
    description:
      "Valida os itens (cor, estoque, quantidade mínima, faixa de preço) e calcula a estimativa de tabela para a equipe emitir o orçamento. Cada item é um subproduto (produto + cor): o subproduto_id da cor pedida vem de subprodutos em buscar_produtos, de subprodutos_ativos em detalhar_produto ou de produtos_detalhados no estado da conversa; nunca use o id do produto e nunca invente. O cliente vê o resumo e confirma; depois, transferir_humano com motivo orcamento_para_emitir leva a estimativa à equipe.",
    inputSchema: schemaDaFerramenta(prepararOrcamentoSchema),
    schema: prepararOrcamentoSchema,
    handler: prepararOrcamentoHandler as ToolDefinition["handler"],
  },
  {
    name: "andamento_pedido",
    description:
      "Andamento dos pedidos do cliente na operação da loja (pedido confirmado, arte e mockup, produção, personalização, conferência, envio, entregue), com previsão de entrega e recado da equipe. Use primeiro sempre que o cliente perguntar como está o pedido dele, com ou sem código: o telefone da conversa já identifica o cliente. Se não houver pedido no quadro e o cliente tiver um código, use consultar_pedido.",
    inputSchema: schemaDaFerramenta(andamentoPedidoSchema),
    schema: andamentoPedidoSchema,
    handler: andamentoPedidoHandler as ToolDefinition["handler"],
  },
  {
    name: "consultar_pedido",
    description:
      "Consulta status e prazo de entrega de um pedido. Basta o código: o telefone da conversa é validado sozinho. Só passe o e-mail se o retorno anterior foi precisa_email. Nunca retorna dados sensíveis (CPF, e-mail, boleto, NF).",
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
    name: "registrar_contexto",
    description:
      "Memória da conversa: guarda o que o cliente contou para você lembrar nos próximos turnos. Chame assim que souber se é PF ou PJ, o nome pelo qual quer ser chamado, a empresa, a ocasião ou um detalhe importante (número de pessoas, data do evento, preferência de cor, compra anterior). Pode ir junto de outra ferramenta na mesma resposta. Não registre o que já está no estado da conversa nem dados sensíveis (CPF, CNPJ, endereço).",
    inputSchema: schemaDaFerramenta(registrarContextoSchema),
    schema: registrarContextoSchema,
    handler: registrarContextoHandler as ToolDefinition["handler"],
  },
  {
    name: "transferir_humano",
    description:
      "Transfere o atendimento para um humano. Use quando: o cliente confirmar a estimativa de preparar_orcamento (motivo orcamento_para_emitir: a equipe emite o orçamento), pedir status de orçamento, o cliente pedir atendente (motivo pedido_cliente), houver reclamação, 2 falhas seguidas de ferramenta, desconto/pagamento/frete específico, arte problemática ou intenção não entendida após 2 tentativas.",
    inputSchema: schemaDaFerramenta(transferirHumanoSchema),
    schema: transferirHumanoSchema,
    handler: transferirHumanoHandler as ToolDefinition["handler"],
  },
];

export const toolMap = new Map<string, ToolDefinition>(tools.map((t) => [t.name, t]));
