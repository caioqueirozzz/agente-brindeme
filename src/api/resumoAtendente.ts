import { nomesDosProdutos, ultimasMensagens, type ConversationState } from "../agent/state.js";
import type { MotivoTransferencia, ResumoTransferencia } from "../tools/transferirHumano.js";
import { AVISO_ESTIMATIVA, linhaDoItem, reais } from "../tools/prepararOrcamento.js";

export function resumoDoEstado(
  estado: ConversationState,
  motivo: MotivoTransferencia,
  observacao?: string
): ResumoTransferencia {
  return {
    conversaId: estado.conversaId,
    telefone_cliente: estado.telefone,
    cliente: estado.cliente,
    motivo,
    prioridade: "alta",
    ...(observacao ? { observacao } : {}),
    produtos_discutidos: estado.produtosDiscutidos,
    produtos_nomes: nomesDosProdutos(estado),
    ...(estado.fichaPedido ? { ficha_pedido: estado.fichaPedido.resumo } : {}),
    artes_registradas: estado.artes.map((a) => a.arquivo),
    necessidade: estado.necessidade,
    ultimas_mensagens: ultimasMensagens(estado),
    responsavel: { id: "sistema", nome: "Equipe" },
    transferido_em: new Date().toISOString(),
  };
}

export function formatarAvisoTransferencia(
  telefone: string,
  resumo: ResumoTransferencia,
  lacunas: string[] = []
): string {
  const cliente = [resumo.cliente.nome, resumo.cliente.tipo].filter(Boolean).join(" · ") || "sem nome";
  // A ficha é a verdade do orçamento: o texto do modelo e a lista de produtos discutidos podiam contradizê-la (#26).
  const soAFicha = resumo.motivo === "orcamento_para_emitir" && resumo.ficha_pedido !== undefined;
  const linhas = [
    `🔔 *Transferência*${resumo.prioridade === "alta" ? " — prioridade ALTA" : ""}`,
    `Cliente: ${cliente} · ${telefone}`,
    `Motivo: ${resumo.motivo}${resumo.observacao && !soAFicha ? ` — ${resumo.observacao}` : ""}`,
  ];
  if (lacunas.length > 0) linhas.push(`Pergunta sem resposta: ${lacunas.join(" | ")}`);
  if (resumo.produtos_nomes.length > 0 && !soAFicha) linhas.push(`Produtos: ${resumo.produtos_nomes.join(", ")}`);
  if (resumo.ficha_pedido) linhas.push("", ...linhasDaFicha(resumo.ficha_pedido));
  if (resumo.artes_registradas.length > 0) linhas.push(`Artes: ${resumo.artes_registradas.join(", ")}`);
  if (resumo.ultimas_mensagens) {
    linhas.push(
      "",
      "Últimas mensagens:",
      resumo.ultimas_mensagens.replace(/^\[user\]/gm, "[cliente]").replace(/^\[assistant\]/gm, "[agente]")
    );
  }
  linhas.push("", `Para devolver: #devolver ${telefone} [nota]`);
  return linhas.join("\n");
}

/** O que o atendente precisa para emitir o orçamento na loja (requisito R5: o agente estima, pessoa emite). */
function linhasDaFicha(f: NonNullable<ResumoTransferencia["ficha_pedido"]>): string[] {
  return [
    "📋 *Orçamento para emitir*",
    `${f.tipo} · ${f.nome} · ${f.email}`,
    ...f.itens.map(linhaDoItem),
    `Total estimado: ${reais(f.total_estimado)}`,
    ...(f.prazo_desejado ? [`Prazo desejado: ${f.prazo_desejado}`] : []),
    ...(f.personalizacao ? [`Personalização: ${f.personalizacao}`] : []),
    ...(f.observacoes ? [`Obs.: ${f.observacoes}`] : []),
    ...(f.arte_refs.length > 0 ? [`Artes: ${f.arte_refs.join(", ")}`] : []),
    `_${AVISO_ESTIMATIVA}_`,
  ];
}
