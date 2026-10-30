"use client";

import { useState } from "react";
import { usePortal } from "./Portal";
import { setTheme, useTheme } from "@/components/shell/theme";
import { Button, Card, ErrorNote, Label, PageHeader, Segmented, inputClass } from "@/components/ui";
import { api } from "@/lib/client/api";

export function AccountView() {
  const { me } = usePortal();
  const theme = useTheme();
  const [form, setForm] = useState({ current: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    if (form.password !== form.confirm) return setError("A confirmação não confere com a nova senha.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/password", { body: { current: form.current, password: form.password } });
      setForm({ current: "", password: "", confirm: "" });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Minha conta" subtitle="Seus dados de acesso e preferências." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="space-y-5 p-8">
          <h2 className="font-headline-md text-primary">Perfil</h2>
          <div>
            <Label>Nome</Label>
            <p className="text-[15px] text-on-surface">{me.name}</p>
          </div>
          <div>
            <Label>E-mail</Label>
            <p className="text-[15px] text-on-surface">{me.email}</p>
          </div>
          <div>
            <Label>Perfil de acesso</Label>
            <p className="text-[15px] text-on-surface">{me.role === "ADMIN" ? "Administrador" : "Colaborador"}{me.jobTitle && ` · ${me.jobTitle}`}</p>
          </div>
          <p className="text-[12px] text-on-surface-variant">Para alterar nome, e-mail ou cargo, fale com a administração.</p>
          <div>
            <Label>Tema</Label>
            <Segmented
              value={theme}
              onChange={(t) => setTheme(t)}
              options={[
                { value: "light", label: "Claro", icon: "light_mode" },
                { value: "dark", label: "Escuro", icon: "dark_mode" },
              ]}
            />
          </div>
        </Card>
        <Card className="p-8">
          <h2 className="mb-5 font-headline-md text-primary">Trocar senha</h2>
          <form onSubmit={changePassword} className="space-y-4">
            <ErrorNote message={error} />
            {done && <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[13px] text-green-700">Senha alterada. As outras sessões foram encerradas.</p>}
            <label className="block">
              <Label>Senha atual</Label>
              <input type="password" autoComplete="current-password" className={inputClass} value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
            </label>
            <label className="block">
              <Label>Nova senha</Label>
              <input type="password" autoComplete="new-password" className={inputClass} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </label>
            <label className="block">
              <Label>Confirme</Label>
              <input type="password" autoComplete="new-password" className={inputClass} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
            </label>
            <Button type="submit" icon="lock_reset" loading={busy}>
              Salvar nova senha
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
