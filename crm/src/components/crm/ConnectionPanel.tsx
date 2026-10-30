"use client";

import { useEffect, useState } from "react";
import { Button, Card, ErrorNote } from "@/components/ui";
import { api, useApi } from "@/lib/client/api";
import { formatDateTime, formatPhone } from "@/lib/types";
import type { LiaMode, LiaModo } from "@/lib/whatsapp";

export interface WhatsAppStatus {
  ponte: "online" | "offline" | "erro";
  error?: string;
  estado: "INICIANDO" | "QR" | "AUTENTICANDO" | "CONECTADO" | "RECONECTANDO" | "DESVINCULADO" | null;
  qr: string | null;
  telefone: string | null;
  nome: string | null;
  conectadoEm: string | null;
  ultimoErro?: string | null;
}

/** Estado do número da loja, atualizado sozinho (mais rápido enquanto não conecta). */
export function useWhatsAppStatus() {
  const [fast, setFast] = useState(true);
  const status = useApi<WhatsAppStatus>("/api/whatsapp/status", fast ? 3_000 : 15_000);
  const connected = status.data?.estado === "CONECTADO";
  useEffect(() => {
    if (status.data) setFast(!connected);
  }, [connected, status.data]);
  return status;
}

/** Selo compacto para o cabeçalho do CRM */
export function ConnectionBadge({ status, onClick }: { status: WhatsAppStatus | null; onClick?: () => void }) {
  if (!status) return null;
  let dot = "bg-red-500";
  let label = "WhatsApp desconectado";
  if (status.ponte !== "online") label = "Ponte do WhatsApp fora do ar";
  else if (status.estado === "CONECTADO") {
    dot = "bg-green-500";
    label = `WhatsApp conectado${status.telefone ? ` · ${formatPhone(status.telefone)}` : ""}`;
  } else if (status.estado === "QR") {
    dot = "bg-amber-500 animate-pulse";
    label = "Aguardando leitura do QR";
  } else if (status.estado && status.estado !== "DESVINCULADO") {
    dot = "bg-amber-500 animate-pulse";
    label = "WhatsApp conectando…";
  }
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full border border-outline-variant/50 bg-surface/70 px-4 py-2 font-label-caps text-[10px] text-on-surface-variant backdrop-blur-xl ${onClick ? "transition hover:border-primary/40 hover:text-primary" : ""}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </Tag>
  );
}

const STEPS = [
  "Abra o WhatsApp no celular da loja",
  "Toque em ⋮ (Android) ou Configurações (iPhone) › Aparelhos conectados",
  "Toque em Conectar um aparelho e aponte a câmera para este QR",
];

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex h-[320px] w-[320px] max-w-full flex-col items-center justify-center gap-4 rounded-3xl bg-on-surface/[0.04]">
      <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-on-surface/15 border-t-primary" />
      <p className="text-[13px] text-on-surface-variant">{label}</p>
    </div>
  );
}

/**
 * Área do QR / check. O "gerar novo QR code" fica implícito: aparece por cima ao passar o mouse
 * (ou ao focar pelo teclado). No celular, o toque já dispara.
 */
function RelinkArea({ busy, onClick, children }: { busy: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Gerar novo QR code"
      className="group relative max-w-full rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {children}
      <span
        className={`absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl bg-surface/85 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 ${busy ? "opacity-100" : "opacity-0"}`}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg">
          <span className={`material-symbols-outlined text-[28px] ${busy ? "animate-spin" : ""}`}>{busy ? "progress_activity" : "qr_code_2"}</span>
        </span>
        <span className="font-label-caps text-[11px] text-primary">{busy ? "Gerando…" : "Gerar novo QR code"}</span>
      </span>
    </button>
  );
}

export function ConnectionPanel() {
  const { data: status, reload } = useWhatsAppStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function relink(confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/whatsapp/nova-vinculacao", { body: {} });
      setTimeout(reload, 1_500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <div className="h-[460px] animate-pulse rounded-3xl bg-on-surface/[0.04]" />;

  // Ponte desligada: o QR nasce no processo do agente
  if (status.ponte !== "online") {
    return (
      <Card className="p-8 md:p-12">
        <div className="mx-auto max-w-2xl text-center">
          <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-700">
            <span className="material-symbols-outlined text-[28px]">power_off</span>
          </span>
          <h2 className="font-headline-md text-primary">A ponte do WhatsApp não está rodando</h2>
          <p className="mt-2 text-[14px] text-on-surface-variant">
            É ela que gera o QR, mantém o número da loja conectado e passa as mensagens para a Lia e para o CRM. Ligue o agente no servidor da loja:
          </p>
          <pre className="mx-auto mt-6 w-fit rounded-2xl bg-surface-container px-6 py-4 text-left font-mono text-[13px] text-on-surface">npm run whatsapp</pre>
          <p className="mt-4 text-[12px] text-on-surface-variant">
            {status.ponte === "erro" ? status.error : "Esta tela atualiza sozinha assim que a ponte responder."}
          </p>
        </div>
      </Card>
    );
  }

  const connected = status.estado === "CONECTADO";

  return (
    <div className="space-y-6">
      <ErrorNote message={error ?? status.ultimoErro ?? null} />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_400px]">
          <div className="flex flex-col justify-center p-8 md:p-12">
            <p className="mb-3 font-label-caps text-[11px] text-on-surface-variant">Conexão com o agente Lia</p>
            {connected ? (
              <>
                <h2 className="text-[30px] leading-tight tracking-tight text-primary">WhatsApp da loja conectado</h2>
                <p className="mt-3 text-[15px] text-on-surface-variant">
                  As mensagens dos clientes chegam aqui no CRM em tempo real. A Lia responde primeiro; quando alguém da equipe escreve (pelo celular ou pelo CRM), ela pausa naquela conversa.
                </p>
                <dl className="mt-8 grid grid-cols-2 gap-6">
                  <div>
                    <dt className="font-label-caps text-[10px] text-on-surface-variant">Número</dt>
                    <dd className="mt-1 text-[18px] font-semibold text-primary">{formatPhone(status.telefone)}</dd>
                  </div>
                  <div>
                    <dt className="font-label-caps text-[10px] text-on-surface-variant">Perfil</dt>
                    <dd className="mt-1 text-[18px] font-semibold text-primary">{status.nome ?? "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="font-label-caps text-[10px] text-on-surface-variant">Conectado desde</dt>
                    <dd className="mt-1 text-[14px] text-on-surface">{formatDateTime(status.conectadoEm)}</dd>
                  </div>
                </dl>
                <p className="mt-8 flex items-center gap-2 text-[12px] text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px]">info</span>
                  Para trocar de número, passe o mouse sobre o check e gere um novo QR code.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-[30px] leading-tight tracking-tight text-primary">Vincule o WhatsApp da loja</h2>
                <p className="mt-3 text-[15px] text-on-surface-variant">
                  Leia o QR com o celular do número da loja. A Lia passa a atender por ele e todas as conversas aparecem aqui no CRM.
                </p>
                <ol className="mt-8 space-y-4">
                  {STEPS.map((step, i) => (
                    <li key={step} className="flex items-start gap-4">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-on-primary">{i + 1}</span>
                      <span className="pt-0.5 text-[14px] text-on-surface">{step}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>

          <div className="relative flex items-center justify-center border-t border-outline-variant/30 bg-on-surface/[0.02] p-8 pb-14 md:border-l md:border-t-0">
            {status.estado === "AUTENTICANDO" ? (
              <Spinner label="QR lido! Sincronizando as conversas…" />
            ) : connected || status.estado === "DESVINCULADO" || (status.estado === "QR" && status.qr) ? (
              <RelinkArea
                busy={busy}
                onClick={() =>
                  relink(
                    connected
                      ? "Desconectar este número e gerar um QR para conectar outro? A Lia para de responder até o novo número ser lido."
                      : undefined
                  )
                }
              >
                {connected ? (
                  <div className="flex h-[320px] w-[320px] max-w-full flex-col items-center justify-center gap-4 rounded-3xl bg-green-50">
                    <span className="ia-block flex h-20 w-20 items-center justify-center rounded-full bg-green-500 text-white shadow-lg">
                      <span className="material-symbols-outlined text-[44px]">check</span>
                    </span>
                    <span className="text-[14px] font-semibold text-green-700">Recebendo mensagens</span>
                  </div>
                ) : status.estado === "DESVINCULADO" ? (
                  <div className="flex h-[320px] w-[320px] max-w-full flex-col items-center justify-center gap-3 rounded-3xl bg-on-surface/[0.04] p-6 text-center">
                    <span className="material-symbols-outlined text-[40px] text-on-surface-variant/50">link_off</span>
                    <span className="text-[13px] text-on-surface-variant">O número foi desconectado. Passe o mouse aqui para gerar um novo QR code.</span>
                  </div>
                ) : (
                  <div className="ia-block rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                    <img src={status.qr!} alt="QR code para conectar o WhatsApp" className="h-[288px] w-[288px]" />
                  </div>
                )}
              </RelinkArea>
            ) : (
              <Spinner label={status.estado === "RECONECTANDO" ? "Reconectando…" : "Abrindo o WhatsApp Web…"} />
            )}
            {status.estado === "QR" && status.qr && (
              <p className="absolute bottom-6 flex items-center justify-center gap-2 text-[12px] text-on-surface-variant">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />O QR se renova sozinho a cada ~20 s
              </p>
            )}
          </div>
        </div>
      </Card>

      <LiaModeCard />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {[
          { icon: "smart_toy", title: "A Lia atende primeiro", text: "Ela responde, entende a ocasião, a quantidade e o prazo, e monta a estimativa do pedido." },
          { icon: "support_agent", title: "A equipe assume quando quer", text: "Responder pelo CRM ou pelo celular pausa a Lia naquela conversa. Um clique devolve para ela." },
          { icon: "lock", title: "Cada um vê o que é seu", text: "O colaborador só vê e responde as conversas dos leads atribuídos a ele." },
        ].map((c) => (
          <Card key={c.title} className="p-6">
            <span className="material-symbols-outlined mb-3 text-brand">{c.icon}</span>
            <h3 className="text-[15px] font-semibold text-on-surface">{c.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-on-surface-variant">{c.text}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

const LIA_MODES: { value: LiaModo; icon: string; title: string; text: string }[] = [
  { value: "ligada", icon: "smart_toy", title: "Ligada", text: "Responde todo cliente que escrever no número da loja." },
  { value: "teste", icon: "science", title: "Modo teste", text: "Responde só os números de teste. Os demais ficam com a equipe." },
  { value: "desligada", icon: "power_settings_new", title: "Desligada", text: "Ninguém é respondido pela IA. As mensagens seguem chegando ao CRM." },
];

/** Liga, desliga ou põe a Lia em teste. Passa a valer na próxima mensagem, sem reiniciar nada. */
function LiaModeCard() {
  const { data, error: loadError, setData } = useApi<LiaMode>("/api/whatsapp/lia");
  const [draft, setDraft] = useState<{ modo: LiaModo; numeros: string[] } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!data) {
    if (loadError) return <ErrorNote message={`Modo da Lia indisponível: ${loadError}`} />;
    return <div className="h-[220px] animate-pulse rounded-2xl bg-on-surface/[0.04]" />;
  }

  const current = draft ?? { modo: data.modo, numeros: data.numerosTeste };
  const dirty = current.modo !== data.modo || current.numeros.join() !== data.numerosTeste.join();
  const edit = (next: Partial<{ modo: LiaModo; numeros: string[] }>) => {
    setDraft({ ...current, ...next });
    setSaved(false);
    setError(null);
  };

  function addNumber() {
    const digits = input.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) return setError("Digite o número com DDD, ex.: (83) 99999-0000.");
    const numero = digits.length <= 11 ? `55${digits}` : digits;
    if (!current.numeros.includes(numero)) edit({ numeros: [...current.numeros, numero] });
    setInput("");
  }

  async function save() {
    if (current.modo === "desligada" && data!.modo !== "desligada" && !confirm("Desligar a Lia? Nenhum cliente será respondido pela IA até você religar.")) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<LiaMode>("/api/whatsapp/lia", { body: { modo: current.modo, numerosTeste: current.numeros } });
      setData(result);
      setDraft(null);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 md:p-8">
      <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
        <div>
          <p className="font-label-caps text-[11px] text-on-surface-variant">Atendimento da Lia</p>
          <h3 className="mt-1 text-[20px] font-semibold tracking-tight text-primary">Como a Lia deve atender agora?</h3>
        </div>
        {data.atualizadoEm && <p className="text-[12px] text-on-surface-variant">Alterado em {formatDateTime(data.atualizadoEm)}</p>}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3" role="radiogroup" aria-label="Modo da Lia">
        {LIA_MODES.map((m) => {
          const active = current.modo === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => edit({ modo: m.value })}
              className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
                active ? "border-primary bg-primary/[0.04] ring-1 ring-primary" : "border-outline-variant/50 hover:border-primary/40"
              }`}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? "bg-primary text-on-primary" : "bg-on-surface/[0.06] text-on-surface"}`}>
                <span className="material-symbols-outlined text-[22px]">{m.icon}</span>
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[14px] font-semibold text-on-surface">
                  {m.title}
                  {data.modo === m.value && <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">ativo</span>}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-on-surface-variant">{m.text}</span>
              </span>
            </button>
          );
        })}
      </div>

      {current.modo === "teste" && (
        <div className="mt-6 rounded-2xl bg-on-surface/[0.03] p-4">
          <p className="text-[13px] font-semibold text-on-surface">Números de teste</p>
          <p className="text-[12px] text-on-surface-variant">Só estes números são respondidos pela Lia enquanto o modo teste estiver ativo.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {current.numeros.map((n) => (
              <span key={n} className="flex items-center gap-1 rounded-full border border-outline-variant/60 bg-surface py-1 pl-3 pr-1 text-[13px] text-on-surface">
                {formatPhone(n)}
                <button
                  type="button"
                  onClick={() => edit({ numeros: current.numeros.filter((x) => x !== n) })}
                  aria-label={`Remover ${formatPhone(n)}`}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/[0.08] hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </span>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addNumber();
              }}
              className="flex items-center gap-1 rounded-full border border-dashed border-outline-variant/70 bg-surface pl-3 pr-1"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="(83) 99999-0000"
                inputMode="tel"
                className="h-8 w-36 bg-transparent text-[13px] outline-none placeholder:text-outline"
              />
              <button type="submit" aria-label="Adicionar número" className="flex h-6 w-6 items-center justify-center rounded-full text-primary hover:bg-on-surface/[0.08]">
                <span className="material-symbols-outlined text-[18px]">add</span>
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <ErrorNote message={error} />
        {saved && !dirty && <span className="text-[12px] text-green-700">Salvo. Vale a partir da próxima mensagem.</span>}
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Descartar
          </Button>
        )}
        <Button icon="check" loading={busy} disabled={!dirty || (current.modo === "teste" && current.numeros.length === 0)} onClick={save}>
          Salvar
        </Button>
      </div>
    </Card>
  );
}
