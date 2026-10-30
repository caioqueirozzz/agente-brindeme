"use client";

import { useState } from "react";
import { usePortal } from "@/components/portal/Portal";
import { BarSeries, StageFunnel } from "@/components/home/blocks";
import { Avatar, Card, EmptyState, KpiCard, PageHeader, Segmented } from "@/components/ui";
import { PageSkeleton } from "@/components/shell/PageSkeleton";
import { useApi } from "@/lib/client/api";
import { formatMoney } from "@/lib/types";
import type { Stage } from "@/lib/types";

interface Report {
  days: number;
  totals: { recebidos: number; qualificados: number; ganhos: number; perdidos: number; valor_ganho: number; desqualificados: number } | null;
  stages: Record<Stage, { count: number; value: number }>;
  byOccasion: { ocasiao: string; leads: number; ganhos: number; valor: number }[];
  lost: { motivo: string; total: number }[];
  received: { day: string; count: number; value: number }[];
  won: { day: string; count: number; value: number }[];
  bySeller: { id: string; name: string; recebidos: number; ganhos: number; perdidos: number; valor: number; ativos: number }[] | null;
  hoursToAssign: number | null;
}

const PERIODS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "365", label: "12 meses" },
];

function pct(a: number, b: number) {
  return b ? `${Math.round((a / b) * 100)}%` : "—";
}

function HBars({ rows }: { rows: { label: string; value: number; extra?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between gap-3 text-[13px]">
            <span className="truncate text-on-surface">{r.label}</span>
            <span className="shrink-0 font-semibold text-primary">
              {r.value}
              {r.extra && <span className="ml-2 font-normal text-on-surface-variant">{r.extra}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-high">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReportsView() {
  const { isAdmin } = usePortal();
  const [days, setDays] = useState("30");
  const { data } = useApi<Report>(`/api/reports?dias=${days}`);

  const t = data?.totals;
  const decided = (t?.ganhos ?? 0) + (t?.perdidos ?? 0);
  const bucket = (series: Report["received"]) => {
    // 90 dias ou mais: agrupa por semana para o gráfico continuar legível
    if (series.length <= 31) return series;
    const out: Report["received"] = [];
    for (let i = 0; i < series.length; i += 7) {
      const chunk = series.slice(i, i + 7);
      out.push({ day: chunk[0].day, count: chunk.reduce((s, d) => s + d.count, 0), value: chunk.reduce((s, d) => s + d.value, 0) });
    }
    return out;
  };

  return (
    <div className="space-y-10">
      <PageHeader
        title="Relatórios"
        subtitle={isAdmin ? "Desempenho comercial da operação: entrada, conversão, equipe e perdas." : "O seu desempenho comercial no período."}
        actions={<Segmented value={days} onChange={setDays} options={PERIODS} />}
      />

      {!data || !t ? (
        <PageSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <KpiCard icon="person_add" label={isAdmin ? "Leads recebidos" : "Leads novos (meus)"} value={t.recebidos} hint={`${t.qualificados} qualificados`} />
            <KpiCard icon="verified" label="Pedidos fechados" value={t.ganhos} tone="good" badge={decided ? `${pct(t.ganhos, decided)} conv.` : undefined} />
            <KpiCard icon="payments" label="Valor fechado" value={formatMoney(t.valor_ganho, true)} hint={`Ticket médio ${t.ganhos ? formatMoney(t.valor_ganho / t.ganhos, true) : "—"}`} />
            <KpiCard icon="block" label="Perdidos" value={t.perdidos} tone={t.perdidos ? "bad" : "neutral"} hint={`${t.desqualificados} desqualificados`} />
            <KpiCard
              icon={isAdmin ? "schedule" : "filter_alt"}
              label={isAdmin ? "Tempo até o vendedor" : "Em aberto"}
              value={
                isAdmin
                  ? data.hoursToAssign === null
                    ? "—"
                    : data.hoursToAssign < 1
                      ? `${Math.round(data.hoursToAssign * 60)} min`
                      : `${data.hoursToAssign.toFixed(1).replace(".", ",")} h`
                  : (["NOVO", "ATENDIMENTO", "ORCAMENTO", "ARTE", "NEGOCIACAO"] as Stage[]).reduce((s, k) => s + (data.stages[k]?.count ?? 0), 0)
              }
              hint={isAdmin ? "Média da qualificação à atribuição" : "Leads ativos na carteira"}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-8">
              <h3 className="font-body-md font-bold text-primary">Leads recebidos</h3>
              <p className="mb-6 mt-1 text-[10px] uppercase tracking-widest text-on-secondary-container">{Number(days) > 31 ? "Por semana" : "Por dia"}</p>
              <BarSeries data={bucket(data.received)} />
            </Card>
            <Card className="p-8">
              <h3 className="font-body-md font-bold text-primary">Valor fechado</h3>
              <p className="mb-6 mt-1 text-[10px] uppercase tracking-widest text-on-secondary-container">{Number(days) > 31 ? "Por semana" : "Por dia"}</p>
              <BarSeries data={bucket(data.won)} valueKey="value" format={(n) => formatMoney(n, true)} />
            </Card>
          </div>

          {isAdmin && data.bySeller && (
            <Card className="overflow-hidden">
              <div className="p-8 pb-4">
                <h3 className="font-headline-md text-primary">Equipe</h3>
                <p className="text-body-sm text-on-secondary-container">Resultado por colaborador no período</p>
              </div>
              {data.bySeller.length === 0 ? (
                <EmptyState icon="groups" title="Nenhum colaborador ativo" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[14px]">
                    <thead className="border-y border-outline-variant/30 text-left font-label-caps text-[10px] text-on-surface-variant">
                      <tr>
                        <th className="px-8 py-3">Colaborador</th>
                        <th className="px-4 py-3 text-right">Recebidos</th>
                        <th className="px-4 py-3 text-right">Fechados</th>
                        <th className="px-4 py-3 text-right">Perdidos</th>
                        <th className="px-4 py-3 text-right">Conversão</th>
                        <th className="px-4 py-3 text-right">Valor</th>
                        <th className="px-8 py-3 text-right">Ativos agora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bySeller.map((s) => (
                        <tr key={s.id} className="border-b border-outline-variant/15 last:border-0">
                          <td className="px-8 py-4">
                            <span className="flex items-center gap-3">
                              <Avatar name={s.name} size={30} />
                              <span className="font-semibold text-on-surface">{s.name}</span>
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">{s.recebidos}</td>
                          <td className="px-4 py-4 text-right font-semibold text-green-700">{s.ganhos}</td>
                          <td className="px-4 py-4 text-right text-red-700">{s.perdidos}</td>
                          <td className="px-4 py-4 text-right">{pct(s.ganhos, s.ganhos + s.perdidos)}</td>
                          <td className="px-4 py-4 text-right font-bold text-primary">{formatMoney(s.valor, true)}</td>
                          <td className="px-8 py-4 text-right">{s.ativos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="p-8">
              <h3 className="mb-6 font-body-md font-bold text-primary">Funil atual</h3>
              <StageFunnel stages={data.stages} />
            </Card>
            <Card className="p-8">
              <h3 className="mb-6 font-body-md font-bold text-primary">Por ocasião</h3>
              {data.byOccasion.length === 0 ? (
                <EmptyState icon="celebration" title="Sem dados no período" />
              ) : (
                <HBars rows={data.byOccasion.map((o) => ({ label: o.ocasiao, value: o.leads, extra: `${o.ganhos} fech.` }))} />
              )}
            </Card>
            <Card className="p-8">
              <h3 className="mb-6 font-body-md font-bold text-primary">Motivos de perda</h3>
              {data.lost.length === 0 ? <EmptyState icon="thumb_up" title="Nenhuma perda no período" /> : <HBars rows={data.lost.map((l) => ({ label: l.motivo, value: l.total }))} />}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
