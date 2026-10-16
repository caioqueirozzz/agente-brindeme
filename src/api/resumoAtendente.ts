import type { ConversationState } from "../agent/state.js";
import type { MotivoTransferencia, ResumoTransferencia } from "../tools/transferirHumano.js";

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
    orcamentos_na_conversa: estado.orcamentos,
    artes_registradas: estado.artes.map((a) => a.arquivo),
    necessidade: estado.necessidade,
    ultimas_mensagens: estado.historico
      .slice(-4)
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n"),
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
  const linhas = [
    `🔔 *Transferência*${resumo.prioridade === "alta" ? " — prioridade ALTA" : ""}`,
    `Cliente: ${cliente} · ${telefone}`,
    `Motivo: ${resumo.motivo}${resumo.observacao ? ` — ${resumo.observacao}` : ""}`,
  ];
  if (lacunas.length > 0) linhas.push(`Pergunta sem resposta: ${lacunas.join(" | ")}`);
  if (resumo.produtos_discutidos.length > 0) linhas.push(`Produtos: ${resumo.produtos_discutidos.join(", ")}`);
  if (resumo.orcamentos_na_conversa.length > 0) linhas.push(`Orçamentos: ${resumo.orcamentos_na_conversa.join(", ")}`);
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
