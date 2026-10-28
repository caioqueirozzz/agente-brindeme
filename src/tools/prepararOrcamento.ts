import { z } from "zod";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { translateApiError } from "../integrations/brindeme/errors.js";
import { arredondar } from "../integrations/brindeme/mappers.js";
import type { ConversationState } from "../agent/state.js";
import { marcaUltimaMensagemCliente, type FichaPedido } from "../agent/state.js";

// Sem CPF, CNPJ nem endereço: quem emite o orçamento coleta no fechamento (decisão de 25/10, LGPD).
export const prepararOrcamentoSchema = z.object({
  tipo: z.enum(["PF", "PJ"]).describe("Tipo de pessoa: PF (física) ou PJ (jurídica)"),
  nome: z.string().min(2).describe("Nome do cliente ou da empresa"),
  email: z.string().email().describe("E-mail válido do cliente"),
  itens: z.array(z.object({
    subproduto_id: z.string(),
    quantidade: z.number().int().min(1),
  })).min(1).max(100),
  prazo_desejado: z.string().max(100).optional().describe("Prazo nas palavras do cliente, sem converter para data (ex.: 'até 20/11'); omita se ele não disse"),
  personalizacao: z.string().max(200).optional().describe("Se já tem a arte e quantas cores, ou se precisa de arte; omita se ele não disse"),
  observacoes: z.string().max(300).optional().describe("Observações adicionais (máx. 300 chars)"),
});

export type PrepararOrcamentoInput = z.infer<typeof prepararOrcamentoSchema>;

export const AVISO_ESTIMATIVA =
  "Valor de tabela com personalização padrão. Personalização fora do padrão, frete e prazo a equipe confirma ao emitir o orçamento.";

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** A mesma linha vai ao cliente e à ficha da equipe: os dois veem o mesmo produto e a mesma cor. */
export function linhaDoItem(i: FichaPedido["resumo"]["itens"][number]): string {
  return `• ${i.quantidade}× ${i.nome_produto}${i.cor ? ` (${i.cor})` : ""} — ${reais(i.preco_unitario)} cada = ${reais(i.subtotal)}`;
}

export async function prepararOrcamentoHandler(
  input: PrepararOrcamentoInput,
  state: ConversationState,
  client: BrindeMeClient
) {
  try {
    const itensSumario = [];
    let totalEstimado = 0;

    // Cache por produto: vários itens podem vir do mesmo produto.
    const cache = new Map<string, Awaited<ReturnType<typeof client.getProduct>>>();

    for (const item of input.itens) {
      // A listagem não traz subprodutos, então não dá para varrer o catálogo:
      // o produto de origem vem do mapa preenchido por buscar/detalhar.
      const produtoId = state.subprodutoParaProduto[item.subproduto_id];
      // buscar_produtos só mostra o id do produto; o modelo às vezes manda esse no lugar da cor.
      if (!produtoId && state.produtosDiscutidos.includes(item.subproduto_id)) {
        const produto = await client.getProduct(item.subproduto_id);
        for (const s of produto.subproducts) state.subprodutoParaProduto[s.id] = produto.id;
        return {
          erro: "informe_a_cor",
          produto: produto.name,
          opcoes: produto.subproducts
            .filter((s) => s.status && s.stock > 0)
            .map((s) => ({ subproduto_id: s.id, cor: s.color, estoque: s.stock })),
          instrucao:
            "Esse id é do produto, não da cor. Use o subproduto_id da cor que o cliente pediu; se ele aceitou qualquer cor, use uma com estoque que cubra a quantidade; se ele não disse, pergunte. Depois chame preparar_orcamento de novo.",
        };
      }
      if (!produtoId) {
        return {
          erro: "subproduto_desconhecido",
          subproduto_id: item.subproduto_id,
          instrucao:
            "Chame detalhar_produto para esse produto antes de preparar o orçamento.",
        };
      }

      let p = cache.get(produtoId);
      if (!p) {
        p = await client.getProduct(produtoId);
        cache.set(produtoId, p);
      }

      const sub = p.subproducts.find((x) => x.id === item.subproduto_id);
      if (!sub) {
        return { erro: "subproduto_nao_encontrado", subproduto_id: item.subproduto_id };
      }
      // Produto desativado na loja com a cor ainda ativa: buscar_produtos já não o sugere, o orçamento também não.
      if (!p.status) {
        return {
          erro: "produto_inativo",
          subproduto_id: item.subproduto_id,
          mensagem: `"${p.name}" não está mais disponível na loja.`,
        };
      }
      if (!sub.status) {
        return {
          erro: "subproduto_inativo",
          subproduto_id: item.subproduto_id,
          mensagem: `O subproduto "${sub.color}" de "${p.name}" está inativo.`,
        };
      }
      if (sub.stock < item.quantidade) {
        // Sem a cor e as alternativas, o modelo chutava a cor no texto e inventava outra quantidade (25/10).
        return {
          erro: "estoque_insuficiente",
          subproduto_id: item.subproduto_id,
          cor: sub.color,
          estoque_disponivel: sub.stock,
          quantidade_solicitada: item.quantidade,
          cores_que_atendem: p.subproducts
            .filter((s) => s.status && s.stock >= item.quantidade)
            .map((s) => ({ subproduto_id: s.id, cor: s.color })),
          instrucao:
            "Diga ao cliente qual cor não tem estoque. Se ele aceitou qualquer cor, prepare de novo com uma de cores_que_atendem; senão, ofereça essas cores. Nunca mude a quantidade sem ele pedir.",
        };
      }
      if (item.quantidade < p.min_quantity) {
        return {
          erro: "abaixo_do_minimo",
          subproduto_id: item.subproduto_id,
          min_quantity: p.min_quantity,
          quantidade_solicitada: item.quantidade,
        };
      }

      const range = sub.prices.find(
        (r) => item.quantidade >= r.min && item.quantidade <= r.max
      );
      // O preço de referência do produto só vale para cor SEM tabela (relatorio-campos-api.md).
      // Com tabela e a quantidade fora de todas as faixas, o resumo mostraria um preço que a loja não pratica.
      if (!range && sub.prices.length > 0) {
        return {
          erro: "sem_faixa_de_preco",
          subproduto_id: item.subproduto_id,
          quantidade_solicitada: item.quantidade,
          faixas: sub.prices.map((r) => ({ min: r.min, max: r.max })),
          instrucao: "A quantidade não está em nenhuma faixa de preço desta cor. Ofereça uma quantidade dentro das faixas ou transfira.",
        };
      }
      const price = range?.price ?? p.price;

      const subtotal = arredondar(price * item.quantidade);
      totalEstimado = arredondar(totalEstimado + subtotal);
      itensSumario.push({
        subproduto_id: item.subproduto_id,
        cor: sub.color,
        nome_produto: p.name,
        quantidade: item.quantidade,
        preco_unitario: price,
        subtotal,
      });
    }

    // O modelo às vezes prepara de novo no turno do "pode enviar": a mesma ficha já foi vista, a confirmação vale.
    const anterior = state.fichaPedido;
    const mesmoPedido =
      anterior !== undefined &&
      anterior.resumo.tipo === input.tipo &&
      anterior.resumo.email.trim().toLowerCase() === input.email.trim().toLowerCase() &&
      chaveDosItens(anterior.resumo.itens) === chaveDosItens(input.itens);

    // Já mostrada e o cliente respondeu: vai à equipe a ficha que ele viu, não a reescrita (20/11 virou 2023-11-20),
    // e pedir confirmação de novo prendia o cliente num laço de "pode enviar" (conversas reais de 25/10).
    if (mesmoPedido && marcaUltimaMensagemCliente(state) !== anterior.mensagemDoResumo) {
      return {
        status: "ficha_ja_apresentada",
        resumo: anterior.resumo,
        instrucao:
          'O cliente já viu esta ficha. Se a última mensagem dele confirma ("pode enviar", "sim", "confirmo"), chame transferir_humano com motivo "orcamento_para_emitir" agora, sem mostrar o resumo de novo. Se não confirma, responda ao que ele disse.',
      };
    }

    const ficha: FichaPedido = {
      mensagemDoResumo: mesmoPedido ? anterior.mensagemDoResumo : marcaUltimaMensagemCliente(state),
      resumo: {
        tipo: input.tipo,
        nome: input.nome,
        email: input.email,
        // Do número da conversa: a ficha não vai no nome de outro telefone.
        telefone: state.telefone,
        itens: itensSumario,
        total_estimado: totalEstimado,
        prazo_desejado: input.prazo_desejado,
        personalizacao: input.personalizacao,
        observacoes: input.observacoes,
        arte_refs: state.artes.map((a) => a.ref),
      },
    };

    state.fichaPedido = ficha;
    state.cliente.tipo = input.tipo;
    state.cliente.nome = input.nome;
    state.cliente.email = input.email;

    return {
      status: "estimativa_pronta",
      resumo: ficha.resumo,
      aviso: AVISO_ESTIMATIVA,
      // Pronto e literal: o modelo reescrevia o produto pedido no lugar do estimado, tirava a cor e trocava palavras do aviso (#26).
      resumo_para_cliente: [
        ...itensSumario.map(linhaDoItem),
        `Total estimado: ${reais(totalEstimado)}`,
        `_${AVISO_ESTIMATIVA}_`,
      ].join("\n"),
      instrucao:
        'Mostre resumo_para_cliente ao cliente exatamente como veio, sem reescrever produto, cor, valores nem o aviso, e pergunte se pode enviar para a equipe emitir o orçamento. Com a confirmação dele numa nova mensagem, chame transferir_humano com motivo "orcamento_para_emitir".',
    };
  } catch (err) {
    return { erro: translateApiError(err) };
  }
}

function chaveDosItens(itens: Array<{ subproduto_id: string; quantidade: number }>): string {
  return itens.map((i) => `${i.subproduto_id}:${i.quantidade}`).sort().join("|");
}
