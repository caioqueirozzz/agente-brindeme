"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, ErrorNote, PageHeader } from "@/components/ui";
import { PageSkeleton } from "@/components/shell/PageSkeleton";
import { api, useApi } from "@/lib/client/api";

interface Settings {
  settings: { distribution_mode: "MANUAL" | "ROUND_ROBIN"; distribute_only_qualified: boolean; company_name: string };
  sellers: { id: string; name: string; receives_leads: boolean }[];
}

function Option({ active, icon, title, text, onClick }: { active: boolean; icon: string; title: string; text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-start gap-4 rounded-2xl border p-5 text-left transition ${active ? "border-primary bg-on-surface/[0.04]" : "border-outline-variant/50 hover:border-outline"}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${active ? "bg-primary text-on-primary" : "bg-on-surface/[0.06] text-on-surface-variant"}`}>
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-on-surface">{title}</span>
        <span className="mt-1 block text-[13px] leading-relaxed text-on-surface-variant">{text}</span>
      </span>
      {active && <span className="material-symbols-outlined ml-auto text-primary">check_circle</span>}
    </button>
  );
}

export function SettingsView() {
  const { data, setData } = useApi<Settings>("/api/settings");
  const [error, setError] = useState<string | null>(null);

  async function save(body: Partial<Settings["settings"]>) {
    setError(null);
    try {
      const res = await api<{ settings: Settings["settings"] }>("/api/settings", { method: "PATCH", body });
      setData((d) => (d ? { ...d, settings: res.settings } : d));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!data) return <PageSkeleton />;
  const { settings, sellers } = data;
  const inRotation = sellers.filter((s) => s.receives_leads);

  return (
    <div className="space-y-8">
      <PageHeader title="Distribuição de leads" subtitle="Como os leads que a Lia atende chegam aos vendedores." />
      <ErrorNote message={error} />

      <Card className="space-y-6 p-8">
        <div className="flex flex-col gap-4 md:flex-row">
          <Option
            active={settings.distribution_mode === "MANUAL"}
            icon="pan_tool_alt"
            title="Manual"
            text="Os leads ficam na fila e a administração escolhe o vendedor de cada um (pela home ou pelo CRM)."
            onClick={() => save({ distribution_mode: "MANUAL" })}
          />
          <Option
            active={settings.distribution_mode === "ROUND_ROBIN"}
            icon="autorenew"
            title="Rodízio automático"
            text="Cada lead vai para o próximo colaborador da fila, em ordem. Quem recebe é notificado na hora."
            onClick={() => save({ distribution_mode: "ROUND_ROBIN" })}
          />
        </div>

        <label className="flex items-start gap-3 rounded-2xl border border-outline-variant/50 p-5">
          <input
            type="checkbox"
            checked={settings.distribute_only_qualified}
            onChange={(e) => save({ distribute_only_qualified: e.target.checked })}
            className="mt-1 h-4 w-4 accent-[var(--pe-primary)]"
          />
          <span>
            <span className="block text-[15px] font-semibold text-on-surface">Só distribuir lead qualificado</span>
            <span className="block text-[13px] text-on-surface-variant">
              Recomendado. O rodízio espera a Lia fechar a estimativa com o cliente (ou a administração qualificar à mão) antes de passar o lead a um vendedor.
            </span>
          </span>
        </label>
      </Card>

      <Card className="p-8">
        <h3 className="mb-1 font-headline-md text-primary">Fila do rodízio</h3>
        <p className="mb-6 text-[13px] text-on-surface-variant">
          {inRotation.length} de {sellers.length} colaborador(es) participam. Para incluir ou tirar alguém, edite o acesso em{" "}
          <Link href="/admin/equipe" className="text-primary underline underline-offset-4">
            Equipe e acessos
          </Link>
          .
        </p>
        <ol className="flex flex-wrap gap-2">
          {inRotation.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 rounded-full border border-outline-variant/50 py-1.5 pl-1.5 pr-4 text-[13px]">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-on-primary">{i + 1}</span>
              {s.name}
            </li>
          ))}
          {inRotation.length === 0 && <li className="text-[13px] text-on-surface-variant">Ninguém no rodízio: os leads ficam na fila até alguém distribuir.</li>}
        </ol>
      </Card>
    </div>
  );
}
