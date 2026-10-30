"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { QUALIFICATION_LABELS, TEMPERATURE_STYLES, initials, leadTemperature } from "@/lib/types";
import type { QualificationStatus } from "@/lib/types";

/* Peças visuais reaproveitadas pelas páginas (mesma linguagem do dcimob) */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <h1 className="font-display-lg text-display-lg-mobile tracking-tight text-primary">{title}</h1>
        {subtitle && <p className="mt-2 font-body-md text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Título de bloco da home (como o "Painel de Gestão" do dcimob) */
export function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="mb-1 font-headline-md text-primary">{title}</h2>
      <p className="font-body-md text-on-secondary-container">{subtitle}</p>
    </div>
  );
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-headline-md text-primary">{title}</h2>
        {subtitle && <p className="text-body-sm text-on-secondary-container">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`premium-card rounded-2xl ${className}`}>{children}</div>;
}

export function KpiCard({
  icon,
  label,
  value,
  badge,
  tone = "neutral",
  hint,
  onClick,
}: {
  icon: string;
  label: string;
  value: ReactNode;
  badge?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  hint?: ReactNode;
  onClick?: () => void;
}) {
  const toneClass = {
    neutral: "text-on-secondary-container bg-surface-container",
    good: "text-green-700 bg-green-50",
    warn: "text-amber-800 bg-amber-50",
    bad: "text-red-700 bg-red-50",
  }[tone];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`premium-card flex min-h-[152px] flex-col rounded-lg p-8 text-left ${onClick ? "cursor-pointer hover:border-primary/20" : ""}`}>
      <div className="mb-4 flex items-start justify-between">
        <span className="material-symbols-outlined text-primary/40">{icon}</span>
        {badge && <span className={`rounded px-2 py-1 font-label-caps text-[10px] ${toneClass}`}>{badge}</span>}
      </div>
      <p className="mb-1 font-label-caps text-label-caps text-on-secondary-container">{label}</p>
      <div className="text-[32px] font-bold leading-none text-primary">{value}</div>
      {hint && <p className="mt-3 text-[13px] text-on-surface-variant">{hint}</p>}
    </Tag>
  );
}

export function TemperatureBadge({ score, compact = false }: { score: number | null | undefined; compact?: boolean }) {
  const temp = leadTemperature(score);
  if (!temp) return <span className="rounded-full border border-outline-variant/50 px-2 py-0.5 text-[10px] text-on-surface-variant">sem score</span>;
  const style = TEMPERATURE_STYLES[temp];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${style.className}`}>
      <span className="material-symbols-outlined text-[12px]">{style.icon}</span>
      {compact ? score : `${style.label} · ${score}`}
    </span>
  );
}

export function QualificationBadge({ status }: { status: QualificationStatus }) {
  const cls = {
    NONE: "border-outline-variant/50 text-on-surface-variant",
    IN_PROGRESS: "border-sky-200 bg-sky-50 text-sky-800",
    QUALIFIED: "border-green-200 bg-green-50 text-green-700",
    DISQUALIFIED: "border-red-200 bg-red-50 text-red-700",
  }[status];
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{QUALIFICATION_LABELS[status]}</span>;
}

export function Avatar({ name, size = 36 }: { name: string | null; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-primary font-bold tracking-wide text-on-primary"
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.32) }}
    >
      {name ? initials(name) : <span className="material-symbols-outlined text-[18px]">person</span>}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  icon,
  className = "",
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "ghost" | "danger"; icon?: string; loading?: boolean }) {
  const styles = {
    primary: "bg-primary text-on-primary hover:opacity-90",
    outline: "border border-outline-variant text-on-surface hover:border-primary hover:bg-on-surface/[0.04]",
    ghost: "text-on-surface-variant hover:bg-on-surface/[0.06] hover:text-on-surface",
    danger: "border border-red-200 text-red-700 hover:bg-red-50",
  }[variant];
  return (
    <button
      type="button"
      disabled={loading || props.disabled}
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
      ) : (
        icon && <span className="material-symbols-outlined text-[18px]">{icon}</span>
      )}
      {children}
    </button>
  );
}

export const inputClass =
  "w-full rounded-xl border border-outline-variant/70 bg-surface-container-lowest px-3 py-2.5 text-[14px] text-on-surface placeholder:text-outline outline-none transition-colors focus:border-primary";

export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block font-label-caps text-[10px] text-on-surface-variant">{children}</span>;
}

export function EmptyState({ icon, title, text }: { icon: string; title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="material-symbols-outlined mb-3 text-4xl text-on-surface-variant/30">{icon}</span>
      <p className="font-body-md font-semibold text-on-surface">{title}</p>
      {text && <p className="mt-1 max-w-sm text-[13px] text-on-surface-variant">{text}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl sm:rounded-3xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[18px] font-semibold text-primary">{title}</h3>
          <button onClick={onClose} aria-label="Fechar" className="rounded-full p-1.5 text-on-surface-variant hover:bg-on-surface/[0.06]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-outline-variant/50 bg-surface-container-lowest p-1" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-label-caps text-[10px] transition-all ${
            o.value === value ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-primary"
          }`}
        >
          {o.icon && <span className="material-symbols-outlined text-[16px]">{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{message}</p>;
}
