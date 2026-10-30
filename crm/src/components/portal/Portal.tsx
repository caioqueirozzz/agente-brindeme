"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import type { NavEntry, NavLink, ShellNotification } from "@/components/shell/AppShell";
import { api, useApi } from "@/lib/client/api";
import type { Me, Role } from "@/lib/types";

interface PortalValue {
  me: Me;
  /** "/admin" ou "/app" */
  base: string;
  isAdmin: boolean;
}

const PortalContext = createContext<PortalValue | null>(null);

/** Usuário logado e prefixo do portal. Só existe dentro de <Portal>. */
export function usePortal(): PortalValue {
  const value = useContext(PortalContext);
  if (!value) throw new Error("usePortal fora do Portal");
  return value;
}

function navFor(role: Role): NavEntry[] {
  const base = role === "ADMIN" ? "/admin" : "/app";
  const gestao: NavLink[] = [
    { label: "Relatórios", icon: "analytics", href: `${base}/relatorios`, description: "Indicadores e desempenho comercial" },
  ];
  if (role === "ADMIN") {
    gestao.push(
      { label: "Equipe e acessos", icon: "badge", href: "/admin/equipe", description: "Liberar, editar e desativar colaboradores" },
      { label: "Distribuição", icon: "alt_route", href: "/admin/configuracoes", description: "Rodízio de leads e regras do CRM" },
    );
  }
  return [
    { label: "Início", icon: "today", href: `${base}/inicio` },
    {
      label: "Operação",
      items: [
        { label: "CRM", icon: "forum", href: `${base}/crm`, description: "Conversas e leads" },
        { label: "Quadros", icon: "view_kanban", href: `${base}/quadros`, description: "Quadros de tarefas da equipe" },
        { label: "PresentesIA", icon: "auto_awesome", href: `${base}/presentesia`, description: "Assistente de IA" },
      ],
    },
    { label: "Gestão", items: gestao },
  ];
}

export function Portal({ role, children }: { role: Role; children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const notifications = useApi<{ notifications: ShellNotification[] }>(me ? "/api/notifications" : null, 30_000);

  useEffect(() => {
    api<{ user: Me }>("/api/me")
      .then(({ user }) => {
        if (user.mustChangePassword) return router.replace("/trocar-senha");
        // Papel mudou desde o login: vai para o portal certo
        if (user.role !== role) return router.replace(user.role === "ADMIN" ? "/admin/inicio" : "/app/inicio");
        setMe(user);
      })
      .catch(() => {});
  }, [role, router]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const base = role === "ADMIN" ? "/admin" : "/app";

  return (
    <AppShell
      homeHref={`${base}/inicio`}
      nav={navFor(role)}
      settingsHref={`${base}/conta`}
      userName={me?.name ?? null}
      avatarUrl={null}
      notifications={notifications.data?.notifications ?? []}
      onNotificationOpen={async (n) => {
        await api("/api/notifications", { body: { id: n.id } }).catch(() => {});
        notifications.reload();
        if (n.link) router.push(n.link);
      }}
      onNotificationsReadAll={async () => {
        await api("/api/notifications", { body: { all: true } }).catch(() => {});
        notifications.reload();
      }}
      onSignOut={signOut}
      profileDetails={
        me && (
          <>
            {me.jobTitle && <p className="font-body-sm text-on-surface-variant">{me.jobTitle}</p>}
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-label-caps text-[10px] font-bold ${
                me.role === "ADMIN" ? "border-accent-gold/40 bg-accent-gold/10 text-accent-gold" : "border-outline-variant/50 text-on-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                {me.role === "ADMIN" ? "shield" : "person"}
              </span>
              {me.role === "ADMIN" ? "ADMIN" : "COLABORADOR"}
            </span>
          </>
        )
      }
    >
      {me ? (
        <PortalContext.Provider value={{ me, base, isAdmin: me.role === "ADMIN" }}>{children}</PortalContext.Provider>
      ) : (
        <div className="h-[60vh] animate-pulse rounded-2xl bg-on-surface/[0.04]" />
      )}
    </AppShell>
  );
}
