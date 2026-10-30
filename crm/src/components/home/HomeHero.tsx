"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { usePortal } from "@/components/portal/Portal";

/*
 * Topo da central do dia (mesmo desenho do dcimob): saudação com emoji do
 * período, campo da PresentesIA que "digita sozinho" exemplos de pergunta e
 * atalhos com ícone. Enviar abre a PresentesIA já com a pergunta.
 */

interface Suggestion {
  label: string;
  icon: string;
  prompt: string;
}

const ADMIN_SUGGESTIONS: Suggestion[] = [
  { label: "Desempenho da equipe", icon: "monitoring", prompt: "Como está o desempenho da equipe neste mês?" },
  { label: "Leads quentes", icon: "local_fire_department", prompt: "Quais leads quentes estão sem vendedor agora?" },
  { label: "Fila e atenção", icon: "support_agent", prompt: "O que está na fila de distribuição e quais conversas pedem atenção?" },
  { label: "Motivos de perda", icon: "trending_down", prompt: "Quais os principais motivos de perda nos últimos 90 dias?" },
];

const SELLER_SUGGESTIONS: Suggestion[] = [
  { label: "Meu dia", icon: "event_upcoming", prompt: "Quem devo contatar primeiro hoje?" },
  { label: "Leads quentes", icon: "local_fire_department", prompt: "Quais dos meus leads estão mais quentes agora?" },
  { label: "Minha meta", icon: "flag", prompt: "Como estou em relação à minha meta do mês?" },
  { label: "Follow-up", icon: "edit_note", prompt: "Escreva uma mensagem de follow-up para o meu lead mais quente" },
];

const ADMIN_PHRASES = [...ADMIN_SUGGESTIONS.map((s) => s.prompt), "Quanto fechamos nos últimos 30 dias?"];
const SELLER_PHRASES = [...SELLER_SUGGESTIONS.map((s) => s.prompt), "Quais retornos estão atrasados?"];

function greetingFor(hour: number) {
  if (hour >= 5 && hour < 12) return { text: "Bom dia", emoji: "☀️", wish: "um ótimo dia" };
  if (hour >= 12 && hour < 18) return { text: "Boa tarde", emoji: "🌤️", wish: "uma ótima tarde" };
  return { text: "Boa noite", emoji: "🌙", wish: "uma ótima noite" };
}

const subscribeClock = (onChange: () => void) => {
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
};
/** Hora local do navegador; null no servidor, que não sabe o fuso de quem vê */
function useLocalHour(): number | null {
  return useSyncExternalStore(subscribeClock, () => new Date().getHours(), () => null);
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (onChange: () => void) => {
  const q = window.matchMedia(REDUCED);
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
};
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(REDUCED).matches, () => false);
}

// Ritmo do campo que digita sozinho
const TYPE_MS = 42;
const ERASE_MS = 22;
const HOLD_MS = 2200;
const PAUSE_MS = 420;

/** Escreve uma frase letra a letra, segura, apaga mais rápido e passa à próxima. `phrases` deve ser constante. */
function useTypingPlaceholder(phrases: readonly string[], enabled: boolean): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!enabled || phrases.length === 0) return;
    let timer: ReturnType<typeof setTimeout>;
    let index = 0;
    let length = 0;
    let erasing = false;
    const tick = () => {
      const phrase = phrases[index];
      let delay = TYPE_MS;
      if (!erasing) {
        length += 1;
        if (length >= phrase.length) {
          length = phrase.length;
          erasing = true;
          delay = HOLD_MS;
        }
      } else {
        length -= 1;
        delay = ERASE_MS;
        if (length <= 0) {
          length = 0;
          erasing = false;
          index = (index + 1) % phrases.length;
          delay = PAUSE_MS;
        }
      }
      setText(phrase.slice(0, length));
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, PAUSE_MS);
    return () => clearTimeout(timer);
  }, [phrases, enabled]);
  return enabled ? text : "";
}

export function HomeHero() {
  const { me, base, isAdmin } = usePortal();
  const router = useRouter();
  const hour = useLocalHour();
  const reducedMotion = useReducedMotion();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);

  const suggestions = isAdmin ? ADMIN_SUGGESTIONS : SELLER_SUGGESTIONS;
  const typed = useTypingPlaceholder(isAdmin ? ADMIN_PHRASES : SELLER_PHRASES, !reducedMotion && !sending);
  const showTyped = !reducedMotion && draft === "" && !sending;
  const greeting = hour === null ? null : greetingFor(hour);
  const firstName = me.name.trim().split(/\s+/)[0];

  function ask(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    setSending(true);
    router.push(`${base}/presentesia?q=${encodeURIComponent(q)}`);
  }

  return (
    <section className="mx-auto w-full max-w-3xl pt-2 text-center md:pt-8" aria-label="PresentesIA">
      {greeting ? (
        <div className="ia-block">
          <h1 className="text-[28px] leading-tight tracking-[-0.01em] text-primary md:text-[40px]">
            {greeting.text}, {firstName}! <span aria-hidden>{greeting.emoji}</span>
          </h1>
          <p className="mt-3 text-body-md text-on-surface-variant">Desejamos {greeting.wish} e muita prosperidade nos seus resultados.</p>
        </div>
      ) : (
        <div className="animate-pulse" aria-hidden>
          <div className="mx-auto h-9 w-72 max-w-full rounded-full bg-on-surface/10 md:h-12 md:w-96" />
          <div className="mx-auto mt-3 h-6 w-96 max-w-full rounded-full bg-on-surface/[0.06]" />
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
        className="mt-8 flex items-center gap-2 rounded-[28px] border border-outline-variant/50 bg-surface/75 py-2 pl-6 pr-2 shadow-[0_8px_30px_rgba(0,0,0,0.06)] backdrop-blur-xl transition-colors focus-within:border-outline"
      >
        <div className="relative min-w-0 flex-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={sending}
            maxLength={4000}
            placeholder={showTyped ? "" : "Pergunte à PresentesIA sobre leads, metas e próximos passos…"}
            aria-label="Pergunta para a PresentesIA"
            className="h-11 w-full bg-transparent text-left text-body-md text-on-surface outline-none placeholder:text-on-surface-variant/60 disabled:opacity-60"
          />
          {showTyped && (
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 flex max-w-full items-center overflow-hidden whitespace-nowrap text-body-md text-on-surface-variant/60">
              {typed}
              {/* Some com o campo em foco, para não disputar com o cursor real */}
              {!focused && <span className="ia-cursor" />}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label={sending ? "Abrindo conversa" : "Enviar"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition-all enabled:hover:scale-105 disabled:bg-on-surface/[0.08] disabled:text-on-surface-variant/50"
        >
          <span className="material-symbols-outlined text-[20px]">{sending ? "more_horiz" : "arrow_upward"}</span>
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {suggestions.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => ask(s.prompt)}
            disabled={sending}
            style={{ animationDelay: `${120 + i * 60}ms` }}
            className="ia-block flex items-center gap-2 rounded-full border border-outline-variant/50 bg-surface/60 px-4 py-2 text-sm text-on-surface backdrop-blur-xl transition-colors hover:border-outline hover:bg-surface disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}
