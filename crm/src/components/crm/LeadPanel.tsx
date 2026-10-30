"use client";

import { useEffect, useRef, useState } from "react";
import { usePortal } from "@/components/portal/Portal";
import { Avatar, Button, EmptyState, ErrorNote, Label, Modal, QualificationBadge, Segmented, TemperatureBadge, inputClass } from "@/components/ui";
import { api, useApi } from "@/lib/client/api";
import { STAGES, STAGE_LABELS, formatDateTime, formatMoney, formatPhone, leadDisplayName, relativeTime } from "@/lib/types";
import type { Lead, LeadEvent, Message, Stage } from "@/lib/types";

interface LeadDetail {
  lead: Lead;
  messages: Message[];
  events: LeadEvent[];
}

type Tab = "conversa" | "ficha" | "historico";

/** datetime-local ↔ ISO no fuso do navegador */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function LeadPanel({
  leadId,
  sellers,
  whatsappConnected,
  onChanged,
  onClose,
}: {
  leadId: string;
  sellers: { id: string; name: string }[];
  whatsappConnected: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("conversa");
  // Com a conversa aberta, atualiza quase em tempo real (a ponte grava cada mensagem na hora)
  const { data, error, reload } = useApi<LeadDetail>(`/api/leads/${leadId}`, tab === "conversa" ? 4_000 : 20_000);

  if (error) return <EmptyState icon="lock" title="Lead indisponível" text={error} />;
  if (!data) return <div className="h-full animate-pulse rounded-2xl bg-on-surface/[0.04]" />;
  const { lead } = data;
  const refresh = () => {
    reload();
    onChanged();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b border-outline-variant/30 p-5">
        <button onClick={onClose} aria-label="Voltar" className="-ml-1 rounded-full p-1 text-on-surface-variant hover:bg-on-surface/[0.06] lg:hidden">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <Avatar name={leadDisplayName(lead)} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[18px] font-semibold text-primary">{leadDisplayName(lead)}</h2>
          <p className="text-[12px] text-on-surface-variant">
            {formatPhone(lead.phone)}
            {lead.company && ` · ${lead.company}`}
            {lead.customer_type && ` · ${lead.customer_type}`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <TemperatureBadge score={lead.lead_score} />
            <QualificationBadge status={lead.qualification_status} />
            <span className="rounded-full border border-outline-variant/50 px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">{STAGE_LABELS[lead.stage]}</span>
            {lead.agent_mode === "humano" ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Atendimento humano</span>
            ) : (
              <span className="rounded-full border border-outline-variant/50 px-2 py-0.5 text-[10px] text-on-surface-variant">Lia atendendo</span>
            )}
          </div>
        </div>
        <a
          href={`https://wa.me/${lead.phone}`}
          target="_blank"
          rel="noreferrer"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant/50 text-on-surface-variant transition hover:border-primary hover:text-primary"
          title="Abrir no WhatsApp"
        >
          <span className="material-symbols-outlined text-[20px]">chat</span>
        </a>
      </header>

      {lead.needs_attention && (
        <AttentionBar lead={lead} onResolved={refresh} />
      )}

      <div className="px-5 pt-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "conversa", label: "Conversa", icon: "forum" },
            { value: "ficha", label: "Ficha", icon: "assignment" },
            { value: "historico", label: "Histórico", icon: "history" },
          ]}
        />
      </div>

      {/* key por aba: cada aba abre do topo, sem herdar a rolagem da conversa */}
      <div key={tab} className="thin-scroll mt-2 min-h-0 flex-1 overflow-y-auto">
        {tab === "conversa" && <Conversation messages={data.messages} />}
        {tab === "ficha" && <LeadForm lead={lead} sellers={sellers} onSaved={refresh} />}
        {tab === "historico" && <History leadId={lead.id} events={data.events} onAdded={refresh} />}
      </div>
      {tab === "conversa" && <Composer lead={lead} connected={whatsappConnected} onSent={refresh} />}
    </div>
  );
}

/** Responder pelo WhatsApp da loja e devolver a conversa para a Lia */
function Composer({ lead, connected, onSent }: { lead: Lead; connected: boolean; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"send" | "return" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy("send");
    setError(null);
    try {
      await api(`/api/leads/${lead.id}/enviar`, { body: { text: content } });
      setText("");
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function giveBack() {
    const note = prompt("Nota para a Lia (opcional): o que ela precisa saber para continuar?") ?? null;
    if (note === null) return;
    setBusy("return");
    setError(null);
    try {
      await api(`/api/leads/${lead.id}/devolver`, { body: { note } });
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-outline-variant/30 p-4">
      {error && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[15px]">{lead.agent_mode === "ia" ? "smart_toy" : "support_agent"}</span>
          {lead.agent_mode === "ia" ? "A Lia está atendendo. Se você responder, ela pausa nesta conversa." : "Atendimento humano: a Lia está pausada nesta conversa."}
        </span>
        {lead.agent_mode === "humano" && (
          <button
            onClick={giveBack}
            disabled={!connected || busy !== null}
            className="flex items-center gap-1 rounded-full border border-outline-variant/60 px-3 py-1 font-semibold text-on-surface transition hover:border-primary disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[15px]">smart_toy</span>
            {busy === "return" ? "Devolvendo…" : "Devolver para a Lia"}
          </button>
        )}
      </div>
      {connected ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-2 rounded-3xl border border-outline-variant/50 bg-surface-container-lowest p-1.5 pl-4 focus-within:border-primary"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="Responder pelo WhatsApp da loja…"
            className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[14px] text-on-surface outline-none placeholder:text-outline"
          />
          <button type="submit" disabled={!text.trim() || busy !== null} aria-label="Enviar" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition disabled:opacity-30">
            {busy === "send" ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" /> : <span className="material-symbols-outlined text-[20px]">send</span>}
          </button>
        </form>
      ) : (
        <p className="rounded-2xl bg-on-surface/[0.04] px-4 py-3 text-center text-[12px] text-on-surface-variant">
          O WhatsApp da loja não está conectado ao CRM. Peça à administração para vincular em CRM › Conexão WhatsApp.
        </p>
      )}
    </div>
  );
}

function AttentionBar({ lead, onResolved }: { lead: Lead; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-5 mt-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
      <span className="material-symbols-outlined text-[20px]">support_agent</span>
      <span className="flex-1">
        <b className="font-semibold">A Lia passou esta conversa para uma pessoa.</b> {lead.attention_reason && `Motivo: ${lead.attention_reason}`}
      </span>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api(`/api/leads/${lead.id}`, { method: "PATCH", body: { needs_attention: false } }).catch(() => {});
          onResolved();
        }}
        className="rounded-full border border-amber-300 px-3 py-1 text-[12px] font-semibold hover:bg-amber-100"
      >
        Resolvido
      </button>
    </div>
  );
}

function Conversation({ messages }: { messages: Message[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.length]);
  if (messages.length === 0) return <EmptyState icon="chat_bubble" title="Sem mensagens" text="Este lead ainda não conversou com a Lia." />;

  let lastDay = "";
  return (
    <div className="space-y-2 p-5">
      {messages.map((m) => {
        const day = new Date(m.sent_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
        const showDay = day !== lastDay;
        lastDay = day;
        const fromClient = m.author === "CLIENTE";
        return (
          <div key={m.id}>
            {showDay && <p className="my-4 text-center font-label-caps text-[10px] text-on-surface-variant">{day}</p>}
            <div className={`flex ${fromClient ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${
                  fromClient ? "rounded-bl-md bg-surface-container text-on-surface" : "rounded-br-md bg-primary text-on-primary"
                }`}
              >
                {!fromClient && (
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-60">
                    {m.author === "AGENTE" ? "Lia · agente" : m.sent_by_name ? `${m.sent_by_name} · pelo CRM` : "Equipe · pelo celular"}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className="mt-1 text-right text-[10px] opacity-50">{new Date(m.sent_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="text-[14px] text-on-surface">{value || <span className="text-on-surface-variant">—</span>}</p>
    </div>
  );
}

function LeadForm({ lead, sellers, onSaved }: { lead: Lead; sellers: { id: string; name: string }[]; onSaved: () => void }) {
  const { isAdmin } = usePortal();
  const q = lead.qualification ?? {};
  const [form, setForm] = useState({
    name: lead.name ?? "",
    company: lead.company ?? "",
    email: lead.email ?? "",
    customer_type: lead.customer_type ?? "",
    estimated_value: lead.estimated_value?.toString() ?? "",
    next_action: lead.next_action ?? "",
    next_action_at: toLocalInput(lead.next_action_at),
    lead_score: lead.lead_score ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageModal, setStageModal] = useState<Stage | null>(null);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/leads/${lead.id}`, { method: "PATCH", body });
      onSaved();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-8 p-5">
      <ErrorNote message={error} />

      <section>
        <h3 className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-primary">
          <span className="material-symbols-outlined text-[18px] text-brand">auto_awesome</span>O que a Lia apurou
        </h3>
        <div className="grid grid-cols-2 gap-4 rounded-2xl bg-surface-container/60 p-4 sm:grid-cols-3">
          <Info label="Ocasião" value={q.ocasiao} />
          <Info label="Quantidade" value={q.quantidade ? `${q.quantidade} un.` : null} />
          <Info label="Prazo" value={q.data_limite} />
          <Info label="Orçamento do cliente" value={q.orcamento_total ? formatMoney(q.orcamento_total) : q.preco_max_unitario ? `até ${formatMoney(q.preco_max_unitario)}/un.` : null} />
          <Info label="Personalização" value={q.personalizacao} />
          <Info label="Artes recebidas" value={q.artes ? String(q.artes) : null} />
          <div className="col-span-full">
            <Info label="Produtos discutidos" value={q.produtos?.length ? q.produtos.join(", ") : null} />
          </div>
        </div>
        {q.itens && q.itens.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-2xl border border-outline-variant/40">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-container/60 text-left font-label-caps text-[10px] text-on-surface-variant">
                <tr>
                  <th className="px-3 py-2">Item da estimativa</th>
                  <th className="px-3 py-2 text-right">Qtd.</th>
                  <th className="px-3 py-2 text-right">Unit.</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {q.itens.map((i, idx) => (
                  <tr key={idx} className="border-t border-outline-variant/30">
                    <td className="px-3 py-2">
                      {i.nome_produto}
                      {i.cor && <span className="text-on-surface-variant"> · {i.cor}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{i.quantidade}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(i.preco_unitario)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(i.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              {q.total_estimado ? (
                <tfoot>
                  <tr className="border-t border-outline-variant/40 bg-surface-container/40">
                    <td colSpan={3} className="px-3 py-2 text-right font-label-caps text-[10px]">Total estimado (a confirmar no orçamento)</td>
                    <td className="px-3 py-2 text-right font-bold text-primary">{formatMoney(q.total_estimado)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-4 text-[14px] font-semibold text-primary">Etapa do funil</h3>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <button
              key={s.value}
              onClick={() => (s.value === "GANHO" || s.value === "PERDIDO" ? setStageModal(s.value) : patch({ stage: s.value }))}
              disabled={saving || s.value === lead.stage}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition ${
                s.value === lead.stage ? "border-primary bg-primary text-on-primary" : "border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
        {lead.stage === "GANHO" && <p className="mt-3 text-[13px] text-green-700">Pedido fechado em {formatDateTime(lead.won_at)} · {formatMoney(lead.won_value)}</p>}
        {lead.stage === "PERDIDO" && <p className="mt-3 text-[13px] text-red-700">Perdido: {lead.lost_reason}</p>}
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <h3 className="col-span-full text-[14px] font-semibold text-primary">Próximo passo</h3>
        <label className="sm:col-span-2">
          <Label>O que foi combinado</Label>
          <input className={inputClass} value={form.next_action} onChange={set("next_action")} placeholder="Ex.: enviar orçamento revisado, ligar para aprovar a arte" />
        </label>
        <label>
          <Label>Quando</Label>
          <input type="datetime-local" className={inputClass} value={form.next_action_at} onChange={set("next_action_at")} />
        </label>
        <div className="flex items-end">
          <Button
            variant="outline"
            icon="event"
            loading={saving}
            onClick={() => patch({ next_action: form.next_action, next_action_at: form.next_action_at ? new Date(form.next_action_at).toISOString() : null })}
          >
            Salvar próximo passo
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <h3 className="col-span-full text-[14px] font-semibold text-primary">Cliente e valores</h3>
        <label>
          <Label>Nome</Label>
          <input className={inputClass} value={form.name} onChange={set("name")} />
        </label>
        <label>
          <Label>Empresa</Label>
          <input className={inputClass} value={form.company} onChange={set("company")} />
        </label>
        <label>
          <Label>E-mail</Label>
          <input className={inputClass} type="email" value={form.email} onChange={set("email")} />
        </label>
        <label>
          <Label>Tipo</Label>
          <select className={inputClass} value={form.customer_type} onChange={set("customer_type")}>
            <option value="">—</option>
            <option value="PJ">Empresa (PJ)</option>
            <option value="PF">Pessoa física (PF)</option>
          </select>
        </label>
        <label>
          <Label>Valor estimado (R$)</Label>
          <input className={inputClass} inputMode="decimal" value={form.estimated_value} onChange={set("estimated_value")} />
        </label>
        <label>
          <Label>Temperatura · score {form.lead_score}</Label>
          <input type="range" min={0} max={100} value={form.lead_score} onChange={(e) => setForm({ ...form, lead_score: Number(e.target.value) })} className="mt-3 w-full accent-[var(--pe-primary)]" />
        </label>
        <div className="col-span-full">
          <Button
            icon="save"
            loading={saving}
            onClick={() =>
              patch({
                name: form.name,
                company: form.company,
                email: form.email,
                customer_type: form.customer_type || null,
                estimated_value: form.estimated_value || null,
                ...(form.lead_score !== (lead.lead_score ?? 0) ? { lead_score: form.lead_score } : {}),
              })
            }
          >
            Salvar dados
          </Button>
        </div>
      </section>

      {isAdmin && <AdminControls lead={lead} sellers={sellers} onSaved={onSaved} />}

      <StageModal stage={stageModal} lead={lead} onClose={() => setStageModal(null)} onConfirm={async (body) => (await patch(body)) && setStageModal(null)} />
    </div>
  );
}

function AdminControls({ lead, sellers, onSaved }: { lead: Lead; sellers: { id: string; name: string }[]; onSaved: () => void }) {
  const [seller, setSeller] = useState(lead.assigned_to ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-accent-gold/30 bg-accent-gold/[0.04] p-4">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold text-primary">
        <span className="material-symbols-outlined text-[18px] text-accent-gold">shield</span>Administração
      </h3>
      <ErrorNote message={error} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1">
          <Label>Vendedor responsável</Label>
          <select className={inputClass} value={seller} onChange={(e) => setSeller(e.target.value)}>
            <option value="">Sem vendedor (fila)</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          icon="alt_route"
          loading={busy}
          disabled={seller === (lead.assigned_to ?? "")}
          onClick={() =>
            run(async () => {
              const unqualified = Boolean(seller) && lead.qualification_status !== "QUALIFIED";
              if (unqualified && !confirm("Este lead ainda não está qualificado. Atribuir mesmo assim?")) return;
              await api(`/api/leads/${lead.id}/assign`, { body: { seller_id: seller || null, force: unqualified } });
            })
          }
        >
          Atribuir
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {lead.qualification_status !== "QUALIFIED" && (
          <Button variant="outline" icon="verified" loading={busy} onClick={() => run(() => api(`/api/leads/${lead.id}`, { method: "PATCH", body: { qualification_status: "QUALIFIED" } }))}>
            Qualificar
          </Button>
        )}
        {lead.qualification_status !== "DISQUALIFIED" && (
          <>
            <input className={`${inputClass} min-w-[180px] flex-1`} placeholder="Motivo da desqualificação" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button
              variant="danger"
              icon="block"
              loading={busy}
              disabled={!reason.trim()}
              onClick={() => run(() => api(`/api/leads/${lead.id}`, { method: "PATCH", body: { qualification_status: "DISQUALIFIED", disqualification_reason: reason } }))}
            >
              Desqualificar
            </Button>
          </>
        )}
        {lead.qualification_status === "DISQUALIFIED" && <p className="text-[13px] text-red-700">Desqualificado: {lead.disqualification_reason}</p>}
      </div>
    </section>
  );
}

export function StageModal({
  stage,
  lead,
  onClose,
  onConfirm,
}: {
  stage: Stage | null;
  lead: Pick<Lead, "estimated_value">;
  onClose: () => void;
  onConfirm: (body: Record<string, unknown>) => void;
}) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    setValue(lead.estimated_value?.toString() ?? "");
    setReason("");
  }, [stage, lead.estimated_value]);
  const won = stage === "GANHO";
  const reasons = ["Preço", "Prazo de produção", "Comprou com concorrente", "Desistiu do evento", "Sem retorno do cliente", "Produto indisponível"];
  return (
    <Modal open={stage !== null} onClose={onClose} title={won ? "Pedido fechado 🎉" : "Marcar como perdido"}>
      {won ? (
        <label className="block">
          <Label>Valor do pedido (R$)</Label>
          <input autoFocus className={inputClass} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      ) : (
        <div>
          <Label>Motivo</Label>
          <div className="mb-3 flex flex-wrap gap-2">
            {reasons.map((r) => (
              <button key={r} onClick={() => setReason(r)} className={`rounded-full border px-3 py-1 text-[12px] ${reason === r ? "border-primary bg-primary text-on-primary" : "border-outline-variant/60 text-on-surface-variant"}`}>
                {r}
              </button>
            ))}
          </div>
          <input className={inputClass} placeholder="Ou descreva" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant={won ? "primary" : "danger"}
          disabled={won ? !value : !reason.trim()}
          onClick={() => onConfirm(won ? { stage: "GANHO", won_value: value } : { stage: "PERDIDO", lost_reason: reason })}
        >
          Confirmar
        </Button>
      </div>
    </Modal>
  );
}

const EVENT_TEXT: Record<string, (e: LeadEvent) => string> = {
  CRIADO: (e) =>
    e.data.origem === "manual" ? "Lead cadastrado manualmente" : e.data.origem === "whatsapp" ? "Primeira mensagem no WhatsApp da loja" : "Lead criado a partir da conversa com a Lia",
  ATRIBUICAO: (e) =>
    e.data.para ? `Atribuído a ${e.data.para}${e.data.automatica ? " (rodízio automático)" : ""}` : `Devolvido à fila${e.data.motivo ? ` · ${e.data.motivo}` : ""}`,
  ETAPA: (e) => `Etapa: ${STAGE_LABELS[e.data.de as Stage] ?? e.data.de} → ${STAGE_LABELS[e.data.para as Stage] ?? e.data.para}${e.data.motivo ? ` · ${e.data.motivo}` : ""}`,
  QUALIFICACAO: (e) =>
    e.data.status
      ? `${e.data.status === "QUALIFIED" ? "Qualificado" : e.data.status === "DISQUALIFIED" ? "Desqualificado" : "Em qualificação"}${e.data.origem === "agente" ? " pela Lia" : ""}${e.data.motivo ? ` · ${e.data.motivo}` : ""}`
      : `Temperatura ajustada para ${e.data.score ?? "automática"}`,
  ATENDIMENTO: (e) => (e.data.modo === "ia" ? `Conversa devolvida para a Lia${e.data.nota ? ` · nota: ${e.data.nota}` : ""}` : "Equipe assumiu a conversa (a Lia pausou)"),
  PROXIMO_PASSO: (e) => (e.data.acao ? `Próximo passo: ${e.data.acao}${e.data.em ? ` (${formatDateTime(e.data.em as string)})` : ""}` : "Próximo passo removido"),
};

const EVENT_ICONS: Record<string, string> = {
  NOTA: "sticky_note_2",
  CRIADO: "add_circle",
  ATRIBUICAO: "alt_route",
  ETAPA: "swap_horiz",
  QUALIFICACAO: "device_thermostat",
  PROXIMO_PASSO: "event",
  ATENDIMENTO: "support_agent",
};

function History({ leadId, events, onAdded }: { leadId: string; events: LeadEvent[]; onAdded: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="p-5">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!note.trim()) return;
          setBusy(true);
          try {
            await api(`/api/leads/${leadId}/notes`, { body: { note } });
            setNote("");
            onAdded();
          } finally {
            setBusy(false);
          }
        }}
        className="mb-6 flex gap-2"
      >
        <input className={inputClass} placeholder="Nota interna (o cliente não vê)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" icon="add" loading={busy} disabled={!note.trim()}>
          Anotar
        </Button>
      </form>
      {events.length === 0 ? (
        <EmptyState icon="history" title="Sem histórico" />
      ) : (
        <ol className="relative space-y-5 border-l border-outline-variant/40 pl-6">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[37px] flex h-6 w-6 items-center justify-center rounded-full bg-surface-container-high">
                <span className="material-symbols-outlined text-[14px] text-on-surface-variant">{EVENT_ICONS[e.type] ?? "circle"}</span>
              </span>
              {e.type === "NOTA" ? (
                <p className="whitespace-pre-wrap rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">{String(e.data.texto ?? "")}</p>
              ) : (
                <p className="text-[13px] text-on-surface">{EVENT_TEXT[e.type]?.(e) ?? e.type}</p>
              )}
              <p className="mt-1 text-[11px] text-on-surface-variant">
                {e.user_name ?? "Sistema"} · {relativeTime(e.created_at)} · {formatDateTime(e.created_at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
