"use client";

import { useState } from "react";
import Link from "next/link";
import { BarSeries, LeadLine, ProgressBar, StageFunnel, TemperatureDonut } from "./blocks";
import { HomeHero } from "./HomeHero";
import { Avatar, Card, EmptyState, KpiCard, PanelHeading, SectionTitle, TemperatureBadge } from "@/components/ui";
import { PageSkeleton } from "@/components/shell/PageSkeleton";
import { api, useApi } from "@/lib/client/api";
import { formatMoney, leadDisplayName } from "@/lib/types";
import type { Lead, Stage } from "@/lib/types";

interface AdminDashboard {
  kpi: {
    novos_hoje: number;
    aguardando: number;
    atencao: number;
    pipeline: number;
    ganho_mes: number;
    pedidos_mes: number;
    recebidos_mes: number;
    nao_lidas: number;
  };
  awaiting: Lead[];
  attention: Lead[];
  ranking: { id: string; name: string; ganho: number; pedidos: number; ativos: number; meta: number | null; atrasados: number }[];
  stages: Record<Stage, { count: number; value: number }>;
  series: { day: string; count: number; value: number }[];
  temps: { quente: number; morno: number; frio: number; sem: number };
  dueToday: number;
}

function QuickAssign({ lead, sellers, onDone }: { lead: Lead; sellers: { id: string; name: string }[]; onDone: () => void }) {
  const [seller, setSeller] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-3 transition-colors hover:bg-on-surface/[0.03]">
      <Avatar name={leadDisplayName(lead)} size={34} />
      <Link href={`/admin/crm?lead=${lead.id}`} className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-on-surface">{leadDisplayName(lead)}</p>
        <p className="truncate text-[12px] text-on-surface-variant">{lead.qualification_summary ?? "Qualificado pela Lia"}</p>
      </Link>
      <TemperatureBadge score={lead.lead_score} compact />
      <select
        value={seller}
        onChange={(e) => setSeller(e.target.value)}
        aria-label="Colaborador"
        className="w-32 rounded-full border border-outline-variant/60 bg-surface-container-lowest px-3 py-1.5 text-[12px] text-on-surface outline-none"
      >
        <option value="">Atribuir a…</option>
        {sellers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        disabled={!seller || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/leads/${lead.id}/assign`, { body: { seller_id: seller } });
            onDone();
          } catch (err) {
            alert((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        aria-label="Confirmar atribuição"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary transition disabled:opacity-30"
      >
        <span className="material-symbols-outlined text-[18px]">check</span>
      </button>
    </div>
  );
}

export function AdminHome() {
  const { data, reload } = useApi<AdminDashboard>("/api/dashboard", 60_000);
  const { data: settings } = useApi<{ sellers: { id: string; name: string }[]; settings: { distribution_mode: string } }>("/api/settings");

  if (!data) return <PageSkeleton />;
  const { kpi } = data;
  const conversion = kpi.recebidos_mes ? Math.round((kpi.pedidos_mes / kpi.recebidos_mes) * 100) : 0;

  return (
    <div className="space-y-12">
      <HomeHero />

      <div className="space-y-8">
        <PanelHeading title="Painel de Gestão" subtitle="A operação comercial de hoje: entrada de leads, distribuição e resultado do mês." />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <KpiCard icon="person_add" label="Novos leads hoje" value={kpi.novos_hoje} badge="Hoje" hint={`${kpi.recebidos_mes} recebidos no mês`} />
          <KpiCard
            icon="alt_route"
            label="Aguardando vendedor"
            value={kpi.aguardando}
            badge={kpi.aguardando ? "Distribuir" : "Fila vazia"}
            tone={kpi.aguardando ? "warn" : "good"}
            hint={settings?.settings.distribution_mode === "ROUND_ROBIN" ? "Rodízio automático ligado" : "Distribuição manual"}
          />
          <KpiCard
            icon="support_agent"
            label="Pedem atenção"
            value={kpi.atencao}
            badge={kpi.atencao ? "Lia transferiu" : "Tudo certo"}
            tone={kpi.atencao ? "bad" : "good"}
            hint={`${kpi.nao_lidas} mensagens não lidas`}
          />
          <KpiCard icon="payments" label="Fechado no mês" value={formatMoney(kpi.ganho_mes, true)} badge="Este mês" tone="good" hint={`${kpi.pedidos_mes} pedidos fechados`} />
          <KpiCard icon="percent" label="Conversão do mês" value={`${conversion}%`} badge="Eficiência" hint="Pedidos fechados ÷ leads recebidos" />
          <KpiCard icon="account_balance_wallet" label="Pipeline aberto" value={formatMoney(kpi.pipeline, true)} badge="Em negociação" hint={`${data.dueToday} retornos vencem até hoje`} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <SectionTitle
            title="Fila de distribuição"
            subtitle="Qualificados pela Lia, esperando um vendedor"
            action={<Link href="/admin/crm?status=QUALIFIED&owner=none" className="font-label-caps text-[10px] text-on-surface-variant hover:text-primary">Ver todos</Link>}
          />
          {data.awaiting.length === 0 ? (
            <EmptyState icon="done_all" title="Nenhum lead esperando" text="Todo lead qualificado já tem um vendedor." />
          ) : (
            <div className="-mx-3">
              {data.awaiting.map((l) => (
                <QuickAssign key={l.id} lead={l} sellers={settings?.sellers ?? []} onDone={reload} />
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <SectionTitle
            title="Pedem atenção"
            subtitle="Conversas que a Lia transferiu para uma pessoa"
            action={<Link href="/admin/crm?attention=1" className="font-label-caps text-[10px] text-on-surface-variant hover:text-primary">Ver todas</Link>}
          />
          {data.attention.length === 0 ? (
            <EmptyState icon="sentiment_satisfied" title="Tudo sob controle" text="Nenhuma conversa pedindo uma pessoa agora." />
          ) : (
            <div className="-mx-3">
              {data.attention.map((l) => (
                <LeadLine key={l.id} lead={l} meta={l.attention_reason ?? undefined} showOwner />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-8">
        <SectionTitle
          title="Equipe no mês"
          subtitle="Fechamentos, meta e carteira de cada colaborador"
          action={
            <Link href="/admin/relatorios" className="rounded-full border border-outline px-5 py-2 font-label-caps text-[10px] transition-all hover:border-primary hover:bg-primary hover:text-on-primary">
              Relatório completo
            </Link>
          }
        />
        {data.ranking.length === 0 ? (
          <EmptyState icon="groups" title="Nenhum colaborador ativo" text="Libere acessos em Gestão › Equipe e acessos." />
        ) : (
          <div className="grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
            {data.ranking.map((r, i) => (
              <div key={r.id} className="group flex items-center gap-5">
                <span className="text-[30px] font-bold text-primary opacity-10 transition-opacity group-hover:opacity-40">{String(i + 1).padStart(2, "0")}</span>
                <Avatar name={r.name} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body-md font-bold text-primary">{r.name}</p>
                  <p className="mb-2 text-[11px] uppercase text-on-secondary-container">
                    {r.pedidos} pedidos · {r.ativos} ativos
                    {r.atrasados > 0 && <span className="ml-1 text-red-600">· {r.atrasados} atrasados</span>}
                  </p>
                  <div className="mb-1 flex justify-between text-[12px]">
                    <span className="font-bold text-primary">{formatMoney(r.ganho, true)}</span>
                    {r.meta && <span className="text-on-surface-variant">meta {formatMoney(r.meta, true)}</span>}
                  </div>
                  {r.meta ? <ProgressBar value={r.ganho} max={r.meta} tone={r.ganho >= r.meta ? "green" : "primary"} /> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div>
        <h2 className="mb-6 font-headline-md text-primary">Análises do dia</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="flex flex-col justify-between p-8">
            <div>
              <div className="mb-8 flex items-start justify-between">
                <div>
                  <h3 className="font-body-md font-bold text-primary">Leads recebidos</h3>
                  <p className="mt-1 text-[10px] uppercase tracking-widest text-on-secondary-container">Últimos 14 dias</p>
                </div>
                <span className="material-symbols-outlined text-primary/40">trending_up</span>
              </div>
              <BarSeries data={data.series} />
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-surface-container-highest pt-6">
              <p className="text-[10px] font-bold uppercase text-on-secondary-container">Média diária</p>
              <p className="text-lg font-bold text-primary">{(data.series.reduce((s, d) => s + d.count, 0) / data.series.length).toFixed(1).replace(".", ",")}</p>
            </div>
          </Card>
          <Card className="p-8">
            <div className="mb-8 flex items-start justify-between">
              <div>
                <h3 className="font-body-md font-bold text-primary">Funil comercial</h3>
                <p className="mt-1 text-[10px] uppercase tracking-widest text-on-secondary-container">Leads por etapa</p>
              </div>
              <span className="material-symbols-outlined text-primary/40">filter_alt</span>
            </div>
            <StageFunnel stages={data.stages} />
          </Card>
          <Card className="p-8">
            <div className="mb-8 flex items-start justify-between">
              <div>
                <h3 className="font-body-md font-bold text-primary">Temperatura da carteira</h3>
                <p className="mt-1 text-[10px] uppercase tracking-widest text-on-secondary-container">Leads em aberto</p>
              </div>
              <span className="material-symbols-outlined text-primary/40">device_thermostat</span>
            </div>
            <TemperatureDonut temps={data.temps} />
          </Card>
        </div>
      </div>
    </div>
  );
}
