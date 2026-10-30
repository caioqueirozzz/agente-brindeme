"use client";

import { useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { FluidBackground } from "@/components/shell/FluidBackground";
import { Wordmark } from "@/components/shell/AppShell";

/*
 * Peças das telas de entrada. Sempre no tema escuro (como no dcimob):
 * campos só com a linha de baixo, botão em pílula e brilhos sobre o fluido.
 */

export function AuthShell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div data-theme="dark" className="relative isolate min-h-screen w-full overflow-hidden bg-background text-on-surface">
      <FluidBackground theme="dark" />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-background/45" />
      <div aria-hidden className="pointer-events-none absolute -left-40 top-24 -z-10 h-[520px] w-[520px] rounded-full bg-[#1557e6]/20 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -right-32 top-1/3 -z-10 h-[460px] w-[460px] rounded-full bg-[#ff7a8f]/10 blur-[120px]" />
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px]">
        <section className="flex w-full flex-col px-4 py-8 sm:px-10 lg:w-[56%] lg:px-20">
          <Wordmark forceWhite className="!h-8 self-start" />
          <div className="flex flex-1 items-center justify-center py-12">
            <div className="w-full max-w-[420px] animate-[auth-step-in_0.5s_ease-out_both]">{children}</div>
          </div>
          <p className="text-sm text-outline">Presentes Especiais © {new Date().getFullYear()} · acesso restrito à equipe</p>
        </section>
        {aside && <aside className="hidden p-6 lg:block lg:w-[44%]">{aside}</aside>}
      </div>
    </div>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="mb-10">
      <h1 className="mb-3 text-[34px] leading-[1.15] tracking-[-0.02em] text-primary md:text-[38px]">{title}</h1>
      {subtitle && <p className="text-[15px] leading-relaxed text-on-surface-variant">{subtitle}</p>}
    </header>
  );
}

const inputClass =
  "w-full border-0 border-b border-outline-variant bg-transparent px-0 py-2.5 text-[15px] text-on-surface placeholder:text-outline outline-none transition-colors focus:border-brand";

export function Field({ label, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const inputId = id ?? props.name;
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-[14px] font-medium text-on-surface">
        {label}
      </label>
      <input id={inputId} className={inputClass} {...props} />
    </div>
  );
}

export function PasswordField(props: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Field {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        className="absolute right-0 top-[34px] p-1 text-outline transition-colors hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-[20px]">{visible ? "visibility_off" : "visibility"}</span>
      </button>
    </div>
  );
}

export function PrimaryButton({ children, loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      disabled={loading || props.disabled}
      {...props}
      className="relative flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#2f6bf0] to-[#1557e6] text-[15px] font-medium text-white shadow-[0_8px_30px_-8px_rgba(21,87,230,0.65)] transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-6 flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700">
      <span className="material-symbols-outlined text-[18px]">error</span>
      {message}
    </div>
  );
}

const HIGHLIGHTS = [
  { icon: "forum", title: "CRM", text: "Todas as conversas que a Lia atendeu no WhatsApp, com o que ela apurou de cada cliente." },
  { icon: "device_thermostat", title: "Classificação", text: "Leads quentes, mornos e frios, qualificados antes de chegar ao vendedor." },
  { icon: "view_kanban", title: "Quadros", text: "Do primeiro contato ao pedido fechado, arrastando o card de etapa." },
  { icon: "auto_awesome", title: "PresentesIA", text: "Pergunte sobre a sua carteira e receba o próximo passo." },
];

export function AuthShowcase() {
  return (
    <div className="flex h-full flex-col justify-end overflow-hidden rounded-[28px] border border-outline-variant/50 bg-surface/40 p-10 backdrop-blur-xl">
      <p className="mb-3 font-label-caps text-[11px] text-on-surface-variant">Central comercial</p>
      <h2 className="mb-10 text-[30px] font-light leading-tight tracking-tight text-primary">
        Cada presente começa
        <br />
        numa boa conversa.
      </h2>
      <ul className="space-y-6">
        {HIGHLIGHTS.map((h) => (
          <li key={h.title} className="flex gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-on-surface/[0.07]">
              <span className="material-symbols-outlined text-[20px] text-brand">{h.icon}</span>
            </span>
            <span>
              <span className="block text-[15px] font-semibold text-on-surface">{h.title}</span>
              <span className="block text-[13px] leading-relaxed text-on-surface-variant">{h.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
