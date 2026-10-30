"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConnectionBadge, ConnectionPanel, useWhatsAppStatus } from "./ConnectionPanel";
import { LeadPanel } from "./LeadPanel";
import { usePortal } from "@/components/portal/Portal";
import { Avatar, EmptyState, PageHeader, Segmented, TemperatureBadge } from "@/components/ui";
import { useApi } from "@/lib/client/api";
import { STAGE_LABELS, isAwaitingSeller, leadDisplayName, relativeTime } from "@/lib/types";
import type { Lead } from "@/lib/types";

const FILTER_KEYS = ["q", "temp", "status", "owner", "attention", "waiting", "stage"] as const;

function useSellers(isAdmin: boolean) {
  const { data } = useApi<{ sellers: { id: string; name: string }[] }>(isAdmin ? "/api/settings" : null);
  return data?.sellers ?? [];
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-[12px] transition ${active ? "border-primary bg-primary text-on-primary" : "border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary"}`}
    >
      {children}
    </button>
  );
}

function CrmContent() {
  const { isAdmin, base } = usePortal();
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("lead");
  const sellers = useSellers(isAdmin);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const whatsapp = useWhatsAppStatus();
  const tab = isAdmin && params.get("tab") === "conexao" ? "conexao" : "conversas";

  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = params.get(key);
    if (v) query.set(key, v);
  }
  const { data, reload } = useApi<{ leads: Lead[] }>(tab === "conversas" ? `/api/leads?${query.toString()}` : null, 6_000);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${base}/crm${next.toString() ? `?${next}` : ""}`, { scroll: false });
  }
  const toggle = (key: string, value: string) => update({ [key]: params.get(key) === value ? null : value });

  const leads = data?.leads ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="CRM"
        subtitle={
          isAdmin
            ? "Todas as conversas que a Lia atendeu, a qualificação de cada lead e a distribuição entre os vendedores."
            : "Os leads e conversas atribuídos a você."
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        {isAdmin && (
          <Segmented
            value={tab}
            onChange={(v) => update({ tab: v === "conexao" ? "conexao" : null, lead: null })}
            options={[
              { value: "conversas", label: "Conversas", icon: "forum" },
              { value: "conexao", label: "Conexão", icon: "qr_code_2" },
            ]}
          />
        )}
        <div className="ml-auto">
          <ConnectionBadge status={whatsapp.data} onClick={isAdmin ? () => update({ tab: "conexao", lead: null }) : undefined} />
        </div>
      </div>

      {tab === "conexao" ? (
        <ConnectionPanel />
      ) : (

      <div className="premium-card grid h-[calc(100vh-260px)] min-h-[560px] grid-cols-1 overflow-hidden rounded-3xl lg:grid-cols-[380px_1fr]">
        {/* Lista */}
        <div className={`flex min-h-0 flex-col border-r border-outline-variant/30 ${selected ? "hidden lg:flex" : "flex"}`}>
          <div className="space-y-3 border-b border-outline-variant/30 p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                update({ q: search.trim() || null });
              }}
              className="flex items-center gap-2 rounded-full bg-on-surface/[0.05] px-4"
            >
              <span className="material-symbols-outlined text-[20px] text-on-surface-variant">search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => update({ q: search.trim() || null })}
                placeholder="Nome, telefone, empresa…"
                className="h-10 flex-1 bg-transparent text-[14px] outline-none placeholder:text-outline"
              />
            </form>
            <div className="thin-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              <Chip active={params.get("stage") === "open"} onClick={() => toggle("stage", "open")}>Em aberto</Chip>
              <Chip active={params.get("waiting") === "1"} onClick={() => toggle("waiting", "1")}>Aguardando resposta</Chip>
              <Chip active={params.get("temp") === "quente"} onClick={() => toggle("temp", "quente")}>🔥 Quentes</Chip>
              <Chip active={params.get("temp") === "morno"} onClick={() => toggle("temp", "morno")}>Mornos</Chip>
              <Chip active={params.get("temp") === "frio"} onClick={() => toggle("temp", "frio")}>Frios</Chip>
              {isAdmin && (
                <>
                  <Chip active={params.get("owner") === "none"} onClick={() => toggle("owner", "none")}>Sem vendedor</Chip>
                  <Chip active={params.get("attention") === "1"} onClick={() => toggle("attention", "1")}>Pedem atenção</Chip>
                  <Chip active={params.get("status") === "QUALIFIED"} onClick={() => toggle("status", "QUALIFIED")}>Qualificados</Chip>
                  <Chip active={params.get("status") === "IN_PROGRESS"} onClick={() => toggle("status", "IN_PROGRESS")}>Em qualificação</Chip>
                </>
              )}
            </div>
            {isAdmin && sellers.length > 0 && (
              <select
                value={params.get("owner") && params.get("owner") !== "none" ? params.get("owner")! : ""}
                onChange={(e) => update({ owner: e.target.value || null })}
                className="w-full rounded-full border border-outline-variant/50 bg-transparent px-3 py-1.5 text-[12px] text-on-surface-variant outline-none"
                aria-label="Filtrar por vendedor"
              >
                <option value="">Todos os vendedores</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            {!data ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-on-surface/[0.05]" />
                ))}
              </div>
            ) : leads.length === 0 ? (
              <EmptyState icon="inbox" title="Nenhum lead aqui" text={query.toString() ? "Ajuste os filtros para ver mais." : isAdmin ? "Os leads chegam quando a Lia conversa com clientes no WhatsApp." : "Quando a administração distribuir um lead para você, ele aparece aqui."} />
            ) : (
              <ul>
                {leads.map((l) => (
                  <li key={l.id}>
                    <button
                      onClick={() => update({ lead: l.id })}
                      className={`flex w-full items-start gap-3 border-b border-outline-variant/15 px-4 py-3.5 text-left transition-colors ${selected === l.id ? "bg-on-surface/[0.06]" : "hover:bg-on-surface/[0.03]"}`}
                    >
                      <Avatar name={leadDisplayName(l)} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={`flex-1 truncate text-[14px] ${l.unread_count ? "font-bold" : "font-semibold"} text-on-surface`}>{leadDisplayName(l)}</p>
                          <span className="shrink-0 text-[10px] text-on-surface-variant">{relativeTime(l.last_message_at ?? l.created_at)}</span>
                        </div>
                        <p className="truncate text-[12px] text-on-surface-variant">
                          {l.last_message_from_client === false && <span className="opacity-70">Lia: </span>}
                          {l.last_message_text ?? "Sem mensagens"}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <TemperatureBadge score={l.lead_score} compact />
                          <span className="rounded-full bg-on-surface/[0.05] px-2 py-0.5 text-[10px] text-on-surface-variant">{STAGE_LABELS[l.stage]}</span>
                          {l.needs_attention && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">atenção</span>}
                          {isAdmin && isAwaitingSeller(l) && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">sem vendedor</span>}
                          {isAdmin && l.assigned_name && <span className="truncate text-[10px] text-on-surface-variant">· {l.assigned_name}</span>}
                        </div>
                      </div>
                      {l.unread_count > 0 && <span className="mt-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">{l.unread_count}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="border-t border-outline-variant/30 px-4 py-2 text-[11px] text-on-surface-variant">{leads.length} lead(s)</p>
        </div>

        {/* Painel */}
        <div className={`min-h-0 ${selected ? "block" : "hidden lg:block"}`}>
          {selected ? (
            <LeadPanel
              key={selected}
              leadId={selected}
              sellers={sellers}
              whatsappConnected={whatsapp.data?.estado === "CONECTADO"}
              onChanged={reload}
              onClose={() => update({ lead: null })}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon="forum" title="Selecione um lead" text="A conversa com a Lia, a ficha do pedido e o histórico aparecem aqui." />
            </div>
          )}
        </div>
      </div>
      )}

    </div>
  );
}

export function CrmView() {
  return (
    <Suspense>
      <CrmContent />
    </Suspense>
  );
}
