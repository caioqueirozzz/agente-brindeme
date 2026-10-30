"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePortal } from "@/components/portal/Portal";
import { Button, ErrorNote, Label, Modal, inputClass } from "@/components/ui";
import { api, useApi } from "@/lib/client/api";
import { ORDER_STAGES, ORDER_STAGE_LABELS } from "@/lib/orders";
import type { Order, OrderEvent, OrderStage } from "@/lib/orders";
import { formatDateTime, formatPhone, relativeTime } from "@/lib/types";

// AAAA-MM-DD no fuso do navegador (toISOString daria o dia seguinte à noite)
const today = () => new Date().toLocaleDateString("en-CA");

function dueLabel(due: string | null): string {
  if (!due) return "";
  const [y, m, d] = due.split("-");
  return `${d}/${m}${y !== String(new Date().getFullYear()) ? `/${y}` : ""}`;
}

function OrderCard({ order, draggable, dragging, onDragStart, onDragEnd, onOpen }: { order: Order; draggable: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onOpen: () => void }) {
  const late = order.due_date && order.stage !== "ENTREGUE" && order.due_date < today();
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", order.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`premium-card rounded-2xl ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${dragging ? "opacity-40" : ""}`}
    >
      <button type="button" onClick={onOpen} className="block w-full p-4 text-left">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 font-label-caps text-[10px] text-on-surface-variant">
            {order.code}
            {order.late_alert_at && (
              <span
                className="text-[16px] font-bold leading-none text-red-600"
                title={`Cliente perguntou pelo pedido atrasado (${formatDateTime(order.late_alert_at)}). A equipe foi avisada.`}
                aria-label="Cliente perguntou pelo pedido atrasado"
              >
                *
              </span>
            )}
          </span>
          {order.due_date && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${late ? "bg-red-50 font-semibold text-red-700" : "bg-on-surface/[0.05] text-on-surface-variant"}`}>
              <span className="material-symbols-outlined align-[-2px] text-[11px]">{late ? "warning" : "event"}</span> {dueLabel(order.due_date)}
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-[14px] font-semibold text-on-surface">{order.title}</p>
        <p className="mt-1 truncate text-[12px] text-on-surface-variant">{order.customer_name || formatPhone(order.phone)}</p>
        {order.client_note && (
          <p className="mt-3 line-clamp-2 rounded-xl bg-on-surface/[0.04] px-3 py-2 text-[12px] text-on-surface-variant">
            <span className="material-symbols-outlined mr-1 align-[-3px] text-[14px]">smart_toy</span>
            {order.client_note}
          </p>
        )}
        <p className="mt-3 border-t border-outline-variant/20 pt-2 text-[11px] text-on-surface-variant">Nesta etapa há {relativeTime(order.stage_changed_at)}</p>
      </button>
    </div>
  );
}

/**
 * A sequência da operação depois da venda. Só a gestão arrasta e edita; o colaborador
 * acompanha os pedidos dos leads dele. A Lia lê este quadro para responder ao cliente.
 */
export function OrdersBoard() {
  const { isAdmin } = usePortal();
  const { data, setData, reload } = useApi<{ orders: Order[] }>("/api/orders", 30_000);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<OrderStage | null>(null);
  const [creating, setCreating] = useState(false);
  // ?pedido=<id>: vem da notificação de pedido atrasado
  const [opened, setOpened] = useState<string | null>(useSearchParams().get("pedido"));

  const orders = data?.orders ?? [];

  async function move(order: Order, stage: OrderStage) {
    setError(null);
    setData((d) => (d ? { orders: d.orders.map((o) => (o.id === order.id ? { ...o, stage, stage_changed_at: new Date().toISOString() } : o)) } : d));
    try {
      await api(`/api/orders/${order.id}`, { method: "PATCH", body: { stage } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      reload();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] text-on-surface-variant">
          <span className="material-symbols-outlined text-[18px]">smart_toy</span>
          A Lia consulta este quadro quando o cliente pergunta pelo pedido.
          {!isAdmin && " Só a gestão altera os pedidos."}
          {orders.some((o) => o.late_alert_at) && (
            <span className="ml-1">
              <b className="text-red-600">*</b> = cliente perguntou e o pedido está atrasado.
            </span>
          )}
        </p>
        {isAdmin && (
          <Button icon="add" onClick={() => setCreating(true)}>
            Novo pedido
          </Button>
        )}
      </div>
      <ErrorNote message={error} />

      {!data ? (
        <div className="flex gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[480px] w-[280px] animate-pulse rounded-3xl bg-on-surface/[0.05]" />
          ))}
        </div>
      ) : (
        <div className="thin-scroll -mx-4 overflow-x-auto px-4 pb-4 md:-mx-10 md:px-10">
          <div className="flex min-w-max gap-4">
            {ORDER_STAGES.map((col, i) => {
              const items = orders.filter((o) => o.stage === col.value);
              return (
                <section
                  key={col.value}
                  onDragOver={(e) => {
                    if (!isAdmin) return;
                    e.preventDefault();
                    setOver(col.value);
                  }}
                  onDragLeave={() => setOver((o) => (o === col.value ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    const order = orders.find((o) => o.id === e.dataTransfer.getData("text/plain"));
                    if (isAdmin && order && order.stage !== col.value) move(order, col.value);
                  }}
                  className={`flex w-[280px] shrink-0 flex-col rounded-3xl bg-on-surface/[0.03] p-3 transition ${over === col.value ? "board-drop" : ""}`}
                >
                  <header className={`mb-3 border-t-2 px-1 pt-3 ${col.value === "ENTREGUE" ? "border-green-500" : "border-primary/40"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="flex min-w-0 items-center gap-1.5 font-label-caps text-[11px] text-primary">
                        <span className="material-symbols-outlined text-[16px]">{col.icon}</span>
                        <span className="truncate">{col.label}</span>
                      </h3>
                      <span className="rounded-full bg-on-surface/[0.07] px-2 py-0.5 text-[11px] font-bold text-primary">{items.length}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-on-surface-variant">Etapa {i + 1} de {ORDER_STAGES.length}</p>
                  </header>
                  <div className="thin-scroll flex max-h-[calc(100vh-380px)] min-h-[200px] flex-col gap-3 overflow-y-auto pb-1">
                    {items.map((o) => (
                      <OrderCard
                        key={o.id}
                        order={o}
                        draggable={isAdmin}
                        dragging={dragging === o.id}
                        onDragStart={() => setDragging(o.id)}
                        onDragEnd={() => setDragging(null)}
                        onOpen={() => setOpened(o.id)}
                      />
                    ))}
                    {items.length === 0 && (
                      <p className="py-8 text-center text-[12px] text-on-surface-variant/60">{isAdmin ? "Arraste um pedido para cá" : "Nenhum pedido"}</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <NewOrderModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
      />
      {opened && <OrderModal id={opened} canEdit={isAdmin} onClose={() => setOpened(null)} onChanged={reload} />}
    </div>
  );
}

const EMPTY_FORM = { phone: "", customer_name: "", title: "", due_date: "", client_note: "", internal_note: "" };

function NewOrderModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal open={open} onClose={onClose} title="Novo pedido" wide>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/api/orders", { body: form });
            setForm(EMPTY_FORM);
            onCreated();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorNote message={error} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <Label>WhatsApp do cliente</Label>
            <input className={inputClass} value={form.phone} onChange={set("phone")} placeholder="(83) 99999-0000" inputMode="tel" required autoFocus />
          </label>
          <label className="block">
            <Label>Nome do cliente</Label>
            <input className={inputClass} value={form.customer_name} onChange={set("customer_name")} placeholder="Se vazio, usa o do lead" />
          </label>
        </div>
        <label className="block">
          <Label>Pedido</Label>
          <input className={inputClass} value={form.title} onChange={set("title")} placeholder="200 canecas personalizadas — confraternização Acme" required />
        </label>
        <label className="block sm:w-1/2">
          <Label>Previsão de entrega</Label>
          <input type="date" className={inputClass} value={form.due_date} onChange={set("due_date")} />
        </label>
        <OrderNotes clientNote={form.client_note} internalNote={form.internal_note} onClient={set("client_note")} onInternal={set("internal_note")} />
        <p className="text-[12px] text-on-surface-variant">O pedido entra em “{ORDER_STAGE_LABELS.CONFIRMADO}”. Se já houver um lead com esse WhatsApp, ele é ligado ao pedido.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} icon="add">
            Cadastrar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function OrderNotes({ clientNote, internalNote, onClient, onInternal, disabled }: { clientNote: string; internalNote: string; onClient: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; onInternal: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; disabled?: boolean }) {
  return (
    <>
      <label className="block">
        <Label>Recado para o cliente (a Lia pode contar)</Label>
        <textarea className={`${inputClass} min-h-[72px]`} value={clientNote} onChange={onClient} disabled={disabled} maxLength={500} placeholder="Ex.: aguardando sua aprovação do mockup enviado por e-mail." />
      </label>
      {!disabled && (
        <label className="block">
          <Label>Observação interna (só a equipe vê)</Label>
          <textarea className={`${inputClass} min-h-[72px]`} value={internalNote} onChange={onInternal} maxLength={1000} />
        </label>
      )}
    </>
  );
}

function OrderModal({ id, canEdit, onClose, onChanged }: { id: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const { data } = useApi<{ order: Order; events: OrderEvent[] }>(`/api/orders/${id}`);
  const [form, setForm] = useState<typeof EMPTY_FORM & { stage: OrderStage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const order = data?.order;
  const current = form ?? (order
    ? {
        phone: order.phone,
        customer_name: order.customer_name ?? "",
        title: order.title,
        due_date: order.due_date ?? "",
        client_note: order.client_note ?? "",
        internal_note: order.internal_note ?? "",
        stage: order.stage,
      }
    : null);
  const set = (k: keyof typeof EMPTY_FORM | "stage") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => current && setForm({ ...current, [k]: e.target.value });

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={order ? `${order.code} · ${order.customer_name || formatPhone(order.phone)}` : "Pedido"} wide>
      {!order || !current ? (
        <div className="h-64 animate-pulse rounded-2xl bg-on-surface/[0.04]" />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const { phone: _phone, ...body } = current;
            run(() => api(`/api/orders/${id}`, { method: "PATCH", body }));
          }}
        >
          <ErrorNote message={error} />
          {order.late_alert_at && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              <span>
                <b>*</b> O cliente perguntou pelo pedido atrasado em {formatDateTime(order.late_alert_at)}. Atualize a previsão ou a etapa para a Lia responder com a informação nova.
              </span>
              {canEdit && (
                <Button variant="danger" icon="done" disabled={busy} onClick={() => run(() => api(`/api/orders/${id}`, { method: "PATCH", body: { clear_late_alert: true } }))}>
                  Marcar como resolvido
                </Button>
              )}
            </div>
          )}
          <label className="block">
            <Label>Pedido</Label>
            <input className={inputClass} value={current.title} onChange={set("title")} disabled={!canEdit} required />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <Label>Etapa</Label>
              <select className={inputClass} value={current.stage} onChange={set("stage")} disabled={!canEdit}>
                {ORDER_STAGES.map((s, i) => (
                  <option key={s.value} value={s.value}>
                    {i + 1}. {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <Label>Previsão de entrega</Label>
              <input type="date" className={inputClass} value={current.due_date} onChange={set("due_date")} disabled={!canEdit} />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <Label>Nome do cliente</Label>
              <input className={inputClass} value={current.customer_name} onChange={set("customer_name")} disabled={!canEdit} />
            </label>
            <div>
              <Label>WhatsApp</Label>
              <p className="py-2.5 text-[14px] text-on-surface">{formatPhone(order.phone)}</p>
            </div>
          </div>
          <OrderNotes clientNote={current.client_note} internalNote={current.internal_note} onClient={set("client_note")} onInternal={set("internal_note")} disabled={!canEdit} />

          {data.events.length > 0 && (
            <div>
              <Label>Histórico</Label>
              <ol className="space-y-2 border-l border-outline-variant/40 pl-4">
                {data.events.map((ev) => (
                  <li key={ev.id} className="text-[12px] text-on-surface-variant">
                    <span className="font-semibold text-on-surface">{ORDER_STAGE_LABELS[ev.to_stage]}</span>
                    {ev.from_stage ? ` (vinha de ${ORDER_STAGE_LABELS[ev.from_stage]})` : " (cadastro)"} · {formatDateTime(ev.created_at)}
                    {ev.user_name ? ` · ${ev.user_name}` : ""}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {canEdit && (
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button
                variant="danger"
                icon="delete"
                disabled={busy}
                onClick={() => confirm(`Excluir o pedido ${order.code}? A Lia deixa de encontrá-lo.`) && run(() => api(`/api/orders/${id}`, { method: "DELETE" }))}
              >
                Excluir
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancelar
                </Button>
                <Button type="submit" loading={busy} icon="check">
                  Salvar
                </Button>
              </div>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
