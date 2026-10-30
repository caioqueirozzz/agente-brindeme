"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthHeading, AuthShell, AuthShowcase, Field, FormError, PasswordField, PrimaryButton } from "@/components/auth/AuthUI";
import { api } from "@/lib/client/api";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { redirect } = await api<{ redirect: string }>("/api/auth/login", { body: { email, password } });
      const wanted = params.get("redirect");
      // Só volta para a página pedida se ela for do portal certo (o proxy confere de novo)
      const target = wanted && wanted.startsWith(redirect.slice(0, redirect.indexOf("/", 1))) ? wanted : redirect;
      router.replace(target);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <AuthHeading title="Bem-vindo" subtitle="Entre com o acesso que a administração liberou para você." />
      <FormError message={error} />
      <div className="mb-10 space-y-7">
        <Field label="E-mail" name="email" type="email" autoComplete="email" placeholder="voce@presentesespeciais.com.br" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField label="Senha" name="password" autoComplete="current-password" placeholder="••••••••" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <PrimaryButton type="submit" loading={loading}>
        {loading ? "Entrando..." : "Entrar"}
      </PrimaryButton>
      <p className="mt-8 text-[13px] leading-relaxed text-on-surface-variant">
        Esqueceu a senha ou ainda não tem acesso? Peça à administração para liberar ou redefinir o seu acesso.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell aside={<AuthShowcase />}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
