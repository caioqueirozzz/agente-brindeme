"use client";

import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePortal } from "@/components/portal/Portal";
import { EmptyState } from "@/components/ui";
import { api, useApi } from "@/lib/client/api";
import { relativeTime } from "@/lib/types";

interface Conversation {
  id: string;
  title: string;
  last_message: string;
  updated_at: string;
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  /** Aviso local (ex.: IA sem chave) que não fica gravado */
  transient?: boolean;
}

const SUGGESTIONS = {
  ADMIN: [
    "Resumo da operação neste mês",
    "Quem do time está mais longe da meta?",
    "Leads quentes sem vendedor agora",
    "Quais ocasiões mais convertem?",
  ],
  COLABORADOR: [
    "Quem devo contatar primeiro hoje?",
    "Quais retornos estão atrasados?",
    "Como estou em relação à minha meta?",
    "Escreva um follow-up para meu lead mais quente",
  ],
};

/** **negrito** inline (o modelo às vezes usa mesmo instruído a não usar) */
function Inline({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i} className="font-semibold text-primary">{p}</strong> : p))}</>;
}

/** Texto simples da IA: linhas terminadas em ":" viram títulos, "- " vira lista */
function AssistantText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-on-surface">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        return (
          <div key={i} className="ia-block">
            {lines.map((line, j) => {
              const t = line.trim();
              if (!t) return null;
              if (t.startsWith("- ") || t.startsWith("* ")) {
                return (
                  <p key={j} className="flex gap-2 pl-1">
                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-on-surface/40" />
                    <span><Inline text={t.slice(2)} /></span>
                  </p>
                );
              }
              const clean = t.replace(/^#+\s*/, "");
              if (clean.replace(/\*\*/g, "").endsWith(":") && clean.length < 80) return <p key={j} className="mt-1 font-semibold text-primary">{clean.replace(/\*\*/g, "")}</p>;
              return <Fragment key={j}><p><Inline text={clean} /></p></Fragment>;
            })}
          </div>
        );
      })}
    </div>
  );
}

function IaContent() {
  const { me, base } = usePortal();
  const router = useRouter();
  const params = useSearchParams();
  const conversationId = params.get("c");
  const list = useApi<{ conversations: Conversation[] }>("/api/ia/conversations");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);
  // A conversa recém-criada já está na tela: não recarregar por cima
  const skipLoad = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    if (skipLoad.current === conversationId) return;
    api<{ messages: Msg[] }>(`/api/ia/conversations/${conversationId}`)
      .then((d) => setMessages(d.messages))
      .catch((err) => setError((err as Error).message));
  }, [conversationId]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages.length, sending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setInput("");
    setError(null);
    setSending(true);
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content, created_at: new Date().toISOString() }]);
    try {
      const res = await api<{ conversation: Conversation; reply: string; available: boolean; message: Msg | null }>("/api/ia/chat", {
        body: { message: content, conversation_id: conversationId },
      });
      setMessages((m) => [...m, res.message ?? { id: `aviso-${Date.now()}`, role: "assistant", content: res.reply, created_at: new Date().toISOString(), transient: true }]);
      if (res.conversation.id !== conversationId) {
        skipLoad.current = res.conversation.id;
        router.replace(`${base}/presentesia?c=${res.conversation.id}`, { scroll: false });
      }
      list.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  // Pergunta vinda da home (?q=)
  useEffect(() => {
    const q = params.get("q");
    if (q && !autoSent.current && !conversationId) {
      autoSent.current = true;
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(id: string) {
    if (!confirm("Apagar esta conversa?")) return;
    await api(`/api/ia/conversations/${id}`, { method: "DELETE" }).catch(() => {});
    list.reload();
    if (id === conversationId) router.replace(`${base}/presentesia`);
  }

  const conversations = list.data?.conversations ?? [];

  return (
    <div className="premium-card grid h-[calc(100vh-180px)] min-h-[560px] grid-cols-1 overflow-hidden rounded-3xl md:grid-cols-[280px_1fr]">
      <aside className="hidden min-h-0 flex-col border-r border-outline-variant/30 md:flex">
        <div className="p-4">
          <button
            onClick={() => {
              skipLoad.current = null;
              router.replace(`${base}/presentesia`);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-[13px] font-semibold text-on-primary hover:opacity-90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>Nova conversa
          </button>
        </div>
        <p className="px-5 pb-2 font-label-caps text-[10px] text-on-surface-variant">Suas conversas · privadas</p>
        <ul className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {conversations.map((c) => (
            <li key={c.id} className="group relative">
              <button
                onClick={() => {
                  skipLoad.current = null;
                  router.replace(`${base}/presentesia?c=${c.id}`);
                }}
                className={`w-full rounded-xl px-3 py-2.5 pr-9 text-left transition ${c.id === conversationId ? "bg-on-surface/[0.07]" : "hover:bg-on-surface/[0.04]"}`}
              >
                <p className="truncate text-[13px] font-semibold text-on-surface">{c.title}</p>
                <p className="truncate text-[11px] text-on-surface-variant">{relativeTime(c.updated_at)} · {c.last_message}</p>
              </button>
              <button onClick={() => remove(c.id)} aria-label="Apagar conversa" className="absolute right-2 top-3 hidden rounded-full p-1 text-on-surface-variant hover:text-red-600 group-hover:block">
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </li>
          ))}
          {list.data && conversations.length === 0 && <p className="px-3 py-6 text-center text-[12px] text-on-surface-variant">Nenhuma conversa ainda.</p>}
        </ul>
      </aside>

      <section className="flex min-h-0 flex-col">
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-8 md:px-12">
          {messages.length === 0 && !sending ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col justify-center">
              <span className="material-symbols-outlined mb-4 text-[40px] text-brand">auto_awesome</span>
              <h1 className="text-[32px] leading-tight tracking-tight text-primary">Como posso ajudar, {me.name.split(" ")[0]}?</h1>
              <p className="mt-2 text-[14px] text-on-surface-variant">
                {me.role === "ADMIN"
                  ? "Pergunte sobre a operação inteira: equipe, leads, funil, fila e resultados."
                  : "Pergunte sobre os seus leads, conversas, agenda e meta. Dados de outros colaboradores e da empresa não ficam disponíveis aqui."}
              </p>
              <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS[me.role].map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-2xl border border-outline-variant/50 px-4 py-3 text-left text-[13px] text-on-surface-variant transition hover:border-primary hover:text-primary">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-8">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <p className="max-w-[80%] whitespace-pre-wrap rounded-3xl rounded-br-md bg-on-surface/[0.07] px-5 py-3 text-[15px] text-on-surface">{m.content}</p>
                  </div>
                ) : (
                  <div key={m.id} className="flex gap-4">
                    <span className="material-symbols-outlined mt-0.5 shrink-0 text-[22px] text-brand">auto_awesome</span>
                    <div className={`min-w-0 flex-1 ${m.transient ? "opacity-70" : ""}`}>
                      <AssistantText text={m.content} />
                    </div>
                  </div>
                )
              )}
              {sending && (
                <div className="ia-status flex items-center gap-3 text-[14px] text-on-surface-variant">
                  <span className="material-symbols-outlined animate-pulse text-[22px] text-brand">auto_awesome</span>
                  Consultando seus dados…
                </div>
              )}
              {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-outline-variant/30 p-4"
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-3xl border border-outline-variant/50 bg-surface-container-lowest p-2 pl-5 focus-within:border-primary">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="Pergunte à PresentesIA…"
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[15px] text-on-surface outline-none placeholder:text-outline"
            />
            <button type="submit" disabled={!input.trim() || sending} aria-label="Enviar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition disabled:opacity-30">
              <span className="material-symbols-outlined">arrow_upward</span>
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-on-surface-variant">
            A PresentesIA responde com base nos dados que o seu perfil pode ver. Confira valores importantes no CRM.
          </p>
        </form>
      </section>
    </div>
  );
}

export function IaView() {
  return (
    <Suspense fallback={<EmptyState icon="auto_awesome" title="Carregando…" />}>
      <IaContent />
    </Suspense>
  );
}
