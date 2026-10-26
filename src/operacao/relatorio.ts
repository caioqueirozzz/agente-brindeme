/**
 * Números do piloto a partir dos logs de conversa (logs/<conversaId>.jsonl).
 * Substitui, para o piloto, as métricas ao vivo da Fase 5 (C4, não entregue): é lido depois, não em tempo real.
 * Os logs já saem mascarados pelo Logger, então o relatório também.
 */
export interface EventoLog {
  timestamp?: string;
  type?: string;
  [campo: string]: unknown;
}

export interface ResumoPiloto {
  periodo: { de: string | null; ate: string | null };
  conversas: number;
  mensagensRecebidas: number;
  respostasEnviadas: number;
  tokens: { entrada: number; saida: number };
  ferramentas: Record<string, number>;
  errosDeFerramenta: Record<string, number>;
  transferencias: { total: number; porMotivo: Record<string, number>; conversasTransferidas: number };
  /** Transferências com a estimativa para a equipe emitir (R5). */
  orcamentosParaEmitir: number;
  lacunas: Array<{ pergunta: string; vezes: number }>;
  alertas: Record<string, number>;
  mensagensComAgenteSuspenso: number;
}

const somar = (m: Record<string, number>, chave: string) => (m[chave] = (m[chave] ?? 0) + 1);

/** `eventosPorConversa`: um array por arquivo de log (uma conversa). */
export function resumirLogs(eventosPorConversa: EventoLog[][], desde?: string): ResumoPiloto {
  const r: ResumoPiloto = {
    periodo: { de: null, ate: null },
    conversas: 0,
    mensagensRecebidas: 0,
    respostasEnviadas: 0,
    tokens: { entrada: 0, saida: 0 },
    ferramentas: {},
    errosDeFerramenta: {},
    transferencias: { total: 0, porMotivo: {}, conversasTransferidas: 0 },
    orcamentosParaEmitir: 0,
    lacunas: [],
    alertas: {},
    mensagensComAgenteSuspenso: 0,
  };
  const lacunas: Record<string, number> = {};

  for (const todos of eventosPorConversa) {
    const eventos = todos.filter((e) => !desde || (e.timestamp ?? "") >= desde);
    if (eventos.length === 0) continue;
    r.conversas++;
    let transferida = false;
    for (const e of eventos) {
      if (e.timestamp) {
        if (!r.periodo.de || e.timestamp < r.periodo.de) r.periodo.de = e.timestamp;
        if (!r.periodo.ate || e.timestamp > r.periodo.ate) r.periodo.ate = e.timestamp;
      }
      switch (e.type) {
        case "message_received":
          r.mensagensRecebidas++;
          break;
        case "response_sent":
          r.respostasEnviadas++;
          r.tokens.entrada += Number(e.input_tokens ?? 0);
          r.tokens.saida += Number(e.output_tokens ?? 0);
          break;
        case "tool_call": {
          const nome = String(e.name);
          somar(r.ferramentas, nome);
          if (e.error) somar(r.errosDeFerramenta, `${nome}: ${String(e.error).slice(0, 60)}`);
          const saida = (e.output ?? {}) as { status?: string };
          if (nome === "transferir_humano" && saida.status === "transferido") {
            r.transferencias.total++;
            const motivo = String((e.input as { motivo?: string })?.motivo ?? "outro");
            somar(r.transferencias.porMotivo, motivo);
            if (motivo === "orcamento_para_emitir") r.orcamentosParaEmitir++;
            transferida = true;
          }
          break;
        }
        case "transfer":
          // Transferência feita pelo sistema (falha do modelo, teto de tempo, limite por hora).
          r.transferencias.total++;
          somar(r.transferencias.porMotivo, `${String(e.motivo)} (sistema)`);
          transferida = true;
          break;
        case "kb_consulta":
          if (e.resultado === "lacuna") somar(lacunas, String(e.pergunta).toLowerCase().trim());
          break;
        case "alerta":
          somar(r.alertas, String(e.motivo).slice(0, 80));
          break;
        case "state_change":
          if (e.change === "mensagem_com_agente_suspenso") r.mensagensComAgenteSuspenso++;
          break;
      }
    }
    if (transferida) r.transferencias.conversasTransferidas++;
  }

  r.lacunas = Object.entries(lacunas)
    .map(([pergunta, vezes]) => ({ pergunta, vezes }))
    .sort((a, b) => b.vezes - a.vezes)
    .slice(0, 15);
  return r;
}

const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((a / b) * 100)}%`);

function tabela(titulo: string, m: Record<string, number>): string[] {
  const linhas = Object.entries(m).sort((a, b) => b[1] - a[1]);
  if (linhas.length === 0) return [`**${titulo}:** nenhum`, ""];
  return [`**${titulo}**`, "", "| | Qtde |", "|---|---:|", ...linhas.map(([k, v]) => `| ${k} | ${v} |`), ""];
}

export function formatarRelatorio(r: ResumoPiloto): string {
  return [
    "# Relatório do piloto — agente de atendimento",
    "",
    `Período: ${r.periodo.de ?? "—"} a ${r.periodo.ate ?? "—"}`,
    "",
    "| Indicador | Valor |",
    "|---|---:|",
    `| Conversas | ${r.conversas} |`,
    `| Mensagens recebidas | ${r.mensagensRecebidas} |`,
    `| Respostas da IA | ${r.respostasEnviadas} |`,
    `| Orçamentos enviados para emitir | ${r.orcamentosParaEmitir} |`,
    `| Conversas transferidas | ${r.transferencias.conversasTransferidas} (${pct(r.transferencias.conversasTransferidas, r.conversas)}) |`,
    `| Tokens (entrada / saída) | ${r.tokens.entrada} / ${r.tokens.saida} |`,
    `| Mensagens com o agente suspenso | ${r.mensagensComAgenteSuspenso} |`,
    "",
    ...tabela("Transferências por motivo", r.transferencias.porMotivo),
    ...tabela("Ferramentas chamadas", r.ferramentas),
    ...tabela("Erros de ferramenta", r.errosDeFerramenta),
    ...tabela("Alertas", r.alertas),
    "**Perguntas sem resposta na base (para a loja aprovar)**",
    "",
    ...(r.lacunas.length ? r.lacunas.map((l) => `- ${l.pergunta} (${l.vezes}×)`) : ["nenhuma"]),
    "",
  ].join("\n");
}
