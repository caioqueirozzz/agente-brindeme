"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthHeading, AuthShell, FormError, PasswordField, PrimaryButton } from "@/components/auth/AuthUI";
import { api } from "@/lib/client/api";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setError("A confirmação não confere com a nova senha.");
    setLoading(true);
    setError(null);
    try {
      const { redirect } = await api<{ redirect: string }>("/api/auth/password", { body: { current, password } });
      router.replace(redirect);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <form onSubmit={submit}>
        <AuthHeading title="Defina sua senha" subtitle="Troque a senha provisória por uma só sua: pelo menos 8 caracteres, com letras e números." />
        <FormError message={error} />
        <div className="mb-10 space-y-7">
          <PasswordField label="Senha atual (provisória)" name="current" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          <PasswordField label="Nova senha" name="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <PasswordField label="Confirme a nova senha" name="confirm" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <PrimaryButton type="submit" loading={loading}>
          Salvar e entrar
        </PrimaryButton>
      </form>
    </AuthShell>
  );
}
