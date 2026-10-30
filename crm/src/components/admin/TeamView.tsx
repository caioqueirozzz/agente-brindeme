"use client";

import { useState } from "react";
import { usePortal } from "@/components/portal/Portal";
import { Avatar, Button, Card, EmptyState, ErrorNote, Label, Modal, PageHeader, inputClass } from "@/components/ui";
import { PageSkeleton } from "@/components/shell/PageSkeleton";
import { api, useApi } from "@/lib/client/api";
import { formatMoney, formatPhone, relativeTime } from "@/lib/types";
import type { Role } from "@/lib/types";

interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  job_title: string | null;
  phone: string | null;
  is_active: boolean;
  receives_leads: boolean;
  must_change_password: boolean;
  monthly_goal: number | null;
  last_login_at: string | null;
  active_leads: number;
}

const EMPTY = { name: "", email: "", role: "COLABORADOR" as Role, job_title: "", phone: "", monthly_goal: "", receives_leads: true };

/** Mostra a senha provisória uma única vez, para o admin repassar */
function PasswordReveal({ info, onClose }: { info: { name: string; email: string; password: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!info) return null;
  const text = `Acesso ao CRM Presentes Especiais\nE-mail: ${info.email}\nSenha provisória: ${info.password}\nNo primeiro acesso você vai definir uma senha só sua.`;
  return (
    <Modal open onClose={onClose} title="Acesso liberado">
      <p className="mb-4 text-[14px] text-on-surface-variant">
        Envie estes dados para <b className="text-on-surface">{info.name}</b>. A senha provisória não aparece de novo; no primeiro acesso a pessoa define uma senha própria.
      </p>
      <pre className="mb-5 whitespace-pre-wrap rounded-2xl bg-surface-container p-4 font-mono text-[13px] text-on-surface">{text}</pre>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          icon={copied ? "check" : "content_copy"}
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? "Copiado" : "Copiar"}
        </Button>
        <Button onClick={onClose}>Pronto</Button>
      </div>
    </Modal>
  );
}

export function TeamView() {
  const { me } = usePortal();
  const { data, reload } = useApi<{ members: Member[] }>("/api/team");
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<{ name: string; email: string; password: string } | null>(null);

  function open(member: Member | "new") {
    setError(null);
    setEditing(member);
    setForm(
      member === "new"
        ? EMPTY
        : {
            name: member.name,
            email: member.email,
            role: member.role,
            job_title: member.job_title ?? "",
            phone: member.phone ?? "",
            monthly_goal: member.monthly_goal?.toString() ?? "",
            receives_leads: member.receives_leads,
          }
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editing === "new") {
        const res = await api<{ member: Member; temporaryPassword: string }>("/api/team", { body: form });
        setReveal({ name: res.member.name, email: res.member.email, password: res.temporaryPassword });
      } else if (editing) {
        await api(`/api/team/${editing.id}`, { method: "PATCH", body: { ...form, email: undefined } });
      }
      setEditing(null);
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function action(member: Member, body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    try {
      const res = await api<{ temporaryPassword: string | null; leadsReturned: number }>(`/api/team/${member.id}`, { method: "PATCH", body });
      if (res.temporaryPassword) setReveal({ name: member.name, email: member.email, password: res.temporaryPassword });
      if (res.leadsReturned) alert(`${res.leadsReturned} lead(s) em aberto voltaram para a fila de distribuição.`);
      setEditing(null);
      reload();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const members = data?.members ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Equipe e acessos"
        subtitle="Libere o acesso dos colaboradores à plataforma. Cada colaborador vê apenas os leads, conversas e números dele."
        actions={
          <Button icon="person_add" onClick={() => open("new")}>
            Liberar acesso
          </Button>
        }
      />

      {!data ? (
        <PageSkeleton />
      ) : members.length === 0 ? (
        <Card>
          <EmptyState icon="badge" title="Nenhum acesso ainda" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[14px]">
              <thead className="border-b border-outline-variant/30 text-left font-label-caps text-[10px] text-on-surface-variant">
                <tr>
                  <th className="px-6 py-4">Pessoa</th>
                  <th className="px-4 py-4">Perfil</th>
                  <th className="px-4 py-4">Leads</th>
                  <th className="px-4 py-4">Meta mensal</th>
                  <th className="px-4 py-4">Último acesso</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className={`border-b border-outline-variant/15 last:border-0 ${m.is_active ? "" : "opacity-50"}`}>
                    <td className="px-6 py-4">
                      <span className="flex items-center gap-3">
                        <Avatar name={m.name} size={36} />
                        <span className="min-w-0">
                          <span className="block font-semibold text-on-surface">
                            {m.name} {m.id === me.id && <span className="text-[11px] font-normal text-on-surface-variant">(você)</span>}
                          </span>
                          <span className="block truncate text-[12px] text-on-surface-variant">
                            {m.email}
                            {m.job_title && ` · ${m.job_title}`}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${m.role === "ADMIN" ? "border-accent-gold/40 text-accent-gold" : "border-outline-variant/60 text-on-surface-variant"}`}>
                        {m.role === "ADMIN" ? "ADMIN" : "COLABORADOR"}
                      </span>
                      {!m.is_active && <span className="ml-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">inativo</span>}
                      {m.is_active && m.must_change_password && <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">1º acesso pendente</span>}
                    </td>
                    <td className="px-4 py-4">
                      {m.role === "COLABORADOR" ? (
                        <span className="text-[13px]">
                          {m.active_leads} ativos
                          <span className={`ml-2 text-[11px] ${m.receives_leads ? "text-green-700" : "text-on-surface-variant"}`}>{m.receives_leads ? "· no rodízio" : "· fora do rodízio"}</span>
                        </span>
                      ) : (
                        <span className="text-on-surface-variant">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">{m.monthly_goal ? formatMoney(m.monthly_goal, true) : "—"}</td>
                    <td className="px-4 py-4 text-[13px] text-on-surface-variant">{m.last_login_at ? relativeTime(m.last_login_at) : "nunca"}</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => open(m)} className="rounded-full p-2 text-on-surface-variant hover:bg-on-surface/[0.06] hover:text-primary" title="Editar">
                          <span className="material-symbols-outlined text-[20px]">edit</span>
                        </button>
                        {m.is_active && (
                          <button
                            onClick={() => action(m, { reset_password: true }, `Gerar nova senha provisória para ${m.name}? As sessões abertas serão encerradas.`)}
                            className="rounded-full p-2 text-on-surface-variant hover:bg-on-surface/[0.06] hover:text-primary"
                            title="Redefinir senha"
                          >
                            <span className="material-symbols-outlined text-[20px]">key</span>
                          </button>
                        )}
                        {m.id !== me.id && (
                          <button
                            onClick={() =>
                              action(
                                m,
                                { is_active: !m.is_active },
                                m.is_active ? `Desativar ${m.name}? O acesso é cortado na hora e os leads abertos voltam para a fila.` : undefined
                              )
                            }
                            className={`rounded-full p-2 hover:bg-on-surface/[0.06] ${m.is_active ? "text-on-surface-variant hover:text-red-600" : "text-green-700"}`}
                            title={m.is_active ? "Desativar acesso" : "Reativar acesso"}
                          >
                            <span className="material-symbols-outlined text-[20px]">{m.is_active ? "person_off" : "person_check"}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-primary">
          <span className="material-symbols-outlined text-[18px]">policy</span>O que cada perfil acessa
        </h3>
        <div className="grid grid-cols-1 gap-4 text-[13px] text-on-surface-variant md:grid-cols-2">
          <p>
            <b className="text-on-surface">Admin:</b> painel da operação inteira, todos os leads e conversas, distribuição, relatórios da equipe, gestão de acessos e a PresentesIA com visão da empresa.
          </p>
          <p>
            <b className="text-on-surface">Colaborador:</b> só os leads e conversas atribuídos a ele, a própria agenda, meta e relatórios. A PresentesIA dele não responde sobre outros colaboradores nem sobre dados administrativos.
          </p>
        </div>
        <p className="mt-3 text-[12px] text-on-surface-variant">As conversas com a PresentesIA são privadas de cada pessoa — nem a administração as lê.</p>
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Liberar acesso" : "Editar acesso"}>
        <div className="space-y-4">
          <ErrorNote message={error} />
          <label className="block">
            <Label>Nome</Label>
            <input className={inputClass} value={form.name} onChange={set("name")} autoFocus />
          </label>
          <label className="block">
            <Label>E-mail de acesso</Label>
            <input className={inputClass} type="email" value={form.email} onChange={set("email")} disabled={editing !== "new"} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Label>Perfil</Label>
              <select className={inputClass} value={form.role} onChange={set("role")} disabled={editing !== "new" && editing?.id === me.id}>
                <option value="COLABORADOR">Colaborador</option>
                <option value="ADMIN">Admin</option>
              </select>
            </label>
            <label className="block">
              <Label>Cargo</Label>
              <input className={inputClass} value={form.job_title} onChange={set("job_title")} placeholder="Ex.: Consultora comercial" />
            </label>
            <label className="block">
              <Label>Telefone</Label>
              <input className={inputClass} value={form.phone} onChange={set("phone")} placeholder={formatPhone("5583999990000")} />
            </label>
            <label className="block">
              <Label>Meta mensal (R$)</Label>
              <input className={inputClass} inputMode="decimal" value={form.monthly_goal} onChange={set("monthly_goal")} />
            </label>
          </div>
          {form.role === "COLABORADOR" && (
            <label className="flex items-center gap-3 rounded-xl border border-outline-variant/50 px-4 py-3 text-[13px]">
              <input type="checkbox" checked={form.receives_leads} onChange={(e) => setForm({ ...form, receives_leads: e.target.checked })} className="h-4 w-4 accent-[var(--pe-primary)]" />
              Participa do rodízio automático de leads
            </label>
          )}
          {editing === "new" && <p className="text-[12px] text-on-surface-variant">Uma senha provisória será gerada. No primeiro acesso, a pessoa define a própria senha.</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} loading={busy} icon={editing === "new" ? "person_add" : "save"}>
              {editing === "new" ? "Liberar acesso" : "Salvar"}
            </Button>
          </div>
        </div>
      </Modal>

      <PasswordReveal info={reveal} onClose={() => setReveal(null)} />
    </div>
  );
}
