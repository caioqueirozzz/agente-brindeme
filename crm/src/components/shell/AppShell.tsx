"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FluidBackground } from "./FluidBackground";
import { THEME_INIT_SCRIPT, applyTheme, setTheme, storedTheme, useTheme } from "./theme";

export interface NavLink {
  label: string;
  href: string;
  icon: string;
  description?: string;
  /** Ativo só na rota exata (ex.: a home, que é prefixo das demais) */
  exact?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavLink[];
}

export type NavEntry = NavLink | NavGroup;

export interface ShellNotification {
  id: string;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

interface AppShellProps {
  homeHref: string;
  nav: NavEntry[];
  settingsHref: string;
  /** null enquanto o usuário carrega */
  userName: string | null;
  avatarUrl: string | null;
  /** Selos do popup de perfil (papel, cargo...) */
  profileDetails?: ReactNode;
  notifications?: ShellNotification[];
  onNotificationOpen?: (notification: ShellNotification) => void;
  onNotificationsReadAll?: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

function isActive(link: NavLink, pathname: string) {
  return link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (parts[0][0] + last).toUpperCase();
}

// Mesmo padrão do guia "preventing flash before hydration": o script só deve
// executar no HTML do servidor; no cliente vira text/plain para o React não reclamar
function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Logo da Presentes. No escuro (e no login, sempre escuro) vira branca: o vermelho some no vinho. */
export function Wordmark({ className = "", forceWhite = false }: { className?: string; forceWhite?: boolean }) {
  return (
    <img
      src="/logo-presentes.png"
      alt="Presentes Especiais — criações personalizadas"
      className={`h-6 w-auto max-w-none shrink-0 object-contain md:h-7 ${forceWhite ? "brightness-0 invert" : "dark:brightness-0 dark:invert"} ${className}`}
    />
  );
}

function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === "dark";
  const knob = "flex h-7 w-7 items-center justify-center rounded-full transition-colors";

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}
      aria-pressed={dark}
      className={`items-center gap-0.5 rounded-full bg-on-surface/[0.06] p-1 text-on-surface-variant transition-colors hover:bg-on-surface/10 ${className}`}
    >
      <span className={`${knob} ${dark ? "" : "bg-surface text-on-surface shadow-sm"}`}>
        <span className="material-symbols-outlined text-[18px]">light_mode</span>
      </span>
      <span className={`${knob} ${dark ? "bg-surface-container-highest text-on-surface shadow-sm" : ""}`}>
        <span className="material-symbols-outlined text-[18px]">dark_mode</span>
      </span>
    </button>
  );
}

const POPUP_BASE =
  "absolute top-full mt-3 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-xl transition-all duration-200";
const POPUP_OPEN = "opacity-100 scale-100 pointer-events-auto";
const POPUP_CLOSED = "opacity-0 scale-95 pointer-events-none";
const ICON_BUTTON =
  "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-on-surface/[0.06] hover:text-on-surface";

/**
 * Casca das áreas logadas: fundo fluido, navbar flutuante (logo, páginas, sino,
 * perfil) e rodapé. Cada portal entra com as próprias páginas e dados do usuário.
 */
export function AppShell({
  homeHref,
  nav,
  settingsHref,
  userName,
  avatarUrl,
  profileDetails,
  notifications = [],
  onNotificationOpen,
  onNotificationsReadAll,
  onSignOut,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);
  // Guardar a rota junto do popup faz ele fechar sozinho ao navegar
  const [popup, setPopup] = useState<{ id: string; pathname: string } | null>(null);
  const open = popup?.pathname === pathname ? popup.id : null;

  useLayoutEffect(() => {
    applyTheme(storedTheme());
  }, []);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      if (!barRef.current?.contains(event.target as Node)) setPopup(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPopup(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(id: string) {
    setPopup(open === id ? null : { id, pathname });
  }
  const close = () => setPopup(null);

  const unreadCount = notifications.filter((n) => !n.read_at).length;
  const displayName = userName || "";

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background text-on-surface">
      <InlineScript html={THEME_INIT_SCRIPT} />
      <FluidBackground />

      <header className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        <div
          ref={barRef}
          className="pointer-events-auto relative flex h-14 max-w-full items-center gap-1 rounded-full border border-outline-variant/40 bg-surface/75 pl-4 pr-2 shadow-[0_8px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl md:pl-6"
        >
          <Link href={homeHref} onClick={close} aria-label="Presentes Especiais — início" className="shrink-0">
            <Wordmark />
          </Link>

          <span aria-hidden className="mx-3 hidden h-6 w-px bg-outline-variant/60 md:block" />

          {/* Páginas */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Principal">
            {nav.map((entry) => {
              if (!isGroup(entry)) {
                const active = isActive(entry, pathname);
                return (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-full px-4 py-2 text-sm transition-colors ${
                      active
                        ? "bg-on-surface/[0.08] font-semibold text-on-surface"
                        : "text-on-surface-variant hover:bg-on-surface/[0.05] hover:text-on-surface"
                    }`}
                  >
                    {entry.label}
                  </Link>
                );
              }

              const id = `nav:${entry.label}`;
              const active = entry.items.some((item) => isActive(item, pathname));
              const expanded = open === id;
              return (
                <div key={entry.label} className="relative">
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-expanded={expanded}
                    aria-haspopup="true"
                    className={`flex items-center gap-1 rounded-full py-2 pl-4 pr-2.5 text-sm transition-colors ${
                      active
                        ? "bg-on-surface/[0.08] font-semibold text-on-surface"
                        : "text-on-surface-variant hover:bg-on-surface/[0.05] hover:text-on-surface"
                    }`}
                  >
                    {entry.label}
                    <span
                      className={`material-symbols-outlined text-[18px] transition-transform ${expanded ? "rotate-180" : ""}`}
                    >
                      keyboard_arrow_down
                    </span>
                  </button>
                  <div
                    className={`${POPUP_BASE} left-0 w-72 origin-top-left p-2 ${expanded ? POPUP_OPEN : POPUP_CLOSED}`}
                  >
                    {entry.items.map((item) => {
                      const itemActive = isActive(item, pathname);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={close}
                          tabIndex={expanded ? undefined : -1}
                          aria-current={itemActive ? "page" : undefined}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                            itemActive ? "bg-on-surface/[0.07]" : "hover:bg-on-surface/[0.05]"
                          }`}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-on-surface/[0.06] text-on-surface">
                            <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-on-surface">{item.label}</span>
                            {item.description && (
                              <span className="block truncate text-xs text-on-surface-variant">{item.description}</span>
                            )}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="ml-2 flex items-center gap-1 md:ml-3">
            <ThemeToggle className="hidden md:flex" />

            {/* Menu (telas pequenas) */}
            <button
              type="button"
              onClick={() => toggle("menu")}
              aria-label="Menu"
              aria-expanded={open === "menu"}
              aria-haspopup="true"
              className={`${ICON_BUTTON} md:hidden`}
            >
              <span className="material-symbols-outlined">{open === "menu" ? "close" : "menu"}</span>
            </button>

            {/* Sino */}
            <button
              type="button"
              onClick={() => toggle("notifications")}
              aria-label="Notificações"
              aria-expanded={open === "notifications"}
              aria-haspopup="true"
              className={`${ICON_BUTTON} ${open === "notifications" ? "bg-on-surface/[0.06] text-on-surface" : ""}`}
            >
              <span className="material-symbols-outlined">notifications</span>
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {/* Perfil */}
            <button
              type="button"
              onClick={() => toggle("profile")}
              aria-label="Minha conta"
              aria-expanded={open === "profile"}
              aria-haspopup="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold tracking-wide text-on-primary ring-2 ring-transparent transition-all hover:ring-primary/25"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : displayName ? (
                initials(displayName)
              ) : (
                <span className="material-symbols-outlined text-xl">person</span>
              )}
            </button>
          </div>

          {/* Popup: menu em telas pequenas */}
          <div
            className={`${POPUP_BASE} inset-x-0 origin-top p-2 md:hidden ${open === "menu" ? POPUP_OPEN : POPUP_CLOSED}`}
          >
            {nav.map((entry) => (
              <div key={entry.label}>
                {isGroup(entry) && (
                  <p className="px-3 pb-1 pt-3 font-label-caps text-[10px] text-on-surface-variant">{entry.label}</p>
                )}
                {(isGroup(entry) ? entry.items : [entry]).map((item) => {
                  const itemActive = isActive(item, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={close}
                      tabIndex={open === "menu" ? undefined : -1}
                      aria-current={itemActive ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-on-surface transition-colors ${
                        itemActive ? "bg-on-surface/[0.07] font-semibold" : "hover:bg-on-surface/[0.05]"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[20px] text-on-surface-variant">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-outline-variant/30 px-3 pb-1 pt-3">
              <span className="text-sm text-on-surface-variant">Tema</span>
              <ThemeToggle className="flex" />
            </div>
          </div>

          {/* Popup: notificações */}
          <div
            className={`${POPUP_BASE} right-0 w-80 max-w-full origin-top-right ${
              open === "notifications" ? POPUP_OPEN : POPUP_CLOSED
            }`}
            role="dialog"
            aria-label="Notificações"
          >
            <div className="flex items-center justify-between border-b border-outline-variant/20 px-5 py-4">
              <h3 className="text-[15px] font-bold text-primary">Notificações</h3>
              <button
                type="button"
                onClick={onNotificationsReadAll}
                tabIndex={open === "notifications" ? undefined : -1}
                className="text-on-surface-variant/40 transition-colors duration-300 hover:text-green-500"
                title="Marcar todas como lidas"
              >
                <span className="material-symbols-outlined text-lg">done_all</span>
              </button>
            </div>
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-5 py-10">
                <span className="material-symbols-outlined mb-3 text-4xl text-on-surface-variant/30">
                  notifications_none
                </span>
                <p className="font-body-sm text-center text-on-surface-variant/60">Nenhuma notificação recente</p>
              </div>
            ) : (
              <div className="max-h-[320px] overflow-y-auto">
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => {
                      close();
                      onNotificationOpen?.(notification);
                    }}
                    tabIndex={open === "notifications" ? undefined : -1}
                    className={`flex w-full items-start gap-3 border-b border-outline-variant/10 px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-surface-container ${
                      notification.read_at ? "" : "bg-primary/[0.03]"
                    }`}
                  >
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <span className="material-symbols-outlined text-[18px] text-primary">notifications_active</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-body-sm font-bold text-on-surface">{notification.title}</p>
                      <p className="font-body-sm line-clamp-2 text-[12px] text-on-surface-variant">
                        {notification.message}
                      </p>
                      <p className="mt-1 font-label-caps text-[10px] text-on-surface-variant/40">
                        {new Date(notification.created_at).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    {!notification.read_at && <div className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Popup: perfil */}
          <div
            className={`${POPUP_BASE} right-0 w-64 max-w-full origin-top-right ${
              open === "profile" ? POPUP_OPEN : POPUP_CLOSED
            }`}
            role="dialog"
            aria-label="Minha conta"
          >
            <div className="border-b border-outline-variant/20 px-5 pb-4 pt-4">
              <p className="mb-3 font-label-caps text-label-caps text-on-secondary-container">Minha Conta</p>
              <p className="truncate font-body-md font-bold text-primary">{displayName || "—"}</p>
              {profileDetails && <div className="mt-3 space-y-3">{profileDetails}</div>}
            </div>
            <div className="py-2">
              <Link
                href={settingsHref}
                onClick={close}
                tabIndex={open === "profile" ? undefined : -1}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-container"
              >
                <span className="material-symbols-outlined text-xl text-on-surface-variant">settings</span>
                <span className="font-body-md text-primary">Configurações</span>
              </Link>
              <div className="mx-5 border-t border-outline-variant/20" />
              <button
                type="button"
                onClick={onSignOut}
                tabIndex={open === "profile" ? undefined : -1}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-container"
              >
                <span className="material-symbols-outlined text-xl text-on-surface-variant">logout</span>
                <span className="font-body-md text-primary">Sair</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] flex-1 space-y-12 px-4 pb-10 pt-28 md:px-10">{children}</main>

      <footer className="mt-auto border-t border-outline-variant/30 px-4 py-12 md:px-10">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between opacity-40">
          <p className="font-label-caps text-[10px]">&copy; {new Date().getFullYear()} Presentes Especiais · Uso interno</p>
          <div className="flex gap-6">
            <span className="font-label-caps text-[10px]">CRM Comercial</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
