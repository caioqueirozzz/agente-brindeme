"use client";

import { useState } from "react";
import Link from "next/link";
import { usePortal } from "@/components/portal/Portal";
import { Button, ErrorNote, Label, Modal, inputClass } from "@/components/ui";
import { api, useApi } from "@/lib/client/api";
import { ORDER_STAGE_LABELS, suggestedDueDate, suggestedOrderTitle } from "@/lib/orders";
import type { Order } from "@/lib/orders";
import { formatDateTime, formatMoney, formatPhone, leadDisplayName } from "@/lib/types";
import type { Lead } from "@/lib/types";

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-label-caps text-[10px] text-on-surface-variant">{label}</dt>
      <dd className="mt-1 text-[14px] text-on-surface">{children || "—"}</dd>
    </div>
  );
}

/**
 * Detalhes do pedido fechado no funil (o orçamento que a Lia apurou e o valor fechado) e a
 * passagem para o quadro de Pedidos, onde a Lia passa a acompanhar o andamento com o cliente.
 */
export function WonLeadModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { isAdmin, base } = usePortal();
  const { data } = useApi<{ lead: Lead }>(`/api/leads/${leadId}`);
  const orders = useApi<{ orders: Order[] }>(`/api/orders?lead=${leadId}`);
  const [form, setForm] = useState<{ title: string; due_date: string; client_note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);

  const lead = data?.lead;
  const q = lead?.qualification ?? {};
  const current =
    form ??
    (lead
      ? { title: suggestedOrderTitle(q.itens, lead.qualification_summary), due_date: suggestedDueDate(q.data_limite), client_note: "" }
      : null);
  const existing = orders.data?.orders ?? [];

  async function send() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/orders", { body: { lead_id: leadId, ...current } });
      setCreated(true);
      orders.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={lead ? `Pedido fechado · ${leadDisplayName(lead)}` : "Pedido fechado"} wide>
      {!lead || !current ? (
        <div className="h-72 animate-pulse rounded-2xl bg-on-surface/[0.04]" />
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Info label="Cliente">{leadDisplayName(lead)}</Info>
            <Info label="WhatsApp">{formatPhone(lead.phone)}</Info>
            <Info label="Empresa">{lead.company}</Info>
            <Info label="Valor fechado">{formatMoney(lead.won_value ?? lead.estimated_value)}</Info>
            <Info label="Fechado em">{lead.won_at ? formatDateTime(lead.won_at) : null}</Info>
            <Info label="Vendedor">{lead.assigned_name}</Info>
            <Info label="Ocasião">{q.ocasiao}</Info>
            <Info label="Prazo desejado">{q.data_limite}</Info>
            <Info label="Personalização">{q.personalizacao}</Info>
          </dl>

          {q.itens?.length ? (
            <div>
              <Label>Itens da estimativa</Label>
              <div className="overflow-hidden rounded-2xl border border-outline-variant/40">
                <table className="w-full text-[13px]">
                  <thead className="bg-on-surface/[0.04] text-left text-[11px] text-on-surface-variant">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Produto</th>
                      <th className="px-3 py-2 text-right font-semibold">Qtd.</th>
                      <th className="px-3 py-2 text-right font-semibold">Unit.</th>
                      <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.itens.map((i, n) => (
                      <tr key={n} className="border-t border-outline-variant/20">
                        <td className="px-3 py-2 text-on-surface">
                          {i.nome_produto}
                          {i.cor && <span className="text-on-surface-variant"> · {i.cor}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">{i.quantidade}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(i.preco_unitario)}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(i.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {q.total_estimado ? (
                    <tfoot>
                      <tr className="border-t border-outline-variant/40 font-semibold">
                        <td className="px-3 py-2" colSpan={3}>
                          Total estimado pela Lia
                        </td>
                        <td className="px-3 py-2 text-right">{formatMoney(q.total_estimado)}</td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </div>
          ) : (
            lead.qualification_summary && (
              <div>
                <Label>Resumo do orçamento</Label>
                <p className="text-[14px] text-on-surface">{lead.qualification_summary}</p>
              </div>
            )
          )}

          {existing.length > 0 && (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-[13px] text-green-700">
              <p className="font-semibold">{created ? "Enviado para Pedidos. A Lia já acompanha este pedido." : "Este cliente já está no quadro de Pedidos:"}</p>
              <ul className="mt-1">
                {existing.map((o) => (
                  <li key={o.id}>
                    <Link href={`${base}/quadros?view=pedidos&pedido=${o.id}`} className="underline underline-offset-4">
                      {o.code}
                    </Link>{" "}
                    · {o.title} · {ORDER_STAGE_LABELS[o.stage]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isAdmin ? (
            !created && (
              <form
                className="space-y-4 rounded-2xl bg-on-surface/[0.03] p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <p className="text-[14px] font-semibold text-on-surface">
                  {existing.length ? "Enviar outro pedido deste cliente" : "Passar para o quadro de Pedidos"}
                </p>
                <ErrorNote message={error} />
                <label className="block">
                  <Label>Pedido</Label>
                  <input className={inputClass} value={current.title} onChange={(e) => setForm({ ...current, title: e.target.value })} required />
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <Label>Previsão de entrega</Label>
                    <input type="date" className={inputClass} value={current.due_date} onChange={(e) => setForm({ ...current, due_date: e.target.value })} />
                  </label>
                  <label className="block">
                    <Label>Recado para o cliente (opcional)</Label>
                    <input className={inputClass} value={current.client_note} onChange={(e) => setForm({ ...current, client_note: e.target.value })} maxLength={500} />
                  </label>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] text-on-surface-variant">Entra em “{ORDER_STAGE_LABELS.CONFIRMADO}” e a Lia passa a responder sobre ele.</p>
                  <Button type="submit" icon="package_2" loading={busy}>
                    Enviar para Pedidos
                  </Button>
                </div>
              </form>
            )
          ) : (
            existing.length === 0 && <p className="text-[13px] text-on-surface-variant">A gestão passa este pedido para o quadro de Pedidos.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
