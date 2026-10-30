"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePortal } from "@/components/portal/Portal";
import { StageModal } from "@/components/crm/LeadPanel";
import { OrdersBoard } from "./OrdersBoard";
import { WonLeadModal } from "./WonLeadModal";
import { Avatar, ErrorNote, PageHeader, Segmented, TemperatureBadge } from "@/components/ui";
import { api, useApi } from "@/lib/client/api";
import { STAGES, formatMoney, leadDisplayName, leadTemperature, relativeTime } from "@/lib/types";
import type { Lead, LeadTemperature, Stage } from "@/lib/types";

type View = "qualificacao" | "prospeccao" | "pedidos";

interface Column<K extends string> {
  key: K;
  label: string;
  hint: string;
  border: string;
}

const TEMP_COLUMNS: Column<LeadTemperature>[] = [
  { key: "frio", label: "Frio", hint: "até 39 pts", border: "border-sky-400" },
  { key: "morno", label: "Morno", hint: "40 a 69 pts", border: "border-amber-400" },
  { key: "quente", label: "Quente", hint: "70+ pts", border: "border-red-500" },
];

// Pontuação gravada ao arrastar entre colunas de temperatura (mesma do dcimob)
const SCORE_FOR: Record<LeadTemperature, number> = { frio: 20, morno: 55, quente: 85 };

const STAGE_COLUMNS: Column<Stage>[] = STAGES.map((s) => ({
  key: s.value,
  label: s.label,
  hint: "",
  border: s.value === "GANHO" ? "border-green-500" : s.value === "PERDIDO" ? "border-red-400" : "border-primary/40",
}));

function Card({ lead, dragging, onDragStart, onDragEnd, showOwner, footer, onOpen }: { lead: Lead; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; showOwner: boolean; footer?: React.ReactNode; onOpen?: () => void }) {
  const { base } = usePortal();
  const overdue = lead.next_action_at && new Date(lead.next_action_at).getTime() < Date.now();
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", lead.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`premium-card cursor-grab rounded-2xl p-4 active:cursor-grabbing ${dragging ? "opacity-40" : ""}`}
    >
      <Link
        href={`${base}/crm?lead=${lead.id}`}
        draggable={false}
        className="block"
        onClick={(e) => {
          // Pedido fechado abre os detalhes do pedido em vez da conversa
          if (!onOpen) return;
          e.preventDefault();
          onOpen();
        }}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-[14px] font-semibold text-on-surface">{leadDisplayName(lead)}</p>
          <TemperatureBadge score={lead.lead_score} compact />
        </div>
        {lead.qualification_summary && <p className="mb-3 line-clamp-2 text-[12px] text-on-surface-variant">{lead.qualification_summary}</p>}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          {lead.estimated_value ? <span className="rounded-full bg-on-surface/[0.05] px-2 py-0.5 font-semibold text-primary">{formatMoney(lead.won_value ?? lead.estimated_value, true)}</span> : null}
          {lead.qualification_status === "IN_PROGRESS" && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-800">Lia qualificando</span>}
          {lead.needs_attention && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">atenção</span>}
          {lead.next_action_at && (
            <span className={`rounded-full px-2 py-0.5 ${overdue ? "bg-red-50 font-semibold text-red-700" : "bg-on-surface/[0.05] text-on-surface-variant"}`}>
              <span className="material-symbols-outlined align-[-2px] text-[11px]">event</span>{" "}
              {new Date(lead.next_action_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-outline-variant/20 pt-3 text-[11px] text-on-surface-variant">
          {showOwner ? (
            <span className="flex items-center gap-1.5 truncate">
              {lead.assigned_name ? <Avatar name={lead.assigned_name} size={18} /> : <span className="material-symbols-outlined text-[14px] text-red-600">person_off</span>}
              <span className={lead.assigned_name ? "" : "font-semibold text-red-700"}>{lead.assigned_name ?? "sem vendedor"}</span>
            </span>
          ) : (
            <span>{lead.company ?? ""}</span>
          )}
          <span>{relativeTime(lead.last_message_at ?? lead.created_at)}</span>
        </div>
      </Link>
      {footer}
    </div>
  );
}

function Board<K extends string>({
  columns,
  leads,
  columnOf,
  onMove,
  showOwner,
  totals,
  onOpen,
}: {
  columns: Column<K>[];
  leads: Lead[];
  columnOf: (lead: Lead) => K;
  onMove: (lead: Lead, to: K) => void;
  showOwner: boolean;
  totals?: boolean;
  /** Clique no card que não abre a conversa (ex.: pedido fechado abre os detalhes do pedido) */
  onOpen?: (lead: Lead) => (() => void) | undefined;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<K | null>(null);

  return (
    <div className="thin-scroll -mx-4 overflow-x-auto px-4 pb-4 md:-mx-10 md:px-10">
      <div className="flex min-w-max gap-4">
        {columns.map((col) => {
          const items = leads.filter((l) => columnOf(l) === col.key);
          const total = items.reduce((s, l) => s + (l.won_value ?? l.estimated_value ?? 0), 0);
          return (
            <section
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const lead = leads.find((l) => l.id === e.dataTransfer.getData("text/plain"));
                if (lead && columnOf(lead) !== col.key) onMove(lead, col.key);
              }}
              className={`flex w-[300px] shrink-0 flex-col rounded-3xl bg-on-surface/[0.03] p-3 transition ${over === col.key ? "board-drop" : ""}`}
            >
              <header className={`mb-3 border-t-2 px-1 pt-3 ${col.border}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-label-caps text-[11px] text-primary">{col.label}</h3>
                  <span className="rounded-full bg-on-surface/[0.07] px-2 py-0.5 text-[11px] font-bold text-primary">{items.length}</span>
                </div>
                <p className="mt-1 text-[11px] text-on-surface-variant">{totals ? (total ? formatMoney(total, true) : "—") : col.hint}</p>
              </header>
              <div className="thin-scroll flex max-h-[calc(100vh-360px)] min-h-[200px] flex-col gap-3 overflow-y-auto pb-1">
                {items.map((l) => (
                  <Card key={l.id} lead={l} dragging={dragging === l.id} onDragStart={() => setDragging(l.id)} onDragEnd={() => setDragging(null)} showOwner={showOwner} onOpen={onOpen?.(l)} />
                ))}
                {items.length === 0 && <p className="py-8 text-center text-[12px] text-on-surface-variant/60">Arraste um card para cá</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardsContent() {
  const { isAdmin, base } = usePortal();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("view");
  const view: View = requested === "prospeccao" || requested === "pedidos" ? requested : "qualificacao";
  const { data, setData, reload } = useApi<{ leads: Lead[] }>(
    view === "pedidos" ? null : view === "qualificacao" ? "/api/leads?stage=open" : "/api/leads",
    30_000
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ lead: Lead; stage: Stage } | null>(null);
  const [won, setWon] = useState<string | null>(null);

  const leads = data?.leads ?? [];

  async function patch(lead: Lead, body: Record<string, unknown>, optimistic: Partial<Lead>) {
    setError(null);
    setData((d) => (d ? { leads: d.leads.map((l) => (l.id === lead.id ? { ...l, ...optimistic } : l)) } : d));
    try {
      await api(`/api/leads/${lead.id}`, { method: "PATCH", body });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      reload();
    }
  }

  const awaiting = leads.filter((l) => l.qualification_status === "QUALIFIED" && !l.assigned_to).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Quadros"
        subtitle={
          view === "qualificacao"
            ? "A temperatura de cada lead em aberto. Arraste um card para reclassificar."
            : view === "prospeccao"
              ? "O funil comercial, do primeiro contato ao pedido fechado. Arraste para mudar a etapa."
              : "A sequência da operação, do pedido confirmado à entrega."
        }
        actions={
          <Segmented<View>
            value={view}
            onChange={(v) => router.replace(`${base}/quadros${v === "qualificacao" ? "" : `?view=${v}`}`, { scroll: false })}
            options={[
              { value: "qualificacao", label: "Qualificação", icon: "device_thermostat" },
              { value: "prospeccao", label: "Prospecção", icon: "handshake" },
              { value: "pedidos", label: "Pedidos", icon: "package_2" },
            ]}
          />
        }
      />
      {isAdmin && awaiting > 0 && view === "qualificacao" && (
        <Link href="/admin/crm?status=QUALIFIED&owner=none" className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-[13px] text-amber-900">
          <span className="material-symbols-outlined">alt_route</span>
          {awaiting} lead(s) qualificado(s) aguardando vendedor. <span className="underline underline-offset-4">Distribuir agora</span>
        </Link>
      )}
      <ErrorNote message={error} />
      {view === "pedidos" ? (
        <OrdersBoard />
      ) : !data ? (
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[480px] w-[300px] animate-pulse rounded-3xl bg-on-surface/[0.05]" />
          ))}
        </div>
      ) : view === "qualificacao" ? (
        <Board
          columns={TEMP_COLUMNS}
          leads={leads}
          showOwner={isAdmin}
          columnOf={(l) => leadTemperature(l.lead_score) ?? "frio"}
          onMove={(lead, to) => patch(lead, { lead_score: SCORE_FOR[to] }, { lead_score: SCORE_FOR[to] })}
        />
      ) : (
        <Board
          columns={STAGE_COLUMNS}
          leads={leads}
          showOwner={isAdmin}
          totals
          columnOf={(l) => l.stage}
          onOpen={(l) => (l.stage === "GANHO" ? () => setWon(l.id) : undefined)}
          onMove={(lead, to) => (to === "GANHO" || to === "PERDIDO" ? setPending({ lead, stage: to }) : patch(lead, { stage: to }, { stage: to }))}
        />
      )}
      {won && <WonLeadModal leadId={won} onClose={() => setWon(null)} />}
      <StageModal
        stage={pending?.stage ?? null}
        lead={pending?.lead ?? { estimated_value: null }}
        onClose={() => setPending(null)}
        onConfirm={(body) => {
          if (pending) {
            // Fechou o pedido: abre os detalhes para já passar para o quadro de Pedidos
            patch(pending.lead, body, { stage: pending.stage }).then(() => pending.stage === "GANHO" && setWon(pending.lead.id));
          }
          setPending(null);
        }}
      />
    </div>
  );
}

export function BoardsView() {
  return (
    <Suspense>
      <BoardsContent />
    </Suspense>
  );
}
