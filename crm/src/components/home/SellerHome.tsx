"use client";

import Link from "next/link";
import { LeadLine, ProgressBar, StageFunnel, TemperatureDonut } from "./blocks";
import { HomeHero } from "./HomeHero";
import { Card, EmptyState, KpiCard, PanelHeading, SectionTitle } from "@/components/ui";
import { PageSkeleton } from "@/components/shell/PageSkeleton";
import { useApi } from "@/lib/client/api";
import { formatMoney } from "@/lib/types";
import type { Lead, Stage } from "@/lib/types";

interface SellerDashboard {
  kpi: { ativos: number; retornos: number; atrasados: number; nao_lidas: number; ganho_mes: number; pedidos_mes: number; pipeline: number; novos_hoje: number };
  agenda: Lead[];
  waiting: Lead[];
  recent: Lead[];
  stages: Record<Stage, { count: number; value: number }>;
  goal: number | null;
  temps: { quente: number; morno: number; frio: number; sem: number };
}

function dueLabel(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const overdue = d.getTime() < Date.now();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === new Date().toDateString();
  return `${overdue ? "Atrasado · " : ""}${sameDay ? `hoje ${time}` : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

export function SellerHome() {
  const { data } = useApi<SellerDashboard>("/api/dashboard", 60_000);
  if (!data) return <PageSkeleton />;
  const { kpi, goal } = data;
  const goalPct = goal ? Math.round((kpi.ganho_mes / goal) * 100) : null;

  return (
    <div className="space-y-12">
      <HomeHero />

      <div className="space-y-8">
        <PanelHeading
          title="Meu painel"
          subtitle={
            kpi.retornos > 0
              ? `Você tem ${kpi.retornos} retorno${kpi.retornos > 1 ? "s" : ""} para hoje${kpi.atrasados ? `, ${kpi.atrasados} atrasado${kpi.atrasados > 1 ? "s" : ""}` : ""}.`
              : "Sua agenda de retornos está em dia."
          }
        />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <KpiCard
            icon="event_upcoming"
            label="Retornos para hoje"
            value={kpi.retornos}
            badge={kpi.atrasados ? `${kpi.atrasados} atrasado${kpi.atrasados > 1 ? "s" : ""}` : "Em dia"}
            tone={kpi.atrasados ? "bad" : "good"}
            hint={`${kpi.ativos} leads ativos · ${formatMoney(kpi.pipeline, true)} em negociação`}
          />
          <KpiCard
            icon="mark_chat_unread"
            label="Esperando sua resposta"
            value={data.waiting.length}
            badge={data.waiting.length ? "Responder" : "Em dia"}
            tone={data.waiting.length ? "warn" : "good"}
            hint={`${kpi.nao_lidas} mensagens não lidas · ${kpi.novos_hoje} leads novos hoje`}
          />
          <div className="premium-card flex min-h-[152px] flex-col rounded-lg p-8">
            <div className="mb-4 flex items-start justify-between">
              <span className="material-symbols-outlined text-primary/40">flag</span>
              <span className={`rounded px-2 py-1 font-label-caps text-[10px] ${goalPct !== null && goalPct >= 100 ? "bg-green-50 text-green-700" : "bg-surface-container text-on-secondary-container"}`}>
                {goalPct !== null ? `${goalPct}% da meta` : "Sem meta"}
              </span>
            </div>
            <p className="mb-1 font-label-caps text-label-caps text-on-secondary-container">Fechado no mês</p>
            <div className="text-[32px] font-bold leading-none text-primary">{formatMoney(kpi.ganho_mes, true)}</div>
            <div className="mt-4">
              {goal ? <ProgressBar value={kpi.ganho_mes} max={goal} tone={kpi.ganho_mes >= goal ? "green" : "primary"} /> : null}
              <p className="mt-2 text-[13px] text-on-surface-variant">{goal ? `Meta de ${formatMoney(goal, true)} · ${kpi.pedidos_mes} pedidos` : `${kpi.pedidos_mes} pedidos`}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <SectionTitle title="Agenda do dia" subtitle="Próximos passos combinados com seus clientes" />
          {data.agenda.length === 0 ? (
            <EmptyState icon="event_available" title="Nada agendado para hoje" text="Ao falar com um cliente, marque o próximo passo no lead para ele aparecer aqui." />
          ) : (
            <div className="-mx-3">
              {data.agenda.map((l) => (
                <LeadLine
                  key={l.id}
                  lead={l}
                  meta={
                    <>
                      <span className={new Date(l.next_action_at!).getTime() < Date.now() ? "font-semibold text-red-600" : "font-semibold text-on-surface"}>{dueLabel(l.next_action_at)}</span>
                      {" · "}
                      {l.next_action}
                    </>
                  }
                />
              ))}
            </div>
          )}
        </Card>
        <Card className="p-6">
          <SectionTitle
            title="Clientes esperando você"
            subtitle="A última mensagem foi do cliente"
            action={<Link href="/app/crm?waiting=1" className="font-label-caps text-[10px] text-on-surface-variant hover:text-primary">Ver todos</Link>}
          />
          {data.waiting.length === 0 ? (
            <EmptyState icon="mark_chat_read" title="Ninguém esperando" text="Todas as suas conversas estão respondidas." />
          ) : (
            <div className="-mx-3">
              {data.waiting.map((l) => (
                <LeadLine key={l.id} lead={l} meta={l.last_message_text ?? undefined} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-8">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <h3 className="font-body-md font-bold text-primary">Meu funil</h3>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-on-secondary-container">Leads por etapa</p>
            </div>
            <span className="material-symbols-outlined text-primary/40">filter_alt</span>
          </div>
          <StageFunnel stages={data.stages} />
        </Card>
        <Card className="p-8">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <h3 className="font-body-md font-bold text-primary">Temperatura</h3>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-on-secondary-container">Minha carteira em aberto</p>
            </div>
            <span className="material-symbols-outlined text-primary/40">device_thermostat</span>
          </div>
          <TemperatureDonut temps={data.temps} />
        </Card>
        <Card className="p-6">
          <SectionTitle title="Recebidos recentemente" subtitle="Últimos leads atribuídos a você" />
          {data.recent.length === 0 ? (
            <EmptyState icon="inbox" title="Nenhum lead ainda" text="Quando a administração distribuir um lead para você, ele aparece aqui." />
          ) : (
            <div className="-mx-3">
              {data.recent.map((l) => (
                <LeadLine key={l.id} lead={l} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
