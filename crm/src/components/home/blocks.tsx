"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePortal } from "@/components/portal/Portal";
import { Avatar, TemperatureBadge } from "@/components/ui";
import { STAGES, formatMoney, leadDisplayName, relativeTime } from "@/lib/types";
import type { Lead, Stage } from "@/lib/types";

export function Greeting({ subtitle }: { subtitle: string }) {
  const { me } = usePortal();
  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }));
  const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const date = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });
  return (
    <div>
      <p className="mb-2 font-label-caps text-[11px] text-on-surface-variant">{date}</p>
      <h1 className="text-[34px] leading-tight tracking-tight text-primary md:text-[44px]">
        {hello}, {me.name.split(" ")[0]}.
      </h1>
      <p className="mt-2 font-body-md text-on-surface-variant">{subtitle}</p>
    </div>
  );
}

/** Atalho da home para a PresentesIA: abre a página já enviando a pergunta */
export function AskIaBox({ suggestions }: { suggestions: string[] }) {
  const { base } = usePortal();
  const router = useRouter();
  const [text, setText] = useState("");
  const go = (q: string) => q.trim() && router.push(`${base}/presentesia?q=${encodeURIComponent(q.trim())}`);
  return (
    <div className="premium-card rounded-[28px] p-2 pl-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(text);
        }}
        className="flex items-center gap-3"
      >
        <span className="material-symbols-outlined text-brand">auto_awesome</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Pergunte à PresentesIA sobre seus leads, metas e próximos passos…"
          className="h-12 flex-1 bg-transparent text-[15px] text-on-surface outline-none placeholder:text-outline"
        />
        <button type="submit" aria-label="Perguntar" className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-on-primary transition hover:opacity-90">
          <span className="material-symbols-outlined">arrow_upward</span>
        </button>
      </form>
      <div className="flex flex-wrap gap-2 px-1 pb-2 pt-1">
        {suggestions.map((s) => (
          <button key={s} onClick={() => go(s)} className="rounded-full border border-outline-variant/50 px-3 py-1 text-[12px] text-on-surface-variant transition hover:border-primary hover:text-primary">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Linha compacta de lead que abre o lead no CRM */
export function LeadLine({ lead, meta, showOwner }: { lead: Lead; meta?: React.ReactNode; showOwner?: boolean }) {
  const { base } = usePortal();
  return (
    <Link href={`${base}/crm?lead=${lead.id}`} className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-on-surface/[0.04]">
      <Avatar name={leadDisplayName(lead)} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-semibold text-on-surface">{leadDisplayName(lead)}</p>
          {lead.unread_count > 0 && (
            <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">{lead.unread_count}</span>
          )}
        </div>
        <p className="truncate text-[12px] text-on-surface-variant">
          {meta ?? lead.qualification_summary ?? lead.last_message_text ?? "Sem resumo ainda"}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <TemperatureBadge score={lead.lead_score} compact />
        <span className="text-[10px] text-on-surface-variant">
          {showOwner ? lead.assigned_name ?? "sem vendedor" : relativeTime(lead.last_message_at)}
        </span>
      </div>
    </Link>
  );
}

export function BarSeries({ data, valueKey = "count", format }: { data: { day: string; count: number; value: number }[]; valueKey?: "count" | "value"; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  return (
    <div className="flex h-40 items-end gap-1.5">
      {data.map((d, i) => {
        const v = d[valueKey];
        const label = new Date(`${d.day}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        return (
          <div key={d.day} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${label}: ${format ? format(v) : v}`}>
            {/* Rótulo flutuante: não ocupa largura, então as colunas encolhem em 30+ dias */}
            <span className="pointer-events-none absolute -top-4 z-10 whitespace-nowrap rounded bg-primary px-1 text-[9px] font-bold text-on-primary opacity-0 transition group-hover:opacity-100">
              {format ? format(v) : v}
            </span>
            <div
              className={`w-full rounded-t-[4px] transition-all ${i === data.length - 1 ? "bg-primary" : "bg-surface-container-highest group-hover:bg-primary/50"}`}
              style={{ height: `${Math.max((v / max) * 100, 3)}%` }}
            />
            {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && (
              <span className="text-[9px] font-bold uppercase text-on-secondary-container">{label.slice(0, 2)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StageFunnel({ stages, compact }: { stages: Record<Stage, { count: number; value: number }>; compact?: boolean }) {
  const open = STAGES.filter((s) => s.value !== "PERDIDO");
  const max = Math.max(1, ...open.map((s) => stages[s.value]?.count ?? 0));
  return (
    <div className="space-y-3">
      {open.map((s) => {
        const item = stages[s.value] ?? { count: 0, value: 0 };
        return (
          <div key={s.value}>
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-1.5 text-on-surface-variant">
                <span className="material-symbols-outlined text-[15px]">{s.icon}</span>
                {s.label}
              </span>
              <span className="font-semibold text-primary">
                {item.count}
                {!compact && item.value > 0 && <span className="ml-2 font-normal text-on-surface-variant">{formatMoney(item.value, true)}</span>}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-high">
              <div className={`h-full rounded-full ${s.value === "GANHO" ? "bg-green-500" : "bg-primary"}`} style={{ width: `${(item.count / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
      {(stages.PERDIDO?.count ?? 0) > 0 && <p className="pt-1 text-[11px] text-on-surface-variant">{stages.PERDIDO.count} perdido(s) no total</p>}
    </div>
  );
}

export function TemperatureDonut({ temps }: { temps: { quente: number; morno: number; frio: number; sem: number } }) {
  const parts = [
    { key: "quente", label: "Quentes", value: temps.quente, color: "#ef4444" },
    { key: "morno", label: "Mornos", value: temps.morno, color: "#f59e0b" },
    { key: "frio", label: "Frios", value: temps.frio, color: "#38bdf8" },
    { key: "sem", label: "Sem score", value: temps.sem, color: "var(--pe-outline-variant)" },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  let acc = 0;
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
          <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.2" className="stroke-surface-container-highest" />
          {total > 0 &&
            parts.map((p) => {
              const pct = (p.value / total) * 100;
              const el = (
                <circle key={p.key} cx="18" cy="18" r="15.9155" fill="none" stroke={p.color} strokeWidth="3.2" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-acc} />
              );
              acc += pct;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold leading-none text-primary">{total}</span>
          <span className="mt-1 text-[9px] font-bold uppercase tracking-tight text-on-secondary-container">em aberto</span>
        </div>
      </div>
      <ul className="space-y-2 text-[13px]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
            <span className="text-on-surface-variant">{p.label}</span>
            <span className="ml-auto pl-4 font-semibold text-primary">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProgressBar({ value, max, tone = "primary" }: { value: number; max: number; tone?: "primary" | "green" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
      <div className={`h-full rounded-full transition-all duration-700 ${tone === "green" ? "bg-green-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
