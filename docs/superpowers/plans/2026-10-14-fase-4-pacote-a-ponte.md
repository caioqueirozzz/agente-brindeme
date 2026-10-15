# Fase 4 — Pacote A (ponte do WhatsApp) — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans para executar este plano task a task. Os passos usam checkbox (`- [ ]`).

**Objetivo:** Ligar o agente ao WhatsApp por whatsapp-web.js — ponte, fila, agrupamento, atendente pelo próprio chip —
rodando contra um dublê do agente, sem depender da API definitiva (Pacote B, do Gui).

**Arquitetura:** Dois processos. A ponte (`src/whatsapp/`) fala com o WhatsApp através da interface `CanalWhatsApp` e com o
agente por HTTP local (`src/contrato/`). Neste pacote o agente é um dublê (`src/duble/`): `eco` para testes e `direto`
(chama o `runTurn` real com estado em memória) para o primeiro teste no chip. O Pacote B troca o dublê pela API
definitiva implementando a mesma interface `Agente`.

**Stack:** Node ≥ 20 (a máquina tem 24), TypeScript ESM (`tsx`), vitest 2, zod 3, `whatsapp-web.js@1.34.7`,
`qrcode-terminal@0.12.0`.

**Spec:** `docs/superpowers/specs/2026-10-14-fase-4-whatsapp-design.md` (leia antes de começar).

## Para quem chega sem contexto

- **Repo:** `C:\Users\joao_\dev\DC Tech\Presentes Especiais\repo-agente-brindeme` (GitHub `caioqueirozzz/agente-brindeme`).
- **Branch:** `fase-4-integracao-whatsapp` (já existe, criada sobre `fase-3-conhecimento-recomendacao` = PR #3, que está
  sobre o PR #1). Trabalhe nela; não troque de branch e não faça rebase.
- **Antes da Task A1:** `npm test` deve dar 347 testes verdes e `npm run typecheck` limpo. Se não der, pare e avise.
- **Estado do agente hoje:** `src/agent/runTurn.ts` roda um turno (mensagem → Claude → ferramentas → resposta) sobre um
  `ConversationState` (`src/agent/state.ts`). O CLI (`src/cli.ts`, `npm run chat`) é o único canal que existe.
- **Shell:** Git Bash no Windows. Use barras normais nos caminhos.

## Restrições globais

- Nunca `git push`, nunca abrir PR. Commit local ao fim de cada task.
- Nunca commitar `.env`, `data/` ou `logs/` (já estão no `.gitignore`). Credenciais da loja nunca vão para arquivo versionado.
- `package-lock.json` só entra no commit da Task A12 (instalação das dependências novas).
- Código, nomes e mensagens em português, como o resto do repo. Imports relativos terminam em `.js`.
- Comentário só para armadilha que faria alguém quebrar algo (uma ou duas linhas). Nada de comentário narrando o código;
  o porquê vai na mensagem de commit.
- `whatsapp-web.js` exatamente `1.34.7` (`--save-exact`). Toda chamada `sendMessage` com `{ sendSeen: false }` — o padrão
  da biblioteca marca a conversa como lida a cada envio.
- Números padrão (vêm do `.env`, com estes defaults): lote fecha com 5s de silêncio, 30s desde a primeira ou 10
  mensagens; texto cortado em 4.000 caracteres; 409 repetido a cada 5s por até 120s; chamada ao agente desiste em 120s;
  aviso de instabilidade após 10 min; 20 envios por minuto no número; "digitando…" até 4s; varredura a cada 2 min.
- Ao fim de cada task: `npm test` e `npm run typecheck` verdes (os 347 antigos + os novos).
- Mensagem de commit no formato `feat(fase-4): …` ou `test(fase-4): …`; acrescente o trailer de atribuição que a sua
  ferramenta exigir.

## Ajustes em relação à spec (decididos neste plano)

1. **Escrita simulada vem para o Pacote A** (Task A4): o primeiro teste no chip já lê a API real, e nenhum orçamento pode
   ser gravado na loja antes disso.
2. **O servidor HTTP do contrato é compartilhado** (`src/contrato/servidorHttp.ts`): a API definitiva do Gui só implementa a
   interface `Agente`. O teste de contrato roda a mesma bateria nos dois.
3. **A varredura pega as mensagens não lidas do cliente**, não "conversas cuja última mensagem é do cliente": depois do
   aviso de instabilidade, a última mensagem da conversa é nossa e a conversa sumiria da varredura.
4. **Evento do atendente que falha fica pendente** e é reenviado, na ordem, antes do próximo lote. Enquanto houver
   pendente, nenhum lote vai ao agente (senão a IA responderia uma conversa que o atendente assumiu).
5. **`#devolver` pede o número sem espaços**, com DDI; o 9º dígito é corrigido. Número inválido → lista de comandos.
6. **Chave extra `WHATSAPP_WEB_VERSAO`**: a troca de versão alterna entre ela e a mais recente.

## Foco de revisão

Entradas que a spec implica e que mais podem morder quem usa — cada uma tem teste na task dona do código:

1. Cliente manda texto e, logo depois, um áudio: o áudio não pode marcar como lida a conversa com lote pendente
   (Task A11, teste "áudio com lote pendente não marca como lida").
2. Texto acima de 4.000 caracteres e arte recusada com legenda longa: o lote sai cortado e nunca vira 400 no agente
   (Task A11, testes "texto longo é cortado" e "recusa com legenda longa").
3. `#devolver` com número sem DDI, sem o 9 ou com espaço: corrige o 9; o resto responde a lista de comandos e nunca
   devolve a conversa errada (Task A10).
4. Atendente responde pelo celular com o agente fora: o evento fica pendente e o lote seguinte não vai ao agente antes
   dele (Task A11, teste "evento pendente segura o lote").
5. A mesma mensagem chega pelo evento ao vivo e pela varredura: um lote só (Task A11, teste "evento e varredura não
   duplicam").

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/config.ts` (modifica) | Chaves novas de `agente`, `whatsapp` e `brindeMe.escritaOrcamento` |
| `src/contrato/esquemas.ts` | Schemas zod e tipos do contrato; `LIMITE_TEXTO`, `MAX_MENSAGENS_LOTE` |
| `src/contrato/turno.ts` | `calcularTurnoId(ids)` |
| `src/contrato/texto.ts` | `loteParaTexto`, `formatarParaWhatsApp`, `MAX_PARTES` |
| `src/contrato/agente.ts` | Interface `Agente` e `TurnoEmAndamentoError` |
| `src/contrato/servidorHttp.ts` | `criarServidorAgente(agente)`: rotas, validação e códigos HTTP |
| `src/duble/eco.ts` | `AgenteEco` (testes) |
| `src/duble/direto.ts` | `AgenteDireto` (runTurn real, estado em memória) |
| `src/duble/index.ts` | Entrada `npm run agente:duble -- --modo eco\|direto` |
| `src/partida.ts` | `avisarConhecimentoECatalogo` (sai do `cli.ts`) |
| `src/integrations/brindeme/escritaSimulada.ts` | `EscritaSimuladaClient`: orçamento TESTE sem POST |
| `src/integrations/brindeme/factory.ts` (modifica) | Embrulha o cliente http na escrita simulada |
| `src/whatsapp/canal.ts` | Interface `CanalWhatsApp` e tipos de mensagem |
| `src/whatsapp/telefone.ts` | `normalizarTelefone`, `ehConversaDireta` |
| `src/whatsapp/log.ts` | `LogPonte` e `criarLogPonte` (`logs/ponte.jsonl`) |
| `src/whatsapp/agenteHttp.ts` | `ClienteAgente` por HTTP: ok / em_andamento / falha |
| `src/whatsapp/midia.ts` | `salvarMidia` |
| `src/whatsapp/fila.ts` | `FilaConversas` (agrupamento, um turno por conversa) e `ConjuntoLimitado` |
| `src/whatsapp/envio.ts` | `Envio` (limitador, digitando, registro de saída, nova tentativa) |
| `src/whatsapp/atendente.ts` | `interpretarComando`, `TEXTO_COMANDOS`, `Atendimento` |
| `src/whatsapp/ponte.ts` | `Ponte`: recepção, lote, entrega, queda do agente, varredura |
| `src/whatsapp/saude.ts` | `decidirSaude`, `tipoDaMensagem` (puros, testáveis) |
| `src/whatsapp/sessao.ts` | `CanalWwebjs`: adaptador whatsapp-web.js com as defesas do LembreMe |
| `src/whatsapp/index.ts` | Entrada da ponte |
| `scripts/whatsapp.ts` | Lançador: sobe agente (dublê ou API) e ponte |
| `tests/helpers/bateriaContrato.ts` | Bateria de contrato reaproveitada pelo Pacote B |
| `tests/helpers/llmRoteirizado.ts` | `ScriptedLLM`, `toolUse`, `endTurn` |
| `tests/helpers/whatsappFalso.ts` | `WhatsAppFalso` (implementa `CanalWhatsApp`) |
| `tests/helpers/agenteFalso.ts` | `AgenteFalso` (implementa `ClienteAgente`) |

---

### Task 1 (A1): Configuração e contrato

**Arquivos:**
- Modificar: `src/config.ts`
- Criar: `src/contrato/esquemas.ts`, `src/contrato/turno.ts`, `src/contrato/texto.ts`, `src/contrato/agente.ts`
- Teste: `tests/contratoAgente.test.ts`

**Interfaces:**
- Produz: tipos `Arquivo`, `MensagemLote`, `PedidoMensagens`, `Modo`, `RespostaMensagens`, `Evento`, `RespostaEvento`;
  schemas `pedidoMensagensSchema`, `respostaMensagensSchema`, `eventoSchema`, `respostaEventoSchema`; constantes
  `LIMITE_TEXTO = 4000`, `MAX_MENSAGENS_LOTE = 10`; `calcularTurnoId(ids: string[]): string`;
  `loteParaTexto(m: MensagemLote[]): string`; `formatarParaWhatsApp(texto: string): string[]`; `MAX_PARTES = 4`;
  `interface Agente { processarLote(p: PedidoMensagens): Promise<RespostaMensagens>; processarEvento(e: Evento): Promise<RespostaEvento> }`;
  `class TurnoEmAndamentoError`; `config.agente.{porta,url}`, `config.whatsapp.*`, `config.brindeMe.escritaOrcamento`.

- [ ] **Passo 1: Escrever o teste que falha** — `tests/contratoAgente.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { eventoSchema, pedidoMensagensSchema, LIMITE_TEXTO } from "../src/contrato/esquemas.js";
import { calcularTurnoId } from "../src/contrato/turno.js";
import { formatarParaWhatsApp, loteParaTexto, MAX_PARTES } from "../src/contrato/texto.js";

const T = "2026-10-14T12:00:00.000Z";

describe("esquemas do contrato", () => {
  const valido = {
    turnoId: "0123456789abcdef",
    telefone: "5583999990000",
    mensagens: [{ id: "a", timestamp: T, texto: "oi" }],
  };

  it("aceita um pedido válido", () => {
    expect(pedidoMensagensSchema.parse(valido)).toEqual(valido);
  });

  it("recusa telefone com símbolos", () => {
    expect(() => pedidoMensagensSchema.parse({ ...valido, telefone: "+55 83 99999-0000" })).toThrow();
  });

  it("recusa lote vazio e lote com mais de 10 mensagens", () => {
    expect(() => pedidoMensagensSchema.parse({ ...valido, mensagens: [] })).toThrow();
    const onze = Array.from({ length: 11 }, (_, i) => ({ id: `m${i}`, timestamp: T, texto: "x" }));
    expect(() => pedidoMensagensSchema.parse({ ...valido, mensagens: onze })).toThrow();
  });

  it("recusa texto acima do limite", () => {
    const longo = [{ id: "a", timestamp: T, texto: "x".repeat(LIMITE_TEXTO + 1) }];
    expect(() => pedidoMensagensSchema.parse({ ...valido, mensagens: longo })).toThrow();
  });

  it("recusa turnoId fora do formato", () => {
    expect(() => pedidoMensagensSchema.parse({ ...valido, turnoId: "abc" })).toThrow();
  });

  it("aceita os dois eventos e recusa tipo desconhecido", () => {
    expect(eventoSchema.parse({ tipo: "devolver", telefone: "5583999990000" })).toEqual({
      tipo: "devolver",
      telefone: "5583999990000",
    });
    const atendente = { tipo: "mensagem_atendente", telefone: "5583999990000", id: "x", texto: "oi", timestamp: T };
    expect(eventoSchema.parse(atendente).tipo).toBe("mensagem_atendente");
    expect(() => eventoSchema.parse({ tipo: "apagar", telefone: "5583999990000" })).toThrow();
  });
});

describe("calcularTurnoId", () => {
  it("é determinístico e tem 16 caracteres hex", () => {
    const id = calcularTurnoId(["a", "b"]);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(calcularTurnoId(["a", "b"])).toBe(id);
  });

  it("muda com a ordem e com os ids", () => {
    expect(calcularTurnoId(["b", "a"])).not.toBe(calcularTurnoId(["a", "b"]));
    expect(calcularTurnoId(["a"])).not.toBe(calcularTurnoId(["a", "b"]));
  });
});

describe("loteParaTexto", () => {
  it("junta as mensagens uma por linha", () => {
    const lote = [
      { id: "1", timestamp: T, texto: "oi" },
      { id: "2", timestamp: T, texto: " quero canecas " },
    ];
    expect(loteParaTexto(lote)).toBe("oi\nquero canecas");
  });

  it("descreve o arquivo antes da legenda", () => {
    const arquivo = { caminho: "data/artes/x.png", mime: "image/png", bytes: 2_048, nome: "logo.png" };
    expect(loteParaTexto([{ id: "1", timestamp: T, texto: "essa é a logo", arquivo }])).toBe(
      "[ARQUIVO recebido: logo.png (image/png, 2 KB)]\nessa é a logo"
    );
  });

  it("arquivo pequeno aparece com 1 KB", () => {
    const arquivo = { caminho: "x.pdf", mime: "application/pdf", bytes: 100, nome: "arte.pdf" };
    expect(loteParaTexto([{ id: "1", timestamp: T, texto: "", arquivo }])).toBe(
      "[ARQUIVO recebido: arte.pdf (application/pdf, 1 KB)]"
    );
  });
});

describe("formatarParaWhatsApp", () => {
  it("troca o negrito do markdown pelo do WhatsApp", () => {
    expect(formatarParaWhatsApp("Total: **R$ 10,00**")).toEqual(["Total: *R$ 10,00*"]);
  });

  it("título vira negrito, sem asterisco dobrado", () => {
    expect(formatarParaWhatsApp("## Resumo\nItem 1")).toEqual(["*Resumo*\nItem 1"]);
    expect(formatarParaWhatsApp("### **Resumo**")).toEqual(["*Resumo*"]);
  });

  it("quebra nos parágrafos", () => {
    expect(formatarParaWhatsApp("a\n\nb\n  \nc")).toEqual(["a", "b", "c"]);
  });

  it(`junta o excedente na última das ${MAX_PARTES} partes`, () => {
    expect(formatarParaWhatsApp("a\n\nb\n\nc\n\nd\n\ne\n\nf")).toEqual(["a", "b", "c", "d\n\ne\n\nf"]);
  });

  it("texto vazio não gera parte", () => {
    expect(formatarParaWhatsApp("  ")).toEqual([]);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/contratoAgente.test.ts`
Esperado: FAIL — `Failed to resolve import "../src/contrato/esquemas.js"`.

- [ ] **Passo 3: Implementar**

`src/contrato/esquemas.ts`:

```ts
import { z } from "zod";

export const LIMITE_TEXTO = 4_000;
export const MAX_MENSAGENS_LOTE = 10;

const telefone = z.string().regex(/^\d{10,15}$/, "telefone só com dígitos, com DDI");
const timestamp = z.string().datetime();

export const arquivoSchema = z.object({
  caminho: z.string().min(1),
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  nome: z.string().min(1),
});

export const mensagemLoteSchema = z.object({
  id: z.string().min(1),
  timestamp,
  texto: z.string().max(LIMITE_TEXTO),
  arquivo: arquivoSchema.optional(),
});

export const pedidoMensagensSchema = z.object({
  turnoId: z.string().regex(/^[0-9a-f]{16}$/),
  telefone,
  mensagens: z.array(mensagemLoteSchema).min(1).max(MAX_MENSAGENS_LOTE),
});

export const modoSchema = z.enum(["ia", "humano"]);

export const respostaMensagensSchema = z.object({
  respostas: z.array(z.string()),
  avisoAtendente: z.string().optional(),
  modo: modoSchema,
});

export const eventoSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("mensagem_atendente"),
    telefone,
    id: z.string().min(1),
    texto: z.string(),
    timestamp,
  }),
  z.object({
    tipo: z.literal("devolver"),
    telefone,
    nota: z.string().max(500).optional(),
  }),
]);

export const respostaEventoSchema = z.object({ modo: modoSchema });

export type Arquivo = z.infer<typeof arquivoSchema>;
export type MensagemLote = z.infer<typeof mensagemLoteSchema>;
export type PedidoMensagens = z.infer<typeof pedidoMensagensSchema>;
export type Modo = z.infer<typeof modoSchema>;
export type RespostaMensagens = z.infer<typeof respostaMensagensSchema>;
export type Evento = z.infer<typeof eventoSchema>;
export type RespostaEvento = z.infer<typeof respostaEventoSchema>;
```

`src/contrato/turno.ts`:

```ts
import { createHash } from "crypto";

export function calcularTurnoId(ids: string[]): string {
  return createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16);
}
```

`src/contrato/texto.ts`:

```ts
import type { MensagemLote } from "./esquemas.js";

export const MAX_PARTES = 4;

export function loteParaTexto(mensagens: MensagemLote[]): string {
  return mensagens
    .map((m) => {
      const linhas: string[] = [];
      if (m.arquivo) {
        const kb = Math.max(1, Math.round(m.arquivo.bytes / 1024));
        linhas.push(`[ARQUIVO recebido: ${m.arquivo.nome} (${m.arquivo.mime}, ${kb} KB)]`);
      }
      if (m.texto.trim()) linhas.push(m.texto.trim());
      return linhas.join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

export function formatarParaWhatsApp(texto: string): string[] {
  const convertido = texto
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6}[ \t]+(.+)$/gm, (_, titulo: string) => `*${titulo.replace(/\*/g, "")}*`);
  const paragrafos = convertido
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragrafos.length <= MAX_PARTES) return paragrafos;
  return [...paragrafos.slice(0, MAX_PARTES - 1), paragrafos.slice(MAX_PARTES - 1).join("\n\n")];
}
```

`src/contrato/agente.ts`:

```ts
import type { Evento, PedidoMensagens, RespostaEvento, RespostaMensagens } from "./esquemas.js";

export class TurnoEmAndamentoError extends Error {
  constructor() {
    super("turno em andamento nesta conversa");
    this.name = "TurnoEmAndamentoError";
  }
}

export interface Agente {
  processarLote(pedido: PedidoMensagens): Promise<RespostaMensagens>;
  processarEvento(evento: Evento): Promise<RespostaEvento>;
}
```

`src/config.ts` — três mudanças:

1. Logo depois da função `int`, acrescente:

```ts
function digitos(lista: string | undefined): string[] {
  return (lista ?? "")
    .split(",")
    .map((s) => s.replace(/\D/g, ""))
    .filter(Boolean);
}
```

2. Dentro de `brindeMe`, depois de `maxRetries: int(process.env.BRINDEME_MAX_RETRIES, 2),`, acrescente:

```ts
    /** "simulada" devolve orçamento TESTE sem POST na loja; só "real" grava de verdade (vale com BRINDEME_MODE=http). */
    escritaOrcamento: (process.env.ORCAMENTO_ESCRITA === "real" ? "real" : "simulada") as "real" | "simulada",
```

3. Depois do bloco `catalogo: { … },` (antes do `};` final), acrescente:

```ts
  agente: {
    porta: int(process.env.AGENTE_PORTA, 3030),
    url: (process.env.AGENTE_URL ?? "http://127.0.0.1:3030").replace(/\/+$/, ""),
  },

  whatsapp: {
    sessaoDir: process.env.WHATSAPP_SESSAO_DIR ?? "data/whatsapp-sessao",
    parearTelefone: (process.env.WHATSAPP_PAREAR_TELEFONE ?? "").replace(/\D/g, ""),
    versaoWeb: process.env.WHATSAPP_WEB_VERSAO ?? "",
    liberados: digitos(process.env.WHATSAPP_LIBERADOS),
    artesDir: process.env.ARTES_DIR ?? "data/artes",
    loteSilencioMs: int(process.env.LOTE_SILENCIO_MS, 5_000),
    loteMaxMs: int(process.env.LOTE_MAX_MS, 30_000),
    /** O contrato aceita no máximo 10 mensagens por lote. */
    loteMaxMensagens: Math.min(10, int(process.env.LOTE_MAX_MENSAGENS, 10)),
    agenteTimeoutMs: int(process.env.AGENTE_TIMEOUT_MS, 120_000),
    avisoInstabilidadeMin: int(process.env.AVISO_INSTABILIDADE_MIN, 10),
    enviosPorMinuto: int(process.env.ENVIOS_POR_MINUTO, 20),
    varreduraMs: int(process.env.VARREDURA_MS, 120_000),
  },
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/contratoAgente.test.ts` → Esperado: PASS (16 testes).
Rode: `npm test && npm run typecheck` → Esperado: tudo verde.

- [ ] **Passo 5: Commit**

```bash
git add src/config.ts src/contrato tests/contratoAgente.test.ts
git commit -m "feat(fase-4): contrato ponte–agente (esquemas, turnoId, texto) e chaves de configuração"
```

---

### Task 2 (A2): Servidor HTTP do contrato, dublê `eco` e bateria de contrato

**Arquivos:**
- Criar: `src/contrato/servidorHttp.ts`, `src/duble/eco.ts`, `tests/helpers/bateriaContrato.ts`
- Teste: `tests/servidorAgente.test.ts`

**Interfaces:**
- Consome: `Agente`, `TurnoEmAndamentoError`, schemas (Task A1).
- Produz: `criarServidorAgente(agente: Agente, log?: (e: Record<string, unknown>) => void): http.Server`;
  `class AgenteEco implements Agente` com `constructor(opcoes?: { atrasoMs?: number })`;
  `bateriaContrato(nome, criar: (o: { atrasoMs: number }) => Agente | Promise<Agente>): void`;
  `pedido(telefone, ids, texto?): PedidoMensagens`; `subirServidor(agente): Promise<{ servidor; base }>`;
  `derrubarServidor(servidor): Promise<void>`.
- Códigos HTTP: 200 resposta · 400 `{ status: "invalido", erro }` · 404 `{ status: "nao_encontrado" }` ·
  409 `{ status: "em_andamento" }` · 503 `{ status: "falha_temporaria" }`.

- [ ] **Passo 1: Escrever a bateria e o teste que falha**

`tests/helpers/bateriaContrato.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { criarServidorAgente } from "../../src/contrato/servidorHttp.js";
import type { Agente } from "../../src/contrato/agente.js";
import { calcularTurnoId } from "../../src/contrato/turno.js";
import {
  respostaEventoSchema,
  respostaMensagensSchema,
  type PedidoMensagens,
} from "../../src/contrato/esquemas.js";

const T = "2026-10-14T12:00:00.000Z";

export function pedido(telefone: string, ids: string[], texto = "oi"): PedidoMensagens {
  return {
    turnoId: calcularTurnoId(ids),
    telefone,
    mensagens: ids.map((id) => ({ id, timestamp: T, texto })),
  };
}

export async function subirServidor(agente: Agente): Promise<{ servidor: Server; base: string }> {
  const servidor = criarServidorAgente(agente);
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address() as AddressInfo;
  return { servidor, base: `http://127.0.0.1:${port}` };
}

export async function derrubarServidor(servidor: Server): Promise<void> {
  servidor.closeAllConnections();
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
}

export function bateriaContrato(
  nome: string,
  criar: (opcoes: { atrasoMs: number }) => Agente | Promise<Agente>
): void {
  describe(`contrato do agente — ${nome}`, () => {
    let servidor: Server | undefined;
    let base = "";

    async function subir(atrasoMs = 0) {
      ({ servidor, base } = await subirServidor(await criar({ atrasoMs })));
    }

    function post(rota: string, corpo: unknown) {
      return fetch(`${base}${rota}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
    }

    afterEach(async () => {
      if (servidor) await derrubarServidor(servidor);
      servidor = undefined;
    });

    it("GET /api/health → 200", async () => {
      await subir();
      const r = await fetch(`${base}/api/health`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
    });

    it("lote novo → 200 com respostas e modo ia", async () => {
      await subir();
      const r = await post("/api/mensagens", pedido("5583999990000", ["c1"]));
      expect(r.status).toBe(200);
      const corpo = respostaMensagensSchema.parse(await r.json());
      expect(corpo.modo).toBe("ia");
      expect(corpo.respostas.length).toBeGreaterThan(0);
    });

    it("mesmo turnoId → a mesma resposta", async () => {
      await subir();
      const p = pedido("5583999990000", ["c2"]);
      const a = await (await post("/api/mensagens", p)).json();
      const b = await (await post("/api/mensagens", p)).json();
      expect(b).toEqual(a);
    });

    it("corpo fora do contrato → 400", async () => {
      await subir();
      const r = await post("/api/mensagens", { telefone: "+55 83", mensagens: [] });
      expect(r.status).toBe(400);
    });

    it("outro lote da mesma conversa com turno em andamento → 409", async () => {
      await subir(300);
      const primeiro = post("/api/mensagens", pedido("5583999990000", ["c3"]));
      await new Promise((r) => setTimeout(r, 50));
      const segundo = await post("/api/mensagens", pedido("5583999990000", ["c4"]));
      expect(segundo.status).toBe(409);
      expect(await segundo.json()).toEqual({ status: "em_andamento" });
      expect((await primeiro).status).toBe(200);
    });

    it("mensagem_atendente → humano, e o lote seguinte não gera resposta", async () => {
      await subir();
      const ev = await post("/api/eventos", {
        tipo: "mensagem_atendente",
        telefone: "5583999990000",
        id: "at1",
        texto: "Oi, aqui é a Ana",
        timestamp: T,
      });
      expect(respostaEventoSchema.parse(await ev.json())).toEqual({ modo: "humano" });
      const r = await post("/api/mensagens", pedido("5583999990000", ["c5"]));
      expect(respostaMensagensSchema.parse(await r.json())).toEqual({ respostas: [], modo: "humano" });
    });

    it("devolver → ia", async () => {
      await subir();
      await post("/api/eventos", {
        tipo: "mensagem_atendente",
        telefone: "5583999990000",
        id: "at2",
        texto: "assumi",
        timestamp: T,
      });
      const ev = await post("/api/eventos", { tipo: "devolver", telefone: "5583999990000", nota: "pode seguir" });
      expect(respostaEventoSchema.parse(await ev.json())).toEqual({ modo: "ia" });
    });
  });
}
```

`tests/servidorAgente.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AgenteEco } from "../src/duble/eco.js";
import type { Agente } from "../src/contrato/agente.js";
import { bateriaContrato, derrubarServidor, pedido, subirServidor } from "./helpers/bateriaContrato.js";

bateriaContrato("dublê eco", ({ atrasoMs }) => new AgenteEco({ atrasoMs }));

describe("servidor do contrato", () => {
  it("rota desconhecida → 404", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco());
    try {
      const r = await fetch(`${base}/api/outra`);
      expect(r.status).toBe(404);
    } finally {
      await derrubarServidor(servidor);
    }
  });

  it("erro qualquer do agente → 503 falha_temporaria", async () => {
    const quebrado: Agente = {
      processarLote: async () => {
        throw new Error("Claude fora");
      },
      processarEvento: async () => ({ modo: "ia" }),
    };
    const { servidor, base } = await subirServidor(quebrado);
    try {
      const r = await fetch(`${base}/api/mensagens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pedido("5583999990000", ["x1"])),
      });
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ status: "falha_temporaria" });
    } finally {
      await derrubarServidor(servidor);
    }
  });

  it("o eco devolve o texto do lote", async () => {
    const eco = new AgenteEco();
    expect(await eco.processarLote(pedido("5583999990000", ["e1", "e2"], "oi"))).toEqual({
      respostas: ["eco: oi\noi"],
      modo: "ia",
    });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/servidorAgente.test.ts`
Esperado: FAIL — import de `../src/duble/eco.js` não resolve.

- [ ] **Passo 3: Implementar**

`src/contrato/servidorHttp.ts`:

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { ZodError } from "zod";
import { eventoSchema, pedidoMensagensSchema } from "./esquemas.js";
import { TurnoEmAndamentoError, type Agente } from "./agente.js";

const LIMITE_CORPO_BYTES = 1_000_000;

class CorpoInvalidoError extends Error {}

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let tamanho = 0;
    req.on("data", (parte: Buffer) => {
      tamanho += parte.length;
      if (tamanho > LIMITE_CORPO_BYTES) {
        reject(new CorpoInvalidoError("corpo maior que 1 MB"));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString("utf-8")));
      } catch {
        reject(new CorpoInvalidoError("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

function responder(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corpo));
}

export function criarServidorAgente(
  agente: Agente,
  log: (evento: Record<string, unknown>) => void = () => {}
): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/api/health") {
        responder(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && req.url === "/api/mensagens") {
        const pedido = pedidoMensagensSchema.parse(await lerCorpo(req));
        responder(res, 200, await agente.processarLote(pedido));
        return;
      }
      if (req.method === "POST" && req.url === "/api/eventos") {
        const evento = eventoSchema.parse(await lerCorpo(req));
        responder(res, 200, await agente.processarEvento(evento));
        return;
      }
      responder(res, 404, { status: "nao_encontrado" });
    } catch (err) {
      if (err instanceof TurnoEmAndamentoError) {
        responder(res, 409, { status: "em_andamento" });
      } else if (err instanceof ZodError || err instanceof CorpoInvalidoError) {
        responder(res, 400, { status: "invalido", erro: err.message.slice(0, 500) });
      } else {
        log({ type: "erro_agente", erro: String(err) });
        responder(res, 503, { status: "falha_temporaria" });
      }
    }
  });
}
```

`src/duble/eco.ts`:

```ts
import { TurnoEmAndamentoError, type Agente } from "../contrato/agente.js";
import type {
  Evento,
  Modo,
  PedidoMensagens,
  RespostaEvento,
  RespostaMensagens,
} from "../contrato/esquemas.js";
import { loteParaTexto } from "../contrato/texto.js";

export class AgenteEco implements Agente {
  private readonly modos = new Map<string, Modo>();
  private readonly turnos = new Map<string, RespostaMensagens>();
  private readonly emAndamento = new Set<string>();
  private readonly idsVistos = new Set<string>();

  constructor(private readonly opcoes: { atrasoMs?: number } = {}) {}

  async processarLote(pedido: PedidoMensagens): Promise<RespostaMensagens> {
    const guardada = this.turnos.get(pedido.turnoId);
    if (guardada) return guardada;
    if (this.emAndamento.has(pedido.telefone)) throw new TurnoEmAndamentoError();
    this.emAndamento.add(pedido.telefone);
    try {
      if (this.opcoes.atrasoMs) await new Promise((r) => setTimeout(r, this.opcoes.atrasoMs));
      const novas = pedido.mensagens.filter((m) => !this.idsVistos.has(m.id));
      for (const m of novas) this.idsVistos.add(m.id);
      const modo = this.modos.get(pedido.telefone) ?? "ia";
      const resposta: RespostaMensagens =
        modo === "humano" || novas.length === 0
          ? { respostas: [], modo }
          : { respostas: [`eco: ${loteParaTexto(novas)}`], modo };
      this.turnos.set(pedido.turnoId, resposta);
      return resposta;
    } finally {
      this.emAndamento.delete(pedido.telefone);
    }
  }

  async processarEvento(evento: Evento): Promise<RespostaEvento> {
    const modo: Modo = evento.tipo === "devolver" ? "ia" : "humano";
    this.modos.set(evento.telefone, modo);
    return { modo };
  }
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/servidorAgente.test.ts` → Esperado: PASS (10 testes).
Rode: `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/contrato/servidorHttp.ts src/duble/eco.ts tests/helpers/bateriaContrato.ts tests/servidorAgente.test.ts
git commit -m "feat(fase-4): servidor HTTP do contrato, dublê eco e bateria de contrato compartilhada"
```

---

### Task 3 (A3): Cliente HTTP do agente (lado da ponte)

**Arquivos:**
- Criar: `src/whatsapp/agenteHttp.ts`
- Teste: `tests/agenteHttp.test.ts`

**Interfaces:**
- Consome: `servidorHttp`, `AgenteEco`, helpers da bateria (Task A2).
- Produz:
  `type ResultadoLote = { tipo: "ok"; resposta: RespostaMensagens } | { tipo: "em_andamento" } | { tipo: "falha"; motivo: string }`;
  `interface ClienteAgente { enviarLote(p: PedidoMensagens): Promise<ResultadoLote>; enviarEvento(e: Evento): Promise<RespostaEvento | null> }`;
  `criarClienteHttp(baseUrl: string, timeoutMs: number): ClienteAgente`. Nunca lança: erro de rede, timeout ou status
  diferente de 200/409 viram `falha` (lote) ou `null` (evento).

- [ ] **Passo 1: Escrever o teste que falha** — `tests/agenteHttp.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { AgenteEco } from "../src/duble/eco.js";
import { criarClienteHttp } from "../src/whatsapp/agenteHttp.js";
import { derrubarServidor, pedido, subirServidor } from "./helpers/bateriaContrato.js";

const T = "2026-10-14T12:00:00.000Z";

describe("cliente HTTP do agente", () => {
  it("200 → ok com a resposta validada", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco());
    try {
      const r = await criarClienteHttp(base, 2_000).enviarLote(pedido("5583999990000", ["h1"]));
      expect(r).toEqual({ tipo: "ok", resposta: { respostas: ["eco: oi"], modo: "ia" } });
    } finally {
      await derrubarServidor(servidor);
    }
  });

  it("409 → em_andamento", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco({ atrasoMs: 300 }));
    try {
      const cliente = criarClienteHttp(base, 2_000);
      const primeiro = cliente.enviarLote(pedido("5583999990000", ["h2"]));
      await new Promise((r) => setTimeout(r, 50));
      expect(await cliente.enviarLote(pedido("5583999990000", ["h3"]))).toEqual({ tipo: "em_andamento" });
      expect((await primeiro).tipo).toBe("ok");
    } finally {
      await derrubarServidor(servidor);
    }
  });

  it("agente fora do ar → falha", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco());
    await derrubarServidor(servidor);
    const r = await criarClienteHttp(base, 2_000).enviarLote(pedido("5583999990000", ["h4"]));
    expect(r.tipo).toBe("falha");
  });

  it("sem resposta dentro do prazo → falha", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco({ atrasoMs: 500 }));
    try {
      const r = await criarClienteHttp(base, 100).enviarLote(pedido("5583999990000", ["h5"]));
      expect(r).toEqual({ tipo: "falha", motivo: "TimeoutError" });
    } finally {
      await derrubarServidor(servidor);
    }
  });

  it("evento → modo; agente fora → null", async () => {
    const { servidor, base } = await subirServidor(new AgenteEco());
    const cliente = criarClienteHttp(base, 2_000);
    const evento = { tipo: "mensagem_atendente" as const, telefone: "5583999990000", id: "a1", texto: "oi", timestamp: T };
    expect(await cliente.enviarEvento(evento)).toEqual({ modo: "humano" });
    await derrubarServidor(servidor);
    expect(await cliente.enviarEvento(evento)).toBeNull();
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/agenteHttp.test.ts` → Esperado: FAIL — import não resolve.

- [ ] **Passo 3: Implementar** — `src/whatsapp/agenteHttp.ts`

```ts
import {
  respostaEventoSchema,
  respostaMensagensSchema,
  type Evento,
  type PedidoMensagens,
  type RespostaEvento,
  type RespostaMensagens,
} from "../contrato/esquemas.js";

export type ResultadoLote =
  | { tipo: "ok"; resposta: RespostaMensagens }
  | { tipo: "em_andamento" }
  | { tipo: "falha"; motivo: string };

export interface ClienteAgente {
  enviarLote(pedido: PedidoMensagens): Promise<ResultadoLote>;
  enviarEvento(evento: Evento): Promise<RespostaEvento | null>;
}

export function criarClienteHttp(baseUrl: string, timeoutMs: number): ClienteAgente {
  function post(rota: string, corpo: unknown): Promise<Response> {
    return fetch(`${baseUrl}${rota}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return {
    async enviarLote(pedido) {
      try {
        const res = await post("/api/mensagens", pedido);
        if (res.status === 409) return { tipo: "em_andamento" };
        if (!res.ok) return { tipo: "falha", motivo: `http_${res.status}` };
        return { tipo: "ok", resposta: respostaMensagensSchema.parse(await res.json()) };
      } catch (err) {
        return { tipo: "falha", motivo: err instanceof Error ? err.name : "erro" };
      }
    },

    async enviarEvento(evento) {
      try {
        const res = await post("/api/eventos", evento);
        if (!res.ok) return null;
        return respostaEventoSchema.parse(await res.json());
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/agenteHttp.test.ts` → PASS (5 testes). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/whatsapp/agenteHttp.ts tests/agenteHttp.test.ts
git commit -m "feat(fase-4): cliente HTTP da ponte para o agente (ok, 409, falha)"
```

---

### Task 4 (A4): Escrita simulada de orçamento

**Arquivos:**
- Criar: `src/integrations/brindeme/escritaSimulada.ts`
- Modificar: `src/integrations/brindeme/factory.ts`, `.env.example`
- Teste: `tests/escritaSimulada.test.ts`

**Interfaces:**
- Consome: `BrindeMeClient` (`src/integrations/brindeme/client.ts`), `config.brindeMe.escritaOrcamento` (Task A1).
- Produz: `class EscritaSimuladaClient implements BrindeMeClient` com `constructor(real: BrindeMeClient)`;
  `STATUS_TESTE`. `createBudget` nunca chama o cliente real; leituras delegam.

- [ ] **Passo 1: Escrever o teste que falha** — `tests/escritaSimulada.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { EscritaSimuladaClient, STATUS_TESTE } from "../src/integrations/brindeme/escritaSimulada.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import type { CreateBudgetBody } from "../src/integrations/brindeme/types.js";

const corpo: CreateBudgetBody = {
  type: "PJ",
  customer_name: "Empresa Teste",
  customer_phone: "5583999990000",
  customer_email: "compras@empresa.test",
  items: [{ subproduct_id: "sub-1", quantity: 50 }],
};

describe("escrita simulada de orçamento", () => {
  it("cria orçamento TESTE sem chamar o POST da loja", async () => {
    const real = new MockBrindeMeClient();
    const post = vi.spyOn(real, "createBudget");
    const cliente = new EscritaSimuladaClient(real);

    const orcamento = await cliente.createBudget(corpo, { idempotencyKey: "tok" });

    expect(post).not.toHaveBeenCalled();
    expect(orcamento.code).toMatch(/^TESTE-/);
    expect(orcamento.status_name).toBe(STATUS_TESTE);
    expect(orcamento.items).toEqual([
      { subproduct_id: "sub-1", quantity: 50, unit_price: 0, subtotal: 0, product_name: "", color: "" },
    ]);
  });

  it("consulta o orçamento simulado pelo id", async () => {
    const cliente = new EscritaSimuladaClient(new MockBrindeMeClient());
    const criado = await cliente.createBudget(corpo);
    expect(await cliente.getBudget(criado.id)).toEqual(criado);
  });

  it("dois orçamentos simulados têm códigos diferentes", async () => {
    const cliente = new EscritaSimuladaClient(new MockBrindeMeClient());
    const a = await cliente.createBudget(corpo);
    const b = await cliente.createBudget(corpo);
    expect(a.code).not.toBe(b.code);
  });

  it("leituras vão para o cliente real", async () => {
    const real = new MockBrindeMeClient();
    const leitura = vi.spyOn(real, "listAdmins");
    await new EscritaSimuladaClient(real).listAdmins();
    expect(leitura).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/escritaSimulada.test.ts` → FAIL — import não resolve.

- [ ] **Passo 3: Implementar**

`src/integrations/brindeme/escritaSimulada.ts`:

```ts
import { v4 as uuidv4 } from "uuid";
import type {
  BrindeMeClient,
  CreateBudgetOptions,
  ListOrdersParams,
  ListProductsParams,
  OrderListResponse,
} from "./client.js";
import type { Admin, Budget, CreateBudgetBody, Order, Product, ProductListResponse } from "./types.js";

export const STATUS_TESTE = "TESTE — simulado, não foi enviado à loja";

export class EscritaSimuladaClient implements BrindeMeClient {
  private readonly simulados = new Map<string, Budget>();
  private sequencia = 0;

  constructor(private readonly real: BrindeMeClient) {}

  listProducts(params?: ListProductsParams): Promise<ProductListResponse> {
    return this.real.listProducts(params);
  }

  getProduct(id: string): Promise<Product> {
    return this.real.getProduct(id);
  }

  getOrder(id: string): Promise<Order> {
    return this.real.getOrder(id);
  }

  listOrders(params?: ListOrdersParams): Promise<OrderListResponse> {
    return this.real.listOrders(params);
  }

  listAdmins(): Promise<Admin[]> {
    return this.real.listAdmins();
  }

  async createBudget(body: CreateBudgetBody, _options?: CreateBudgetOptions): Promise<Budget> {
    const agora = new Date().toISOString();
    const budget: Budget = {
      id: `teste-${uuidv4()}`,
      code: `TESTE-${Date.now().toString(36).toUpperCase()}${++this.sequencia}`,
      type: body.type,
      status_id: "teste",
      status_name: STATUS_TESTE,
      customer_name: body.customer_name,
      customer_phone: body.customer_phone,
      customer_email: body.customer_email,
      items: body.items.map((i) => ({
        subproduct_id: i.subproduct_id,
        quantity: i.quantity,
        unit_price: 0,
        subtotal: 0,
        product_name: "",
        color: "",
      })),
      comments: body.comments,
      created_at: agora,
      updated_at: agora,
    };
    this.simulados.set(budget.id, budget);
    return budget;
  }

  async getBudget(id: string): Promise<Budget> {
    return this.simulados.get(id) ?? this.real.getBudget(id);
  }
}
```

`src/integrations/brindeme/factory.ts` — conteúdo final:

```ts
import type { BrindeMeClient } from "./client.js";
import { MockBrindeMeClient } from "./mockClient.js";
import { HttpBrindeMeClient } from "./httpClient.js";
import { EscritaSimuladaClient } from "./escritaSimulada.js";
import { config } from "../../config.js";

/** Escolhe a implementação pelo BRINDEME_MODE. As tools não sabem qual é. */
export function createBrindeMeClient(): BrindeMeClient {
  if (config.brindeMe.mode !== "http") return new MockBrindeMeClient();
  const http = new HttpBrindeMeClient();
  return config.brindeMe.escritaOrcamento === "real" ? http : new EscritaSimuladaClient(http);
}
```

`.env.example` — depois da linha `BRINDEME_MAX_RETRIES=2`, acrescente:

```
# simulada = orçamento TESTE, nenhum POST na loja | real = grava de verdade (só com BRINDEME_MODE=http)
ORCAMENTO_ESCRITA=simulada
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/escritaSimulada.test.ts` → PASS (4). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/integrations/brindeme/escritaSimulada.ts src/integrations/brindeme/factory.ts .env.example tests/escritaSimulada.test.ts
git commit -m "feat(fase-4): orçamento simulado TESTE até ligarem a escrita real (ORCAMENTO_ESCRITA)"
```

---

### Task 5 (A5): Partida compartilhada e dublê `direto`

**Arquivos:**
- Criar: `src/partida.ts`, `src/duble/direto.ts`, `src/duble/index.ts`, `tests/helpers/llmRoteirizado.ts`
- Modificar: `src/cli.ts`, `package.json`
- Teste: `tests/dubleDireto.test.ts`

**Interfaces:**
- Consome: `runTurn`, `createInitialState`, `addMessage` (existentes); `Agente`, `formatarParaWhatsApp`, `loteParaTexto`.
- Produz: `avisarConhecimentoECatalogo(client: BrindeMeClient): Promise<void>`;
  `class AgenteDireto implements Agente` com `constructor(llm: LLMProvider, client: BrindeMeClient)`;
  `class ScriptedLLM`, `toolUse(name, input?, id?)`, `endTurn(text)` em `tests/helpers/llmRoteirizado.ts`.

- [ ] **Passo 1: Escrever o helper e o teste que falha**

`tests/helpers/llmRoteirizado.ts`:

```ts
import type { LLMMessage, LLMProvider, LLMResponse } from "../../src/llm/types.js";

/** Devolve as respostas na ordem; um Error no roteiro é lançado. Guarda os messages de cada chamada. */
export class ScriptedLLM implements LLMProvider {
  public seen: LLMMessage[][] = [];

  constructor(
    private readonly script: Array<LLMResponse | Error> = [],
    private readonly atrasoMs = 0
  ) {}

  async chat(params: { messages: LLMMessage[] }): Promise<LLMResponse> {
    this.seen.push(JSON.parse(JSON.stringify(params.messages)));
    if (this.atrasoMs) await new Promise((r) => setTimeout(r, this.atrasoMs));
    const proximo = this.script.shift() ?? endTurn("fim");
    if (proximo instanceof Error) throw proximo;
    return proximo;
  }
}

export function toolUse(name: string, input: unknown = {}, id = `tu-${Math.random()}`): LLMResponse {
  return {
    id: "msg",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id, name, input }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

export function endTurn(text: string): LLMResponse {
  return {
    id: "msg",
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}
```

`tests/dubleDireto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AgenteDireto } from "../src/duble/direto.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { ScriptedLLM, endTurn, toolUse } from "./helpers/llmRoteirizado.js";
import { pedido } from "./helpers/bateriaContrato.js";

const TEL = "5583999990000";
const T = "2026-10-14T12:00:00.000Z";

describe("dublê direto", () => {
  it("roda o runTurn real e devolve a resposta no formato do WhatsApp", async () => {
    const llm = new ScriptedLLM([endTurn("Olá! **Bem-vindo** à loja.\n\nComo posso ajudar?")]);
    const agente = new AgenteDireto(llm, new MockBrindeMeClient());

    const r = await agente.processarLote(pedido(TEL, ["d1"], "oi"));

    expect(r).toEqual({ respostas: ["Olá! *Bem-vindo* à loja.", "Como posso ajudar?"], modo: "ia" });
    expect(llm.seen[0].at(-1)).toEqual({ role: "user", content: "oi" });
  });

  it("lote repetido devolve a resposta guardada sem chamar o modelo de novo", async () => {
    const llm = new ScriptedLLM([endTurn("primeira")]);
    const agente = new AgenteDireto(llm, new MockBrindeMeClient());
    const p = pedido(TEL, ["d2"]);
    const a = await agente.processarLote(p);
    const b = await agente.processarLote(p);
    expect(b).toEqual(a);
    expect(llm.seen).toHaveLength(1);
  });

  it("atendente assume (IA quieta) e devolve", async () => {
    const llm = new ScriptedLLM([endTurn("voltei")]);
    const agente = new AgenteDireto(llm, new MockBrindeMeClient());

    expect(
      await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "at", texto: "assumi", timestamp: T })
    ).toEqual({ modo: "humano" });
    expect(await agente.processarLote(pedido(TEL, ["d3"]))).toEqual({ respostas: [], modo: "humano" });
    expect(llm.seen).toHaveLength(0);

    expect(await agente.processarEvento({ tipo: "devolver", telefone: TEL })).toEqual({ modo: "ia" });
    expect(await agente.processarLote(pedido(TEL, ["d4"]))).toEqual({ respostas: ["voltei"], modo: "ia" });
  });

  it("transferência gera aviso para o atendente com o comando de devolver", async () => {
    const llm = new ScriptedLLM([
      toolUse("transferir_humano", { motivo: "pedido_cliente", prioridade: "normal" }),
      endTurn("Vou te passar para um atendente."),
    ]);
    const agente = new AgenteDireto(llm, new MockBrindeMeClient());
    const r = await agente.processarLote(pedido(TEL, ["d5"], "quero falar com alguém"));
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toContain(`#devolver ${TEL}`);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/dubleDireto.test.ts` → FAIL — import de `../src/duble/direto.js` não resolve.

- [ ] **Passo 3: Implementar**

`src/partida.ts` — é a função `avisarConhecimentoECatalogo` que hoje está em `src/cli.ts:31-61`, movida sem mudar o
comportamento:

```ts
import type { BrindeMeClient } from "./integrations/brindeme/client.js";
import { FileProductIndexStore } from "./catalogo/indice.js";
import { garantirIndice } from "./catalogo/garantirIndice.js";
import { carregarBase } from "./knowledge/base.js";
import { config } from "./config.js";

const GRAY = "\x1b[90m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/** Estado da base de conhecimento e do índice de catálogo, antes de atender. */
export async function avisarConhecimentoECatalogo(client: BrindeMeClient): Promise<void> {
  const { base, problemas } = carregarBase({ incluirRascunhos: config.conhecimento.incluirRascunhos });
  const e = base.estatisticas();
  console.log(
    `${GRAY}Base de conhecimento: ${e.servidos} item(ns) servido(s) de ${e.total} · ${e.aprovados} aprovado(s), ${e.rascunhos} em rascunho${RESET}`
  );
  if (config.conhecimento.incluirRascunhos) {
    console.log(`${YELLOW}! KB_INCLUIR_RASCUNHOS=true — respostas usam texto NÃO aprovado. Só para desenvolvimento.${RESET}`);
  } else if (e.aprovados === 0) {
    console.log(`${YELLOW}! nenhum item aprovado: dúvidas gerais viram lacuna e transferem. Veja: npm run kb:validar${RESET}`);
  }
  for (const p of problemas) console.log(`${YELLOW}! ${p.arquivo}${p.item ? ` · ${p.item}` : ""}: ${p.mensagem}${RESET}`);

  try {
    const s = await garantirIndice(client, new FileProductIndexStore(), {
      autoSincronizar: config.brindeMe.mode === "mock",
    });
    if (s.situacao === "vazio") {
      console.log(`${YELLOW}! índice de catálogo vazio — buscar_produtos vai falhar. Rode: npm run sync:catalogo${RESET}`);
    } else if (s.situacao === "antigo") {
      console.log(`${YELLOW}! índice de catálogo com ${Math.round(s.idadeHoras)}h (${s.produtos} produtos) — o job de sincronização está rodando?${RESET}`);
    } else if (s.situacao === "sincronizado") {
      console.log(`${GRAY}Índice de catálogo montado a partir dos mocks: ${s.produtos} produto(s)${RESET}`);
    } else {
      console.log(`${GRAY}Índice de catálogo: ${s.produtos} produto(s), sincronizado há ${s.idadeHoras < 1 ? "menos de 1" : Math.round(s.idadeHoras)}h${RESET}`);
    }
  } catch (err) {
    console.log(`${YELLOW}! não foi possível preparar o índice de catálogo: ${err instanceof Error ? err.message : err}${RESET}`);
  }
  console.log();
}
```

`src/cli.ts`:
- Apague as linhas de import `FileProductIndexStore`, `garantirIndice` e `carregarBase` (linhas 11–13).
- Apague a função `avisarConhecimentoECatalogo` inteira, com o comentário de cima (linhas 30–61).
- Acrescente, junto dos outros imports: `import { avisarConhecimentoECatalogo } from "./partida.js";`
- A chamada `await avisarConhecimentoECatalogo(client);` em `main()` fica como está.

`src/duble/direto.ts`:

```ts
import { TurnoEmAndamentoError, type Agente } from "../contrato/agente.js";
import type { Evento, PedidoMensagens, RespostaEvento, RespostaMensagens } from "../contrato/esquemas.js";
import { formatarParaWhatsApp, loteParaTexto } from "../contrato/texto.js";
import { addMessage, createInitialState, type ConversationState } from "../agent/state.js";
import { runTurn } from "../agent/runTurn.js";
import type { LLMProvider } from "../llm/types.js";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { Logger } from "../logging/logger.js";

export class AgenteDireto implements Agente {
  private readonly estados = new Map<string, ConversationState>();
  private readonly turnos = new Map<string, RespostaMensagens>();
  private readonly emAndamento = new Set<string>();
  private readonly idsVistos = new Set<string>();

  constructor(
    private readonly llm: LLMProvider,
    private readonly client: BrindeMeClient
  ) {}

  private estado(telefone: string): ConversationState {
    let estado = this.estados.get(telefone);
    if (!estado) {
      estado = createInitialState(telefone);
      this.estados.set(telefone, estado);
    }
    return estado;
  }

  async processarLote(pedido: PedidoMensagens): Promise<RespostaMensagens> {
    const guardada = this.turnos.get(pedido.turnoId);
    if (guardada) return guardada;
    if (this.emAndamento.has(pedido.telefone)) throw new TurnoEmAndamentoError();
    this.emAndamento.add(pedido.telefone);
    try {
      const estado = this.estado(pedido.telefone);
      const novas = pedido.mensagens.filter((m) => !this.idsVistos.has(m.id));
      if (novas.length === 0) return { respostas: [], modo: estado.modo };
      const resultado = await runTurn(
        loteParaTexto(novas),
        estado,
        this.llm,
        this.client,
        new Logger(estado.conversaId)
      );
      for (const m of novas) this.idsVistos.add(m.id);
      const resposta: RespostaMensagens = {
        respostas: formatarParaWhatsApp(resultado.response ?? ""),
        modo: estado.modo,
        ...(resultado.transferred
          ? {
              avisoAtendente: `🔔 Conversa ${pedido.telefone} transferida para atendente.\nPara devolver: #devolver ${pedido.telefone}`,
            }
          : {}),
      };
      this.turnos.set(pedido.turnoId, resposta);
      return resposta;
    } finally {
      this.emAndamento.delete(pedido.telefone);
    }
  }

  async processarEvento(evento: Evento): Promise<RespostaEvento> {
    const estado = this.estado(evento.telefone);
    if (evento.tipo === "mensagem_atendente") {
      estado.modo = "humano";
      addMessage(estado, "assistant", `[Atendente]: ${evento.texto}`);
    } else {
      estado.modo = "ia";
      estado.falhasConsecutivas = 0;
      addMessage(
        estado,
        "assistant",
        evento.nota
          ? `[Atendente devolveu o atendimento à IA com a nota: "${evento.nota}"]`
          : "[Atendente devolveu o atendimento à IA]"
      );
    }
    return { modo: estado.modo };
  }
}
```

`src/duble/index.ts`:

```ts
import "dotenv/config";
import { config } from "../config.js";
import type { Agente } from "../contrato/agente.js";
import { criarServidorAgente } from "../contrato/servidorHttp.js";
import { createBrindeMeClient } from "../integrations/brindeme/factory.js";
import { AnthropicProvider } from "../llm/anthropic.js";
import { avisarConhecimentoECatalogo } from "../partida.js";
import { AgenteDireto } from "./direto.js";
import { AgenteEco } from "./eco.js";

function lerModo(): string {
  const i = process.argv.indexOf("--modo");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : "direto";
}

async function main(): Promise<void> {
  const modo = lerModo();
  let agente: Agente;
  if (modo === "eco") {
    agente = new AgenteEco();
  } else if (modo === "direto") {
    const client = createBrindeMeClient();
    console.log(`API da loja: ${config.brindeMe.mode} · escrita de orçamento: ${config.brindeMe.escritaOrcamento}`);
    await avisarConhecimentoECatalogo(client);
    agente = new AgenteDireto(new AnthropicProvider(), client);
  } else {
    console.error(`--modo inválido: ${modo} (use eco ou direto)`);
    process.exit(1);
  }
  const servidor = criarServidorAgente(agente, (e) => console.error(JSON.stringify(e)));
  servidor.listen(config.agente.porta, "127.0.0.1", () => {
    console.log(`Dublê do agente (${modo}) em http://127.0.0.1:${config.agente.porta}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`package.json` — em `"scripts"`, acrescente: `"agente:duble": "tsx src/duble/index.ts",`

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/dubleDireto.test.ts` → PASS (4). `npm test && npm run typecheck` → verde.
Rode: `npm run agente:duble -- --modo eco` → Esperado: `Dublê do agente (eco) em http://127.0.0.1:3030`. Em outro
terminal: `curl -s http://127.0.0.1:3030/api/health` → `{"ok":true}`. Pare com Ctrl+C.

- [ ] **Passo 5: Commit**

```bash
git add src/partida.ts src/cli.ts src/duble tests/helpers/llmRoteirizado.ts tests/dubleDireto.test.ts package.json
git commit -m "feat(fase-4): dublê direto (runTurn real com estado em memória) e partida compartilhada com o CLI"
```

---

### Task 6 (A6): Canal, telefone, log e os dublês de teste

**Arquivos:**
- Criar: `src/whatsapp/canal.ts`, `src/whatsapp/telefone.ts`, `src/whatsapp/log.ts`,
  `tests/helpers/whatsappFalso.ts`, `tests/helpers/agenteFalso.ts`
- Teste: `tests/telefone.test.ts`

**Interfaces:**
- Produz (`canal.ts`): `type TipoMensagem = "texto" | "midia" | "audio" | "ignorada"`;
  `interface MidiaBaixada { mime: string; base64: string; nome?: string }`;
  `interface MensagemRecebida { id; chatId; telefone: string | null; deMim; paraMim; direta; tipo; texto; timestamp; baixarMidia?: () => Promise<MidiaBaixada | null> }`;
  `interface ConversaPendente { chatId: string; mensagens: MensagemRecebida[] }`;
  `interface CanalWhatsApp { aoMensagem(h); aoPronto(h); enviar(chatId, texto); digitando(chatId); marcarComoLida(chatId); pendentes(); meuChatId(): string }`.
- Produz (`telefone.ts`): `normalizarTelefone(entrada: string): string`;
  `ehConversaDireta(chatId: string, author?: string | null): boolean`.
- Produz (`log.ts`): `type LogPonte = (evento: Record<string, unknown>) => void`; `criarLogPonte(dir?: string): LogPonte`.
- Produz (helpers): `WhatsAppFalso` (com `eu`, `enviadas`, `lidas`, `digitandoEm`, `naoLidas`, `falhar: Map<string, number>`,
  `mensagem(p)`), constantes `TELEFONE_EU`, `CHAT_EU`; `AgenteFalso` (com `lotes`, `eventos`, `roteiro`, `padrao`,
  `eventosFalham`).

- [ ] **Passo 1: Escrever o teste que falha** — `tests/telefone.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { ehConversaDireta, normalizarTelefone } from "../src/whatsapp/telefone.js";

describe("normalizarTelefone", () => {
  it("mantém o número completo", () => {
    expect(normalizarTelefone("5583999990000")).toBe("5583999990000");
  });

  it("acrescenta o 9 no celular brasileiro que veio sem ele", () => {
    expect(normalizarTelefone("558399990000")).toBe("5583999990000");
  });

  it("não mexe em fixo brasileiro", () => {
    expect(normalizarTelefone("558333334444")).toBe("558333334444");
  });

  it("tira formatação", () => {
    expect(normalizarTelefone("+55 (83) 99999-0000")).toBe("5583999990000");
  });

  it("não mexe em número de outro país", () => {
    expect(normalizarTelefone("12025550108")).toBe("12025550108");
  });
});

describe("ehConversaDireta", () => {
  it("aceita @c.us e @lid", () => {
    expect(ehConversaDireta("5583999990000@c.us")).toBe(true);
    expect(ehConversaDireta("123456789012345@lid")).toBe(true);
  });

  it("recusa grupo, status, canal e lista de transmissão", () => {
    expect(ehConversaDireta("1203630@g.us")).toBe(false);
    expect(ehConversaDireta("status@broadcast")).toBe(false);
    expect(ehConversaDireta("1203630@newsletter")).toBe(false);
    expect(ehConversaDireta("1203630@broadcast")).toBe(false);
  });

  it("recusa mensagem com autor (é de grupo)", () => {
    expect(ehConversaDireta("5583999990000@c.us", "5583888880000@c.us")).toBe(false);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/telefone.test.ts` → FAIL — import não resolve.

- [ ] **Passo 3: Implementar**

`src/whatsapp/canal.ts`:

```ts
export type TipoMensagem = "texto" | "midia" | "audio" | "ignorada";

export interface MidiaBaixada {
  mime: string;
  base64: string;
  nome?: string;
}

export interface MensagemRecebida {
  id: string;
  chatId: string;
  /** Telefone normalizado da conversa; null quando não deu para resolver (ex.: @lid sem número). */
  telefone: string | null;
  deMim: boolean;
  /** Mensagem minha na conversa "Mensagem para mim". */
  paraMim: boolean;
  direta: boolean;
  tipo: TipoMensagem;
  texto: string;
  timestamp: string;
  baixarMidia?: () => Promise<MidiaBaixada | null>;
}

export interface ConversaPendente {
  chatId: string;
  mensagens: MensagemRecebida[];
}

export interface CanalWhatsApp {
  aoMensagem(handler: (m: MensagemRecebida) => void): void;
  aoPronto(handler: () => void): void;
  enviar(chatId: string, texto: string): Promise<void>;
  digitando(chatId: string): Promise<void>;
  marcarComoLida(chatId: string): Promise<void>;
  /** Conversas diretas com mensagens do cliente ainda não lidas. */
  pendentes(): Promise<ConversaPendente[]>;
  meuChatId(): string;
}
```

`src/whatsapp/telefone.ts`:

```ts
export function normalizarTelefone(entrada: string): string {
  const d = entrada.replace(/\D/g, "");
  if (d.startsWith("55") && d.length === 12 && /[6-9]/.test(d.charAt(4))) {
    return `${d.slice(0, 4)}9${d.slice(4)}`;
  }
  return d;
}

export function ehConversaDireta(chatId: string, author?: string | null): boolean {
  const jid = chatId.trim().toLowerCase();
  if (!jid || author) return false;
  if (jid === "status@broadcast") return false;
  return jid.endsWith("@c.us") || jid.endsWith("@lid");
}
```

`src/whatsapp/log.ts`:

```ts
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { mascararTexto } from "../logging/logger.js";

export type LogPonte = (evento: Record<string, unknown>) => void;

const NO_TERMINAL = new Set(["lote_falhou", "envio_falhou", "evento_pendente", "varredura_falhou", "erro_ao_receber"]);

export function criarLogPonte(dir = "logs"): LogPonte {
  mkdirSync(dir, { recursive: true });
  const arquivo = join(dir, "ponte.jsonl");
  return (evento) => {
    const linha = mascararTexto(JSON.stringify({ timestamp: new Date().toISOString(), ...evento }));
    try {
      appendFileSync(arquivo, `${linha}\n`, "utf-8");
    } catch {
      // log nunca derruba a ponte
    }
    if (NO_TERMINAL.has(String(evento.type))) console.warn(linha);
  };
}
```

`tests/helpers/whatsappFalso.ts`:

```ts
import type { CanalWhatsApp, ConversaPendente, MensagemRecebida } from "../../src/whatsapp/canal.js";

export const TELEFONE_EU = "5583900000000";
export const CHAT_EU = `${TELEFONE_EU}@c.us`;

/** WhatsApp em memória. Como o whatsapp-web.js, ecoa cada envio de volta como mensagem "deMim". */
export class WhatsAppFalso implements CanalWhatsApp {
  readonly eu = CHAT_EU;
  enviadas: Array<{ chatId: string; texto: string }> = [];
  lidas: string[] = [];
  digitandoEm: string[] = [];
  naoLidas: ConversaPendente[] = [];
  /** texto → quantas das próximas tentativas de enviar esse texto falham */
  falhar = new Map<string, number>();
  private handler: (m: MensagemRecebida) => void = () => {};
  private seq = 0;

  aoMensagem(handler: (m: MensagemRecebida) => void): void {
    this.handler = handler;
  }

  aoPronto(_handler: () => void): void {}

  meuChatId(): string {
    return this.eu;
  }

  async enviar(chatId: string, texto: string): Promise<void> {
    const restantes = this.falhar.get(texto) ?? 0;
    if (restantes > 0) {
      this.falhar.set(texto, restantes - 1);
      throw new Error("falha de envio simulada");
    }
    this.enviadas.push({ chatId, texto });
    this.handler(this.mensagem({ chatId, texto, deMim: true, paraMim: chatId === this.eu }));
  }

  async digitando(chatId: string): Promise<void> {
    this.digitandoEm.push(chatId);
  }

  async marcarComoLida(chatId: string): Promise<void> {
    this.lidas.push(chatId);
  }

  async pendentes(): Promise<ConversaPendente[]> {
    return this.naoLidas;
  }

  mensagem(p: Partial<MensagemRecebida> & { chatId: string; texto: string }): MensagemRecebida {
    return {
      id: `m${++this.seq}`,
      telefone: p.chatId.split("@")[0],
      deMim: false,
      paraMim: false,
      direta: true,
      tipo: "texto",
      timestamp: new Date().toISOString(),
      ...p,
    };
  }
}
```

`tests/helpers/agenteFalso.ts`:

```ts
import type { ClienteAgente, ResultadoLote } from "../../src/whatsapp/agenteHttp.js";
import type { Evento, PedidoMensagens, RespostaEvento } from "../../src/contrato/esquemas.js";

type Passo = ResultadoLote | (() => Promise<ResultadoLote>);

export class AgenteFalso implements ClienteAgente {
  lotes: PedidoMensagens[] = [];
  eventos: Evento[] = [];
  roteiro: Passo[] = [];
  padrao: ResultadoLote = { tipo: "ok", resposta: { respostas: ["olá"], modo: "ia" } };
  eventosFalham = false;

  async enviarLote(pedido: PedidoMensagens): Promise<ResultadoLote> {
    this.lotes.push(pedido);
    const passo = this.roteiro.shift() ?? this.padrao;
    return typeof passo === "function" ? passo() : passo;
  }

  async enviarEvento(evento: Evento): Promise<RespostaEvento | null> {
    if (this.eventosFalham) return null;
    this.eventos.push(evento);
    return { modo: evento.tipo === "devolver" ? "ia" : "humano" };
  }
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/telefone.test.ts` → PASS (8). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/whatsapp/canal.ts src/whatsapp/telefone.ts src/whatsapp/log.ts tests/helpers/whatsappFalso.ts tests/helpers/agenteFalso.ts tests/telefone.test.ts
git commit -m "feat(fase-4): interface do canal WhatsApp, normalização de telefone e dublês de teste"
```

---

### Task 7 (A7): `salvarMidia`

**Arquivos:**
- Criar: `src/whatsapp/midia.ts`
- Teste: `tests/midia.test.ts`

**Interfaces:**
- Consome: `MidiaBaixada` (A6), `Arquivo` (A1).
- Produz: `salvarMidia(dirBase: string, telefone: string, id: string, midia: MidiaBaixada): ResultadoMidia`;
  `type ResultadoMidia = { ok: true; arquivo: Arquivo } | { ok: false; nome: string; motivo: string }`;
  `EXTENSOES_POR_MIME`, `TAMANHO_MAXIMO_BYTES` (16 MB). Aceita PNG, JPG, SVG e PDF — os mesmos formatos de
  `registrar_arte` (`src/tools/registrarArte.ts:7`).

- [ ] **Passo 1: Escrever o teste que falha** — `tests/midia.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { salvarMidia, TAMANHO_MAXIMO_BYTES } from "../src/whatsapp/midia.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("salvarMidia", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "artes-"));
  });

  it("grava a arte em <dir>/<telefone>/<id>.<ext> com tipo e tamanho reais", () => {
    const r = salvarMidia(dir, "5583999990000", "false_5583@c.us_3EB0AB", { mime: "image/png", base64: PNG, nome: "logo.png" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arquivo.caminho).toBe(join(dir, "5583999990000", "false_5583_c_us_3EB0AB.png"));
    expect(r.arquivo.mime).toBe("image/png");
    expect(r.arquivo.nome).toBe("logo.png");
    expect(r.arquivo.bytes).toBe(Buffer.from(PNG, "base64").length);
    expect(readFileSync(r.arquivo.caminho).equals(Buffer.from(PNG, "base64"))).toBe(true);
  });

  it("aceita mime com parâmetros e dá nome quando a imagem não tem", () => {
    const r = salvarMidia(dir, "5583999990000", "abc12345", { mime: "image/jpeg; charset=binary", base64: PNG });
    expect(r.ok && r.arquivo.nome).toBe("arquivo-abc12345.jpg");
  });

  it("recusa formato fora da lista sem gravar nada", () => {
    const r = salvarMidia(dir, "5583999990000", "x1", { mime: "video/mp4", base64: PNG, nome: "video.mp4" });
    expect(r).toEqual({ ok: false, nome: "video.mp4", motivo: "formato video/mp4 não aceito (aceitos: PNG, JPG, SVG, PDF)" });
    expect(existsSync(join(dir, "5583999990000"))).toBe(false);
  });

  it("recusa arquivo vazio e arquivo grande demais", () => {
    expect(salvarMidia(dir, "5583999990000", "x2", { mime: "application/pdf", base64: "" })).toMatchObject({
      ok: false,
      motivo: "arquivo vazio",
    });
    const grande = Buffer.alloc(TAMANHO_MAXIMO_BYTES + 1).toString("base64");
    expect(salvarMidia(dir, "5583999990000", "x3", { mime: "application/pdf", base64: grande })).toMatchObject({
      ok: false,
      motivo: "arquivo maior que 16 MB",
    });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/midia.test.ts` → FAIL — import não resolve.

- [ ] **Passo 3: Implementar** — `src/whatsapp/midia.ts`

```ts
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { Arquivo } from "../contrato/esquemas.js";
import type { MidiaBaixada } from "./canal.js";

export const EXTENSOES_POR_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

export const TAMANHO_MAXIMO_BYTES = 16 * 1024 * 1024;

export type ResultadoMidia = { ok: true; arquivo: Arquivo } | { ok: false; nome: string; motivo: string };

export function salvarMidia(dirBase: string, telefone: string, id: string, midia: MidiaBaixada): ResultadoMidia {
  const mime = midia.mime.split(";")[0].trim().toLowerCase();
  const ext = EXTENSOES_POR_MIME[mime];
  const idSeguro = id.replace(/[^A-Za-z0-9_-]/g, "_").slice(-60);
  const nome = midia.nome?.trim() || `arquivo-${idSeguro.slice(-8)}${ext ? `.${ext}` : ""}`;
  if (!ext) return { ok: false, nome, motivo: `formato ${mime} não aceito (aceitos: PNG, JPG, SVG, PDF)` };

  const dados = Buffer.from(midia.base64, "base64");
  if (dados.length === 0) return { ok: false, nome, motivo: "arquivo vazio" };
  if (dados.length > TAMANHO_MAXIMO_BYTES) return { ok: false, nome, motivo: "arquivo maior que 16 MB" };

  const dir = resolve(dirBase, telefone);
  mkdirSync(dir, { recursive: true });
  const caminho = join(dir, `${idSeguro}.${ext}`);
  writeFileSync(caminho, dados);
  return { ok: true, arquivo: { caminho, mime, bytes: dados.length, nome } };
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/midia.test.ts` → PASS (4). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/whatsapp/midia.ts tests/midia.test.ts
git commit -m "feat(fase-4): salvarMidia grava a arte com tipo e tamanho reais"
```

---

### Task 8 (A8): Fila de conversas

**Arquivos:**
- Criar: `src/whatsapp/fila.ts`
- Teste: `tests/fila.test.ts`

**Interfaces:**
- Consome: `MensagemLote` (A1).
- Produz: `interface OpcoesFila { silencioMs; maxMs; maxMensagens }`;
  `type ProcessarLote = (telefone: string, chatId: string, mensagens: MensagemLote[]) => Promise<void>`;
  `class FilaConversas` com `adicionar(telefone, chatId, mensagem): boolean` (false = id já na fila),
  `ocupada(telefone): boolean` (turno rodando ou buffer não vazio), `temNoBuffer(telefone): boolean`,
  `esquecer(ids: string[]): void`; `class ConjuntoLimitado` com `has`, `add` (descarta o mais antigo acima do limite).

- [ ] **Passo 1: Escrever o teste que falha** — `tests/fila.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConjuntoLimitado, FilaConversas } from "../src/whatsapp/fila.js";
import type { MensagemLote } from "../src/contrato/esquemas.js";

const OPCOES = { silencioMs: 5_000, maxMs: 30_000, maxMensagens: 10 };
let seq = 0;
const msg = (texto: string): MensagemLote => ({ id: `id${++seq}`, timestamp: new Date().toISOString(), texto });

describe("FilaConversas", () => {
  let lotes: Array<{ telefone: string; textos: string[] }>;
  let processar: (telefone: string, chatId: string, m: MensagemLote[]) => Promise<void>;

  beforeEach(() => {
    vi.useFakeTimers();
    lotes = [];
    processar = async (telefone, _chatId, m) => {
      lotes.push({ telefone, textos: m.map((x) => x.texto) });
    };
  });
  afterEach(() => vi.useRealTimers());

  it("fecha o lote com 5s de silêncio desde a última mensagem", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    fila.adicionar("a", "a@c.us", msg("oi"));
    await vi.advanceTimersByTimeAsync(3_000);
    fila.adicionar("a", "a@c.us", msg("tudo bem?"));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(lotes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(lotes).toEqual([{ telefone: "a", textos: ["oi", "tudo bem?"] }]);
  });

  it("fecha em 30s desde a primeira mesmo sem silêncio", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    for (let i = 0; i < 8; i++) {
      fila.adicionar("a", "a@c.us", msg(`m${i}`));
      await vi.advanceTimersByTimeAsync(4_000);
    }
    expect(lotes).toHaveLength(1);
    expect(lotes[0].textos).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
  });

  it("fecha na hora com 10 mensagens", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    for (let i = 0; i < 11; i++) fila.adicionar("a", "a@c.us", msg(`m${i}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes).toHaveLength(1);
    expect(lotes[0].textos).toHaveLength(10);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lotes[1].textos).toEqual(["m10"]);
  });

  it("com turno rodando só acumula; o acumulado vira o próximo lote", async () => {
    let liberar!: () => void;
    const fila = new FilaConversas(OPCOES, async (telefone, chatId, m) => {
      await processar(telefone, chatId, m);
      if (lotes.length === 1) await new Promise<void>((r) => (liberar = r));
    });
    fila.adicionar("a", "a@c.us", msg("primeira"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fila.ocupada("a")).toBe(true);
    fila.adicionar("a", "a@c.us", msg("segunda"));
    expect(fila.temNoBuffer("a")).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(lotes).toHaveLength(1);
    liberar();
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes[1].textos).toEqual(["segunda"]);
  });

  it("id repetido não entra; depois de esquecer, entra de novo", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    const m = msg("oi");
    expect(fila.adicionar("a", "a@c.us", m)).toBe(true);
    expect(fila.adicionar("a", "a@c.us", m)).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    fila.esquecer([m.id]);
    expect(fila.adicionar("a", "a@c.us", m)).toBe(true);
  });

  it("conversas diferentes não se misturam", async () => {
    const fila = new FilaConversas(OPCOES, processar);
    fila.adicionar("a", "a@c.us", msg("de a"));
    fila.adicionar("b", "b@c.us", msg("de b"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lotes).toEqual([
      { telefone: "a", textos: ["de a"] },
      { telefone: "b", textos: ["de b"] },
    ]);
  });

  it("erro no processamento libera os ids para a varredura", async () => {
    const m = msg("oi");
    const fila = new FilaConversas(OPCOES, async () => {
      throw new Error("quebrou");
    });
    fila.adicionar("a", "a@c.us", m);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fila.ocupada("a")).toBe(false);
    expect(fila.adicionar("a", "a@c.us", m)).toBe(true);
  });
});

describe("ConjuntoLimitado", () => {
  it("descarta o mais antigo acima do limite", () => {
    const c = new ConjuntoLimitado(2);
    c.add("a");
    c.add("b");
    c.add("c");
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
    expect(c.has("c")).toBe(true);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/fila.test.ts` → FAIL — import não resolve.

- [ ] **Passo 3: Implementar** — `src/whatsapp/fila.ts`

```ts
import type { MensagemLote } from "../contrato/esquemas.js";

export interface OpcoesFila {
  silencioMs: number;
  maxMs: number;
  maxMensagens: number;
}

export type ProcessarLote = (telefone: string, chatId: string, mensagens: MensagemLote[]) => Promise<void>;

interface EstadoConversa {
  chatId: string;
  buffer: MensagemLote[];
  primeiraEm: number;
  ultimaEm: number;
  timer?: ReturnType<typeof setTimeout>;
  ocupada: boolean;
}

export class ConjuntoLimitado {
  private readonly itens = new Set<string>();

  constructor(private readonly limite: number) {}

  has(id: string): boolean {
    return this.itens.has(id);
  }

  add(id: string): void {
    this.itens.add(id);
    if (this.itens.size > this.limite) {
      const maisAntigo = this.itens.values().next().value;
      if (maisAntigo !== undefined) this.itens.delete(maisAntigo);
    }
  }
}

export class FilaConversas {
  private readonly conversas = new Map<string, EstadoConversa>();
  private readonly naFila = new Set<string>();

  constructor(
    private readonly opcoes: OpcoesFila,
    private readonly processar: ProcessarLote
  ) {}

  adicionar(telefone: string, chatId: string, mensagem: MensagemLote): boolean {
    if (this.naFila.has(mensagem.id)) return false;
    this.naFila.add(mensagem.id);
    let c = this.conversas.get(telefone);
    if (!c) {
      c = { chatId, buffer: [], primeiraEm: 0, ultimaEm: 0, ocupada: false };
      this.conversas.set(telefone, c);
    }
    c.chatId = chatId;
    const agora = Date.now();
    if (c.buffer.length === 0) c.primeiraEm = agora;
    c.ultimaEm = agora;
    c.buffer.push(mensagem);
    this.agendar(telefone, c);
    return true;
  }

  ocupada(telefone: string): boolean {
    const c = this.conversas.get(telefone);
    return !!c && (c.ocupada || c.buffer.length > 0);
  }

  temNoBuffer(telefone: string): boolean {
    return (this.conversas.get(telefone)?.buffer.length ?? 0) > 0;
  }

  esquecer(ids: string[]): void {
    for (const id of ids) this.naFila.delete(id);
  }

  private agendar(telefone: string, c: EstadoConversa): void {
    if (c.timer) clearTimeout(c.timer);
    c.timer = undefined;
    if (c.ocupada || c.buffer.length === 0) return;
    if (c.buffer.length >= this.opcoes.maxMensagens) {
      void this.fechar(telefone, c);
      return;
    }
    const prazo = Math.min(c.ultimaEm + this.opcoes.silencioMs, c.primeiraEm + this.opcoes.maxMs);
    c.timer = setTimeout(() => void this.fechar(telefone, c), Math.max(0, prazo - Date.now()));
  }

  private async fechar(telefone: string, c: EstadoConversa): Promise<void> {
    c.timer = undefined;
    if (c.ocupada || c.buffer.length === 0) return;
    const lote = c.buffer.splice(0, this.opcoes.maxMensagens);
    c.ocupada = true;
    try {
      await this.processar(telefone, c.chatId, lote);
    } catch {
      this.esquecer(lote.map((m) => m.id));
    } finally {
      c.ocupada = false;
      this.agendar(telefone, c);
    }
  }
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/fila.test.ts` → PASS (8). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/whatsapp/fila.ts tests/fila.test.ts
git commit -m "feat(fase-4): fila por conversa com agrupamento (5s, 30s, 10) e um turno por vez"
```

---

### Task 9 (A9): Envio (limitador, digitando, registro de saída)

**Arquivos:**
- Criar: `src/whatsapp/envio.ts`
- Teste: `tests/envio.test.ts`

**Interfaces:**
- Consome: `CanalWhatsApp` (A6), `LogPonte` (A6), `WhatsAppFalso` (A6).
- Produz: `CHAVE_EU = "eu"`; `DIGITANDO_MAX_MS = 4000`; `esperar(ms): Promise<void>`;
  `tempoDigitando(texto): number` (= `min(4000, 800 + 25 × caracteres)`); `class RegistroSaida` (`registrar(chave, texto)`,
  `consumir(chave, texto): boolean`, validade de 2 min); `class LimitadorEnvios` (`aguardarVez()`);
  `class Envio` com `constructor(canal, enviosPorMinuto, log?)`, `ehMinha(chave, texto): boolean`,
  `paraCliente(telefone, chatId, texto): Promise<boolean>`, `paraMim(texto): Promise<boolean>`.
  A chave do registro é o telefone do cliente, ou `CHAVE_EU` para "Mensagem para mim". Envio tenta 2 vezes.

- [ ] **Passo 1: Escrever o teste que falha** — `tests/envio.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CHAVE_EU, Envio, LimitadorEnvios, RegistroSaida, tempoDigitando } from "../src/whatsapp/envio.js";
import { WhatsAppFalso } from "./helpers/whatsappFalso.js";

const CLIENTE = "5583999990000@c.us";

describe("envio", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("limitador deixa 20 por minuto e segura o 21º até a janela abrir", async () => {
    const limitador = new LimitadorEnvios(20);
    for (let i = 0; i < 20; i++) await limitador.aguardarVez();
    let liberado = false;
    const vez = limitador.aguardarVez().then(() => {
      liberado = true;
    });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(liberado).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await vez;
    expect(liberado).toBe(true);
  });

  it("registro de saída casa uma vez, por chave, e expira em 2 min", async () => {
    const r = new RegistroSaida();
    r.registrar("5583999990000", "olá ");
    expect(r.consumir("5583888880000", "olá")).toBe(false);
    expect(r.consumir("5583999990000", "olá")).toBe(true);
    expect(r.consumir("5583999990000", "olá")).toBe(false);
    r.registrar(CHAVE_EU, "aviso");
    await vi.advanceTimersByTimeAsync(120_001);
    expect(r.consumir(CHAVE_EU, "aviso")).toBe(false);
  });

  it("digitando é proporcional e para em 4s", () => {
    expect(tempoDigitando("oi")).toBe(850);
    expect(tempoDigitando("x".repeat(1_000))).toBe(4_000);
  });

  it("registra antes de enviar: o eco do próprio envio é reconhecido como nosso", async () => {
    const canal = new WhatsAppFalso();
    const envio = new Envio(canal, 20);
    const ecos: boolean[] = [];
    canal.aoMensagem((m) => ecos.push(envio.ehMinha(m.telefone!, m.texto)));
    const enviado = envio.paraCliente("5583999990000", CLIENTE, "Olá!");
    await vi.runAllTimersAsync();
    expect(await enviado).toBe(true);
    expect(canal.digitandoEm).toEqual([CLIENTE]);
    expect(ecos).toEqual([true]);
  });

  it("tenta de novo uma vez; duas falhas → false", async () => {
    const canal = new WhatsAppFalso();
    const envio = new Envio(canal, 20);
    canal.falhar.set("a", 1);
    canal.falhar.set("b", 2);
    const a = envio.paraCliente("5583999990000", CLIENTE, "a");
    await vi.runAllTimersAsync();
    expect(await a).toBe(true);
    const b = envio.paraCliente("5583999990000", CLIENTE, "b");
    await vi.runAllTimersAsync();
    expect(await b).toBe(false);
    expect(canal.enviadas.map((e) => e.texto)).toEqual(["a"]);
  });

  it("paraMim vai para o próprio número, sem digitando", async () => {
    const canal = new WhatsAppFalso();
    const envio = new Envio(canal, 20);
    expect(await envio.paraMim("resumo")).toBe(true);
    expect(canal.enviadas).toEqual([{ chatId: canal.eu, texto: "resumo" }]);
    expect(canal.digitandoEm).toEqual([]);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/envio.test.ts` → FAIL — import não resolve.

- [ ] **Passo 3: Implementar** — `src/whatsapp/envio.ts`

```ts
import type { CanalWhatsApp } from "./canal.js";
import type { LogPonte } from "./log.js";

export const CHAVE_EU = "eu";
export const DIGITANDO_MAX_MS = 4_000;
const VALIDADE_REGISTRO_MS = 120_000;

export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tempoDigitando(texto: string): number {
  return Math.min(DIGITANDO_MAX_MS, 800 + texto.length * 25);
}

export class RegistroSaida {
  private pendentes: Array<{ chave: string; texto: string; em: number }> = [];

  constructor(private readonly validadeMs = VALIDADE_REGISTRO_MS) {}

  registrar(chave: string, texto: string): void {
    this.pendentes.push({ chave, texto: texto.trim(), em: Date.now() });
  }

  consumir(chave: string, texto: string): boolean {
    const agora = Date.now();
    this.pendentes = this.pendentes.filter((p) => agora - p.em <= this.validadeMs);
    const i = this.pendentes.findIndex((p) => p.chave === chave && p.texto === texto.trim());
    if (i === -1) return false;
    this.pendentes.splice(i, 1);
    return true;
  }
}

export class LimitadorEnvios {
  private envios: number[] = [];

  constructor(private readonly porMinuto: number) {}

  async aguardarVez(): Promise<void> {
    for (;;) {
      const agora = Date.now();
      this.envios = this.envios.filter((t) => agora - t < 60_000);
      if (this.envios.length < this.porMinuto) {
        this.envios.push(agora);
        return;
      }
      await esperar(this.envios[0] + 60_000 - agora);
    }
  }
}

export class Envio {
  private readonly registro = new RegistroSaida();
  private readonly limitador: LimitadorEnvios;

  constructor(
    private readonly canal: CanalWhatsApp,
    enviosPorMinuto: number,
    private readonly log: LogPonte = () => {}
  ) {
    this.limitador = new LimitadorEnvios(enviosPorMinuto);
  }

  ehMinha(chave: string, texto: string): boolean {
    return this.registro.consumir(chave, texto);
  }

  paraCliente(telefone: string, chatId: string, texto: string): Promise<boolean> {
    return this.enviar(telefone, chatId, texto, true);
  }

  paraMim(texto: string): Promise<boolean> {
    return this.enviar(CHAVE_EU, this.canal.meuChatId(), texto, false);
  }

  private async enviar(chave: string, chatId: string, texto: string, digitar: boolean): Promise<boolean> {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      await this.limitador.aguardarVez();
      if (digitar) {
        await this.canal.digitando(chatId).catch(() => {});
        await esperar(tempoDigitando(texto));
      }
      // Registra antes de enviar: o eco (message_create) chega antes do envio resolver.
      // Em falha o registro fica até expirar, porque a mensagem pode ter saído mesmo assim.
      this.registro.registrar(chave, texto);
      try {
        await this.canal.enviar(chatId, texto);
        return true;
      } catch (err) {
        this.log({ type: "envio_falhou", tentativa, erro: String(err) });
      }
    }
    return false;
  }
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/envio.test.ts` → PASS (6). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/whatsapp/envio.ts tests/envio.test.ts
git commit -m "feat(fase-4): envio com limite por minuto, digitando proporcional e registro de saída"
```

---

### Task 10 (A10): Atendente — comandos e eventos

**Arquivos:**
- Criar: `src/whatsapp/atendente.ts`
- Teste: `tests/atendente.test.ts`

**Interfaces:**
- Consome: `ClienteAgente` (A3), `MensagemRecebida` (A6), `Envio`, `CHAVE_EU` (A9), `normalizarTelefone` (A6),
  `LIMITE_TEXTO`, `Evento` (A1).
- Produz: `type Comando = { tipo: "devolver"; telefone: string; nota?: string } | { tipo: "desconhecido" }`;
  `interpretarComando(texto: string): Comando | null` (null = não começa com `#`); `TEXTO_COMANDOS`;
  `class Atendimento` com `constructor(agente: ClienteAgente, envio: Envio, log?)`,
  `receberMinha(m: MensagemRecebida): Promise<void>`, `ultimaDoAtendente(telefone): number | undefined`,
  `reenviarEventos(): Promise<boolean>` (true = nada pendente), `temPendentes(): boolean`.

- [ ] **Passo 1: Escrever o teste que falha** — `tests/atendente.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Atendimento, interpretarComando, TEXTO_COMANDOS } from "../src/whatsapp/atendente.js";
import { Envio } from "../src/whatsapp/envio.js";
import { WhatsAppFalso } from "./helpers/whatsappFalso.js";
import { AgenteFalso } from "./helpers/agenteFalso.js";

const CLIENTE = "5583999990000@c.us";
const TEL = "5583999990000";

describe("interpretarComando", () => {
  it("texto sem # não é comando", () => {
    expect(interpretarComando("anotação qualquer")).toBeNull();
  });

  it("#devolver com e sem nota", () => {
    expect(interpretarComando("#devolver 5583999990000")).toEqual({ tipo: "devolver", telefone: TEL });
    expect(interpretarComando("  #Devolver 5583999990000   cliente já pagou ")).toEqual({
      tipo: "devolver",
      telefone: TEL,
      nota: "cliente já pagou",
    });
  });

  it("corrige o 9 e aceita +55", () => {
    expect(interpretarComando("#devolver 558399990000")).toEqual({ tipo: "devolver", telefone: TEL });
    expect(interpretarComando("#devolver +5583999990000")).toEqual({ tipo: "devolver", telefone: TEL });
  });

  it("número sem DDI, com espaço ou ausente → desconhecido", () => {
    expect(interpretarComando("#devolver 83999990000")).toEqual({ tipo: "desconhecido" });
    expect(interpretarComando("#devolver 55 83 99999-0000")).toEqual({ tipo: "desconhecido" });
    expect(interpretarComando("#devolver")).toEqual({ tipo: "desconhecido" });
    expect(interpretarComando("#ajuda")).toEqual({ tipo: "desconhecido" });
  });
});

describe("Atendimento", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function montar() {
    const canal = new WhatsAppFalso();
    const agente = new AgenteFalso();
    const envio = new Envio(canal, 20);
    const atendimento = new Atendimento(agente, envio);
    canal.aoMensagem((m) => {
      if (m.deMim) void atendimento.receberMinha(m);
    });
    return { canal, agente, envio, atendimento };
  }

  it("o eco de uma mensagem enviada pela ponte não vira atendente", async () => {
    const { agente, envio } = montar();
    const enviado = envio.paraCliente(TEL, CLIENTE, "Olá! Sou a Lia");
    await vi.runAllTimersAsync();
    expect(await enviado).toBe(true);
    expect(agente.eventos).toEqual([]);
  });

  it("mensagem que sai do número sem registro é do atendente", async () => {
    const { canal, agente, atendimento } = montar();
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    await atendimento.receberMinha(canal.mensagem({ chatId: CLIENTE, texto: "Oi, aqui é a Ana", deMim: true }));
    expect(agente.eventos).toEqual([
      {
        tipo: "mensagem_atendente",
        telefone: TEL,
        id: expect.any(String),
        texto: "Oi, aqui é a Ana",
        timestamp: "2026-10-16T10:00:00.000Z",
      },
    ]);
    expect(atendimento.ultimaDoAtendente(TEL)).toBe(Date.parse("2026-10-16T10:00:00Z"));
  });

  it("#devolver com nota devolve à IA e confirma em Mensagem para mim", async () => {
    const { canal, agente, atendimento } = montar();
    await atendimento.receberMinha(
      canal.mensagem({ chatId: canal.eu, texto: "#devolver 5583999990000 cliente já pagou", deMim: true, paraMim: true })
    );
    await vi.runAllTimersAsync();
    expect(agente.eventos).toEqual([{ tipo: "devolver", telefone: TEL, nota: "cliente já pagou" }]);
    expect(canal.enviadas).toEqual([{ chatId: canal.eu, texto: `✅ ${TEL} devolvido à IA` }]);
  });

  it("comando desconhecido responde a lista de comandos", async () => {
    const { canal, agente, atendimento } = montar();
    await atendimento.receberMinha(canal.mensagem({ chatId: canal.eu, texto: "#ajuda", deMim: true, paraMim: true }));
    await vi.runAllTimersAsync();
    expect(canal.enviadas).toEqual([{ chatId: canal.eu, texto: TEXTO_COMANDOS }]);
    expect(agente.eventos).toEqual([]);
  });

  it("anotação sem # em Mensagem para mim é ignorada", async () => {
    const { canal, agente, atendimento } = montar();
    await atendimento.receberMinha(canal.mensagem({ chatId: canal.eu, texto: "lembrar de ligar", deMim: true, paraMim: true }));
    await vi.runAllTimersAsync();
    expect(canal.enviadas).toEqual([]);
    expect(agente.eventos).toEqual([]);
  });

  it("evento que falha fica pendente e sai na ordem quando o agente volta", async () => {
    const { canal, agente, atendimento } = montar();
    agente.eventosFalham = true;
    await atendimento.receberMinha(canal.mensagem({ chatId: CLIENTE, texto: "assumi", deMim: true }));
    await atendimento.receberMinha(
      canal.mensagem({ chatId: canal.eu, texto: "#devolver 5583999990000", deMim: true, paraMim: true })
    );
    await vi.runAllTimersAsync();
    expect(canal.enviadas.at(-1)?.texto).toMatch(/^⏳/);
    expect(atendimento.temPendentes()).toBe(true);
    expect(await atendimento.reenviarEventos()).toBe(false);

    agente.eventosFalham = false;
    expect(await atendimento.reenviarEventos()).toBe(true);
    expect(agente.eventos.map((e) => e.tipo)).toEqual(["mensagem_atendente", "devolver"]);
    expect(atendimento.temPendentes()).toBe(false);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/atendente.test.ts` → FAIL — import não resolve.

- [ ] **Passo 3: Implementar** — `src/whatsapp/atendente.ts`

```ts
import { LIMITE_TEXTO, type Evento } from "../contrato/esquemas.js";
import type { ClienteAgente } from "./agenteHttp.js";
import type { MensagemRecebida } from "./canal.js";
import { CHAVE_EU, type Envio } from "./envio.js";
import type { LogPonte } from "./log.js";
import { normalizarTelefone } from "./telefone.js";

export type Comando = { tipo: "devolver"; telefone: string; nota?: string } | { tipo: "desconhecido" };

export const TEXTO_COMANDOS = [
  "Comandos do agente:",
  "#devolver <telefone com DDI, sem espaços> [nota] — devolve a conversa à IA",
  "Exemplo: #devolver 5583999990000 cliente já recebeu o boleto",
].join("\n");

export function interpretarComando(texto: string): Comando | null {
  const t = texto.trim();
  if (!t.startsWith("#")) return null;
  const m = /^#devolver\s+(\S+)(?:\s+([\s\S]+))?$/i.exec(t);
  if (!m) return { tipo: "desconhecido" };
  const telefone = normalizarTelefone(m[1]);
  if (!/^\d{12,15}$/.test(telefone)) return { tipo: "desconhecido" };
  const nota = m[2]?.trim().slice(0, 500);
  return nota ? { tipo: "devolver", telefone, nota } : { tipo: "devolver", telefone };
}

export class Atendimento {
  private readonly ultimas = new Map<string, number>();
  private pendentes: Evento[] = [];
  private reenviando: Promise<boolean> | null = null;

  constructor(
    private readonly agente: ClienteAgente,
    private readonly envio: Envio,
    private readonly log: LogPonte = () => {}
  ) {}

  ultimaDoAtendente(telefone: string): number | undefined {
    return this.ultimas.get(telefone);
  }

  temPendentes(): boolean {
    return this.pendentes.length > 0;
  }

  async receberMinha(m: MensagemRecebida): Promise<void> {
    if (m.paraMim) {
      if (this.envio.ehMinha(CHAVE_EU, m.texto)) return;
      await this.tratarComando(m.texto);
      return;
    }
    if (!m.direta || !m.telefone) return;
    if (this.envio.ehMinha(m.telefone, m.texto)) return;
    this.ultimas.set(m.telefone, Date.now());
    this.log({ type: "atendente_assumiu", telefone: m.telefone });
    await this.entregar({
      tipo: "mensagem_atendente",
      telefone: m.telefone,
      id: m.id,
      texto: m.texto.slice(0, LIMITE_TEXTO),
      timestamp: m.timestamp,
    });
  }

  /** Reenvia na ordem; para no primeiro que falhar. */
  reenviarEventos(): Promise<boolean> {
    this.reenviando ??= (async () => {
      try {
        while (this.pendentes.length > 0) {
          if (!(await this.agente.enviarEvento(this.pendentes[0]))) return false;
          this.pendentes.shift();
        }
        return true;
      } finally {
        this.reenviando = null;
      }
    })();
    return this.reenviando;
  }

  private async entregar(evento: Evento): Promise<boolean> {
    this.pendentes.push(evento);
    const ok = await this.reenviarEventos();
    if (!ok) this.log({ type: "evento_pendente", tipo: evento.tipo, telefone: evento.telefone });
    return ok;
  }

  private async tratarComando(texto: string): Promise<void> {
    const comando = interpretarComando(texto);
    if (!comando) return;
    if (comando.tipo === "desconhecido") {
      await this.envio.paraMim(TEXTO_COMANDOS);
      return;
    }
    const ok = await this.entregar({
      tipo: "devolver",
      telefone: comando.telefone,
      ...(comando.nota ? { nota: comando.nota } : {}),
    });
    await this.envio.paraMim(
      ok
        ? `✅ ${comando.telefone} devolvido à IA`
        : `⏳ Agente fora do ar: o #devolver de ${comando.telefone} será reenviado quando ele voltar.`
    );
  }
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/atendente.test.ts` → PASS (10). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/whatsapp/atendente.ts tests/atendente.test.ts
git commit -m "feat(fase-4): atendente pelo chip — detecção, #devolver e eventos pendentes em ordem"
```

---

### Task 11 (A11): Ponte — recepção, lote, entrega, queda do agente e varredura

**Arquivos:**
- Criar: `src/whatsapp/ponte.ts`
- Teste: `tests/ponte.test.ts`

**Interfaces:**
- Consome: tudo de A1–A10.
- Produz: `class Ponte` com `constructor(canal: CanalWhatsApp, agente: ClienteAgente, opcoes: OpcoesPonte, log?: LogPonte)`,
  `iniciar(intervaloVarreduraMs: number): void`, `receber(m: MensagemRecebida): Promise<void>`, `varrer(): Promise<void>`;
  `interface OpcoesPonte { artesDir; liberados: string[]; lote: OpcoesFila; avisoInstabilidadeMs; enviosPorMinuto }`;
  `ESPERA_EM_ANDAMENTO_MS = 5000`, `LIMITE_EM_ANDAMENTO_MS = 120000`, `MSG_AUDIO`, `MSG_INSTABILIDADE`,
  `alertaAgenteFora(minutos)`.

Regras que este arquivo implementa (spec, seções 5 e 6):
- Só marca como lida depois de entregar tudo, só com `modo: "ia"` e só se não houver mensagem nova no buffer.
- Áudio e tipos ignorados marcam como lida só se a conversa não tiver lote pendente nem turno rodando.
- Falha (agente fora, 409 por 120s, evento do atendente pendente): não marca como lida e libera os ids para a varredura.
  Depois de `avisoInstabilidadeMs` desde a primeira falha: aviso ao cliente uma vez por queda e alerta em "Mensagem
  para mim" uma vez. O primeiro sucesso encerra a queda.
- Parte que não sai depois de 2 tentativas: guarda quantas partes já saíram por `turnoId`; na repetição, pula essas.
- Resposta descartada se o atendente escreveu na conversa depois que o lote saiu.

- [ ] **Passo 1: Escrever o teste que falha** — `tests/ponte.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { alertaAgenteFora, MSG_AUDIO, MSG_INSTABILIDADE, Ponte, type OpcoesPonte } from "../src/whatsapp/ponte.js";
import type { ResultadoLote } from "../src/whatsapp/agenteHttp.js";
import { LIMITE_TEXTO } from "../src/contrato/esquemas.js";
import { WhatsAppFalso } from "./helpers/whatsappFalso.js";
import { AgenteFalso } from "./helpers/agenteFalso.js";

const CLIENTE = "5583999990000@c.us";
const TEL = "5583999990000";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function montar(opcoes: Partial<OpcoesPonte> = {}) {
  const canal = new WhatsAppFalso();
  const agente = new AgenteFalso();
  const ponte = new Ponte(canal, agente, {
    artesDir: mkdtempSync(join(tmpdir(), "artes-")),
    liberados: [],
    lote: { silencioMs: 5_000, maxMs: 30_000, maxMensagens: 10 },
    avisoInstabilidadeMs: 600_000,
    enviosPorMinuto: 20,
    ...opcoes,
  });
  canal.aoMensagem((m) => void ponte.receber(m));
  return { canal, agente, ponte };
}

function segurar(agente: AgenteFalso): (r: ResultadoLote) => void {
  let liberar!: (r: ResultadoLote) => void;
  agente.roteiro.push(() => new Promise<ResultadoLote>((r) => (liberar = r)));
  return (r) => liberar(r);
}

describe("Ponte", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("do cliente até a resposta", () => {
    it("três mensagens picadas viram um lote; resposta sai e a conversa é marcada como lida", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi" }));
      await vi.advanceTimersByTimeAsync(1_000);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "quero canecas" }));
      await vi.advanceTimersByTimeAsync(1_000);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "para o natal" }));
      await vi.advanceTimersByTimeAsync(4_900);
      expect(agente.lotes).toHaveLength(0);
      await vi.runAllTimersAsync();

      expect(agente.lotes).toHaveLength(1);
      expect(agente.lotes[0].telefone).toBe(TEL);
      expect(agente.lotes[0].mensagens.map((m) => m.texto)).toEqual(["oi", "quero canecas", "para o natal"]);
      expect(canal.enviadas).toEqual([{ chatId: CLIENTE, texto: "olá" }]);
      expect(canal.lidas).toEqual([CLIENTE]);
      expect(agente.eventos).toEqual([]);
    });

    it("mensagem que chega durante o turno espera o próximo lote; só marca lida no fim", async () => {
      const { canal, agente, ponte } = montar();
      const liberar = segurar(agente);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "primeira" }));
      await vi.advanceTimersByTimeAsync(5_000);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "segunda" }));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(agente.lotes).toHaveLength(1);

      liberar({ tipo: "ok", resposta: { respostas: ["r1"], modo: "ia" } });
      await vi.runAllTimersAsync();

      expect(agente.lotes).toHaveLength(2);
      expect(agente.lotes[1].mensagens.map((m) => m.texto)).toEqual(["segunda"]);
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("409: pergunta de novo a cada 5s com o mesmo turnoId", async () => {
      const { canal, agente, ponte } = montar();
      agente.roteiro.push({ tipo: "em_andamento" }, { tipo: "em_andamento" });
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi" }));
      await vi.runAllTimersAsync();
      expect(agente.lotes).toHaveLength(3);
      expect(new Set(agente.lotes.map((l) => l.turnoId)).size).toBe(1);
      expect(canal.enviadas).toHaveLength(1);
    });

    it("409 por mais de 120s: desiste, não marca como lida e a varredura repete o mesmo turno", async () => {
      const { canal, agente, ponte } = montar();
      agente.padrao = { tipo: "em_andamento" };
      const msg = canal.mensagem({ chatId: CLIENTE, texto: "oi" });
      await ponte.receber(msg);
      await vi.runAllTimersAsync();
      expect(agente.lotes.length).toBeGreaterThanOrEqual(20);
      expect(canal.enviadas).toEqual([]);
      expect(canal.lidas).toEqual([]);

      agente.padrao = { tipo: "ok", resposta: { respostas: ["enfim"], modo: "ia" } };
      canal.naoLidas = [{ chatId: CLIENTE, mensagens: [msg] }];
      await ponte.varrer();
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([{ chatId: CLIENTE, texto: "enfim" }]);
      expect(agente.lotes.at(-1)?.turnoId).toBe(agente.lotes[0].turnoId);
    });

    it("agente fora por mais de 10 min: um aviso ao cliente e um alerta; volta normal depois", async () => {
      const { canal, agente, ponte } = montar();
      agente.padrao = { tipo: "falha", motivo: "http_503" };
      const msg = canal.mensagem({ chatId: CLIENTE, texto: "oi" });
      canal.naoLidas = [{ chatId: CLIENTE, mensagens: [msg] }];
      await ponte.receber(msg);
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([]);

      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(120_000);
        await ponte.varrer();
        await vi.runAllTimersAsync();
      }
      expect(canal.enviadas.filter((e) => e.chatId === CLIENTE).map((e) => e.texto)).toEqual([MSG_INSTABILIDADE]);
      expect(canal.enviadas.filter((e) => e.chatId === canal.eu).map((e) => e.texto)).toEqual([alertaAgenteFora(10)]);
      expect(canal.lidas).toEqual([]);
      expect(agente.eventos).toEqual([]);

      agente.padrao = { tipo: "ok", resposta: { respostas: ["voltei"], modo: "ia" } };
      await ponte.varrer();
      await vi.runAllTimersAsync();
      expect(canal.enviadas.at(-1)).toEqual({ chatId: CLIENTE, texto: "voltei" });
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("parte que não sai: na repetição pula as partes já enviadas", async () => {
      const { canal, agente, ponte } = montar();
      agente.padrao = { tipo: "ok", resposta: { respostas: ["parte 1", "parte 2", "parte 3"], modo: "ia" } };
      canal.falhar.set("parte 2", 2);
      const msg = canal.mensagem({ chatId: CLIENTE, texto: "oi" });
      await ponte.receber(msg);
      await vi.runAllTimersAsync();
      expect(canal.enviadas.map((e) => e.texto)).toEqual(["parte 1"]);
      expect(canal.lidas).toEqual([]);

      canal.naoLidas = [{ chatId: CLIENTE, mensagens: [msg] }];
      await ponte.varrer();
      await vi.runAllTimersAsync();
      expect(canal.enviadas.map((e) => e.texto)).toEqual(["parte 1", "parte 2", "parte 3"]);
      expect(agente.lotes[1].turnoId).toBe(agente.lotes[0].turnoId);
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("resposta em modo humano não marca como lida", async () => {
      const { canal, agente, ponte } = montar();
      agente.padrao = { tipo: "ok", resposta: { respostas: [], modo: "humano" } };
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi" }));
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([]);
      expect(canal.lidas).toEqual([]);
    });

    it("transferência: cliente recebe a resposta e o resumo vai para Mensagem para mim", async () => {
      const { canal, agente, ponte } = montar();
      agente.padrao = {
        tipo: "ok",
        resposta: { respostas: ["Vou te passar para a equipe."], avisoAtendente: "🔔 Transferência", modo: "humano" },
      };
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "quero falar com alguém" }));
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([
        { chatId: CLIENTE, texto: "Vou te passar para a equipe." },
        { chatId: canal.eu, texto: "🔔 Transferência" },
      ]);
      expect(agente.eventos).toEqual([]);
      expect(canal.lidas).toEqual([]);
    });
  });

  describe("atendente", () => {
    it("atendente escreveu durante o turno: a resposta da IA é descartada", async () => {
      const { canal, agente, ponte } = montar();
      const liberar = segurar(agente);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi" }));
      await vi.advanceTimersByTimeAsync(5_000);
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "Oi! Aqui é a Ana", deMim: true }));
      liberar({ tipo: "ok", resposta: { respostas: ["resposta da IA"], modo: "ia" } });
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([]);
      expect(agente.eventos).toEqual([
        expect.objectContaining({ tipo: "mensagem_atendente", telefone: TEL, texto: "Oi! Aqui é a Ana" }),
      ]);
    });

    it("evento pendente segura o lote até o agente receber o evento", async () => {
      const { canal, agente, ponte } = montar();
      agente.eventosFalham = true;
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "assumi", deMim: true }));
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi?" }));
      await vi.runAllTimersAsync();
      expect(agente.lotes).toEqual([]);

      agente.eventosFalham = false;
      await ponte.varrer();
      expect(agente.eventos.map((e) => e.tipo)).toEqual(["mensagem_atendente"]);
    });
  });

  describe("tipos de mensagem", () => {
    // A resposta ao áudio espera o "digitando" (timer): avance o relógio antes de aguardar o receber.
    it("áudio: resposta fixa, não vai ao agente, marca como lida", async () => {
      const { canal, agente, ponte } = montar();
      const recebendo = ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "", tipo: "audio" }));
      await vi.runAllTimersAsync();
      await recebendo;
      expect(canal.enviadas).toEqual([{ chatId: CLIENTE, texto: MSG_AUDIO }]);
      expect(agente.lotes).toEqual([]);
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("áudio com lote pendente não marca como lida", async () => {
      const { canal, ponte } = montar();
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "quero orçamento" }));
      const recebendo = ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "", tipo: "audio" }));
      await vi.advanceTimersByTimeAsync(2_000);
      await recebendo;
      expect(canal.enviadas).toEqual([{ chatId: CLIENTE, texto: MSG_AUDIO }]);
      expect(canal.lidas).toEqual([]);
      await vi.runAllTimersAsync();
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("figurinha e afins: ignorados e marcados como lidos", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "", tipo: "ignorada" }));
      await vi.runAllTimersAsync();
      expect(canal.enviadas).toEqual([]);
      expect(agente.lotes).toEqual([]);
      expect(canal.lidas).toEqual([CLIENTE]);
    });

    it("grupo e mensagem sem telefone resolvido são ignorados", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(canal.mensagem({ chatId: "1203630@g.us", texto: "oi", direta: false, telefone: null }));
      await ponte.receber(canal.mensagem({ chatId: "123@lid", texto: "oi", telefone: null }));
      await vi.runAllTimersAsync();
      expect(agente.lotes).toEqual([]);
      expect(canal.lidas).toEqual([]);
    });

    it("lista de liberados filtra pelo número normalizado", async () => {
      const { canal, agente, ponte } = montar({ liberados: ["558399990000"] });
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "oi" }));
      await ponte.receber(canal.mensagem({ chatId: "5583777770000@c.us", texto: "oi" }));
      await vi.runAllTimersAsync();
      expect(agente.lotes.map((l) => l.telefone)).toEqual([TEL]);
    });

    it("texto longo é cortado em 4.000 caracteres", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(canal.mensagem({ chatId: CLIENTE, texto: "x".repeat(5_000) }));
      await vi.runAllTimersAsync();
      expect(agente.lotes[0].mensagens[0].texto).toHaveLength(LIMITE_TEXTO);
    });

    it("arte aceita vai como arquivo; a legenda vai como texto", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(
        canal.mensagem({
          chatId: CLIENTE,
          texto: "essa é a logo",
          tipo: "midia",
          baixarMidia: async () => ({ mime: "image/png", base64: PNG, nome: "logo.png" }),
        })
      );
      await vi.runAllTimersAsync();
      const m = agente.lotes[0].mensagens[0];
      expect(m.texto).toBe("essa é a logo");
      expect(m.arquivo).toMatchObject({ mime: "image/png", nome: "logo.png" });
    });

    it("arte recusada ou que não baixa vira texto para o agente", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(
        canal.mensagem({
          chatId: CLIENTE,
          texto: "",
          tipo: "midia",
          baixarMidia: async () => ({ mime: "video/mp4", base64: PNG, nome: "video.mp4" }),
        })
      );
      await ponte.receber(
        canal.mensagem({
          chatId: CLIENTE,
          texto: "",
          tipo: "midia",
          baixarMidia: async () => {
            throw new Error("download falhou");
          },
        })
      );
      await vi.runAllTimersAsync();
      expect(agente.lotes[0].mensagens.map((m) => m.texto)).toEqual([
        "[arquivo recusado: video.mp4, formato video/mp4 não aceito (aceitos: PNG, JPG, SVG, PDF)]",
        "[arquivo recusado: arquivo, não foi possível baixar]",
      ]);
      expect(agente.lotes[0].mensagens.every((m) => m.arquivo === undefined)).toBe(true);
    });

    it("recusa com legenda longa continua dentro do limite", async () => {
      const { canal, agente, ponte } = montar();
      await ponte.receber(
        canal.mensagem({
          chatId: CLIENTE,
          texto: "y".repeat(5_000),
          tipo: "midia",
          baixarMidia: async () => ({ mime: "video/mp4", base64: PNG }),
        })
      );
      await vi.runAllTimersAsync();
      expect(agente.lotes[0].mensagens[0].texto.length).toBeLessThanOrEqual(LIMITE_TEXTO);
    });
  });

  describe("varredura", () => {
    it("evento e varredura não duplicam a mesma mensagem", async () => {
      const { canal, agente, ponte } = montar();
      const msg = canal.mensagem({ chatId: CLIENTE, texto: "oi" });
      canal.naoLidas = [{ chatId: CLIENTE, mensagens: [msg] }];
      await ponte.receber(msg);
      await ponte.varrer();
      await vi.runAllTimersAsync();
      expect(agente.lotes).toHaveLength(1);
      expect(agente.lotes[0].mensagens).toHaveLength(1);
    });

    it("mensagem já respondida não volta a ir ao agente", async () => {
      const { canal, agente, ponte } = montar();
      const msg = canal.mensagem({ chatId: CLIENTE, texto: "oi" });
      await ponte.receber(msg);
      await vi.runAllTimersAsync();
      canal.naoLidas = [{ chatId: CLIENTE, mensagens: [msg] }];
      await ponte.varrer();
      await vi.runAllTimersAsync();
      expect(agente.lotes).toHaveLength(1);
    });

    it("varredura que falha não derruba a ponte", async () => {
      const { canal, ponte } = montar();
      canal.pendentes = async () => {
        throw new Error("página travada");
      };
      await expect(ponte.varrer()).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/ponte.test.ts` → FAIL — import de `../src/whatsapp/ponte.js` não resolve.

- [ ] **Passo 3: Implementar** — `src/whatsapp/ponte.ts`

```ts
import {
  LIMITE_TEXTO,
  type MensagemLote,
  type PedidoMensagens,
  type RespostaMensagens,
} from "../contrato/esquemas.js";
import { calcularTurnoId } from "../contrato/turno.js";
import type { ClienteAgente } from "./agenteHttp.js";
import { Atendimento } from "./atendente.js";
import type { CanalWhatsApp, MensagemRecebida, MidiaBaixada } from "./canal.js";
import { Envio, esperar } from "./envio.js";
import { ConjuntoLimitado, FilaConversas, type OpcoesFila } from "./fila.js";
import type { LogPonte } from "./log.js";
import { salvarMidia } from "./midia.js";
import { normalizarTelefone } from "./telefone.js";

export const ESPERA_EM_ANDAMENTO_MS = 5_000;
export const LIMITE_EM_ANDAMENTO_MS = 120_000;
export const MSG_AUDIO = "Ainda não consigo ouvir áudios por aqui 🙏 Pode me mandar por escrito?";
export const MSG_INSTABILIDADE = "Estamos com uma instabilidade agora, mas já te respondemos por aqui. 🙏";

export function alertaAgenteFora(minutos: number): string {
  return `⚠️ O agente não responde há ${minutos} min. Quem escrever recebe o aviso de instabilidade. Veja o terminal do agente.`;
}

export interface OpcoesPonte {
  artesDir: string;
  liberados: string[];
  lote: OpcoesFila;
  avisoInstabilidadeMs: number;
  enviosPorMinuto: number;
}

function juntar(primeira: string, segunda: string): string {
  return (segunda ? `${primeira}\n${segunda}` : primeira).slice(0, LIMITE_TEXTO);
}

export class Ponte {
  private readonly fila: FilaConversas;
  private readonly envio: Envio;
  private readonly atendimento: Atendimento;
  private readonly concluidos = new ConjuntoLimitado(5_000);
  private readonly partesEnviadas = new Map<string, number>();
  private readonly liberados: Set<string>;
  private queda: { desde: number; alertado: boolean; avisados: Set<string> } | null = null;
  private varrendo = false;

  constructor(
    private readonly canal: CanalWhatsApp,
    private readonly agente: ClienteAgente,
    private readonly opcoes: OpcoesPonte,
    private readonly log: LogPonte = () => {}
  ) {
    this.envio = new Envio(canal, opcoes.enviosPorMinuto, log);
    this.atendimento = new Atendimento(agente, this.envio, log);
    this.fila = new FilaConversas(opcoes.lote, (telefone, chatId, mensagens) =>
      this.processarLote(telefone, chatId, mensagens)
    );
    this.liberados = new Set(opcoes.liberados.map(normalizarTelefone));
  }

  iniciar(intervaloVarreduraMs: number): void {
    this.canal.aoMensagem((m) => void this.receber(m));
    this.canal.aoPronto(() => void this.varrer());
    setInterval(() => void this.varrer(), intervaloVarreduraMs);
  }

  async receber(m: MensagemRecebida): Promise<void> {
    try {
      if (m.deMim) await this.atendimento.receberMinha(m);
      else await this.receberDoCliente(m);
    } catch (err) {
      this.log({ type: "erro_ao_receber", id: m.id, erro: String(err) });
    }
  }

  async varrer(): Promise<void> {
    if (this.varrendo) return;
    this.varrendo = true;
    try {
      await this.atendimento.reenviarEventos();
      for (const conversa of await this.canal.pendentes()) {
        for (const m of conversa.mensagens) await this.receber(m);
      }
    } catch (err) {
      this.log({ type: "varredura_falhou", erro: String(err) });
    } finally {
      this.varrendo = false;
    }
  }

  private async receberDoCliente(m: MensagemRecebida): Promise<void> {
    if (!m.direta || !m.telefone || this.concluidos.has(m.id)) return;
    if (this.liberados.size > 0 && !this.liberados.has(m.telefone)) return;
    const telefone = m.telefone;

    if (m.tipo === "audio" || m.tipo === "ignorada") {
      this.concluidos.add(m.id);
      if (m.tipo === "audio") await this.envio.paraCliente(telefone, m.chatId, MSG_AUDIO);
      if (!this.fila.ocupada(telefone)) await this.marcarComoLida(m.chatId);
      return;
    }

    const mensagem: MensagemLote =
      m.tipo === "midia"
        ? await this.mensagemDeMidia(telefone, m)
        : { id: m.id, timestamp: m.timestamp, texto: m.texto.slice(0, LIMITE_TEXTO) };
    this.fila.adicionar(telefone, m.chatId, mensagem);
  }

  private async mensagemDeMidia(telefone: string, m: MensagemRecebida): Promise<MensagemLote> {
    const legenda = m.texto.trim();
    let midia: MidiaBaixada | null = null;
    try {
      midia = (await m.baixarMidia?.()) ?? null;
    } catch (err) {
      this.log({ type: "midia_nao_baixou", id: m.id, erro: String(err) });
    }
    if (!midia) {
      return { id: m.id, timestamp: m.timestamp, texto: juntar("[arquivo recusado: arquivo, não foi possível baixar]", legenda) };
    }
    const salvo = salvarMidia(this.opcoes.artesDir, telefone, m.id, midia);
    if (!salvo.ok) {
      return { id: m.id, timestamp: m.timestamp, texto: juntar(`[arquivo recusado: ${salvo.nome}, ${salvo.motivo}]`, legenda) };
    }
    return { id: m.id, timestamp: m.timestamp, texto: legenda.slice(0, LIMITE_TEXTO), arquivo: salvo.arquivo };
  }

  private async processarLote(telefone: string, chatId: string, mensagens: MensagemLote[]): Promise<void> {
    const pedido: PedidoMensagens = { turnoId: calcularTurnoId(mensagens.map((m) => m.id)), telefone, mensagens };
    const inicio = Date.now();
    if (!(await this.atendimento.reenviarEventos())) {
      return this.falhou(telefone, chatId, pedido, "eventos_do_atendente_pendentes");
    }
    await this.canal.digitando(chatId).catch(() => {});
    for (;;) {
      const r = await this.agente.enviarLote(pedido);
      if (r.tipo === "ok") {
        this.queda = null;
        return this.entregar(telefone, chatId, pedido, r.resposta, inicio);
      }
      if (r.tipo === "em_andamento" && Date.now() - inicio + ESPERA_EM_ANDAMENTO_MS <= LIMITE_EM_ANDAMENTO_MS) {
        await esperar(ESPERA_EM_ANDAMENTO_MS);
        continue;
      }
      return this.falhou(telefone, chatId, pedido, r.tipo === "falha" ? r.motivo : "em_andamento_por_120s");
    }
  }

  private async entregar(
    telefone: string,
    chatId: string,
    pedido: PedidoMensagens,
    resposta: RespostaMensagens,
    inicio: number
  ): Promise<void> {
    const ids = pedido.mensagens.map((m) => m.id);
    const atendente = this.atendimento.ultimaDoAtendente(telefone);
    if (atendente !== undefined && atendente >= inicio) {
      this.concluir(ids);
      this.log({ type: "resposta_descartada", turnoId: pedido.turnoId, motivo: "atendente_assumiu" });
      return;
    }

    for (let i = this.partesEnviadas.get(pedido.turnoId) ?? 0; i < resposta.respostas.length; i++) {
      if (!(await this.envio.paraCliente(telefone, chatId, resposta.respostas[i]))) {
        this.partesEnviadas.set(pedido.turnoId, i);
        this.fila.esquecer(ids);
        this.log({ type: "entrega_interrompida", turnoId: pedido.turnoId, parte: i });
        return;
      }
    }
    this.partesEnviadas.delete(pedido.turnoId);
    if (resposta.avisoAtendente) await this.envio.paraMim(resposta.avisoAtendente);
    this.concluir(ids);
    this.log({ type: "lote_entregue", turnoId: pedido.turnoId, partes: resposta.respostas.length, modo: resposta.modo });
    if (resposta.modo === "ia" && !this.fila.temNoBuffer(telefone)) await this.marcarComoLida(chatId);
  }

  private async falhou(telefone: string, chatId: string, pedido: PedidoMensagens, motivo: string): Promise<void> {
    this.fila.esquecer(pedido.mensagens.map((m) => m.id));
    this.log({ type: "lote_falhou", turnoId: pedido.turnoId, motivo });
    const agora = Date.now();
    this.queda ??= { desde: agora, alertado: false, avisados: new Set() };
    if (agora - this.queda.desde < this.opcoes.avisoInstabilidadeMs) return;
    if (!this.queda.avisados.has(telefone)) {
      this.queda.avisados.add(telefone);
      await this.envio.paraCliente(telefone, chatId, MSG_INSTABILIDADE);
    }
    if (!this.queda.alertado) {
      this.queda.alertado = true;
      await this.envio.paraMim(alertaAgenteFora(Math.round(this.opcoes.avisoInstabilidadeMs / 60_000)));
    }
  }

  private concluir(ids: string[]): void {
    for (const id of ids) this.concluidos.add(id);
    this.fila.esquecer(ids);
  }

  private async marcarComoLida(chatId: string): Promise<void> {
    await this.canal.marcarComoLida(chatId).catch((err) => this.log({ type: "marcar_lida_falhou", erro: String(err) }));
  }
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/ponte.test.ts` → PASS (22 testes).
Se o teste "agente fora por mais de 10 min" falhar por contagem de tempo, **não mexa nos números do teste**: confira
se `falhou` usa a hora da primeira falha (`queda.desde`) e se `queda` volta a `null` só no sucesso.
Rode: `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/whatsapp/ponte.ts tests/ponte.test.ts
git commit -m "feat(fase-4): ponte — lote, entrega em partes, queda do agente e varredura das não lidas"
```

---

### Task 12 (A12): Sessão do whatsapp-web.js, entrada da ponte e lançador

**Arquivos:**
- Criar: `src/whatsapp/saude.ts`, `src/whatsapp/sessao.ts`, `src/whatsapp/index.ts`, `scripts/whatsapp.ts`
- Modificar: `package.json`, `package-lock.json` (via npm), `.env.example`
- Teste: `tests/saude.test.ts`

**Interfaces:**
- Consome: `CanalWhatsApp`, `MensagemRecebida`, `ConversaPendente`, `TipoMensagem` (A6); `normalizarTelefone`,
  `ehConversaDireta` (A6); `Ponte` (A11); `criarClienteHttp` (A3); `criarLogPonte` (A6); `config` (A1).
- Produz: `decidirSaude(estado: string | null, s: EstadoSaude): "ok" | "aguardar" | "reconectar" | "desvinculado"`,
  `novoEstadoSaude()`, `tipoDaMensagem(tipo: string): TipoMensagem`; `class CanalWwebjs implements CanalWhatsApp` com
  `iniciar()`; scripts `npm run whatsapp`, `npm run whatsapp:ponte`.

As defesas vêm do LembreMe (`C:\Users\joao_\dev\DC Tech\LembreMe\LembreMe\index.mjs:648-1000`), reescritas:
vigia de "pronto" de 90s após `authenticated` (troca a versão e relança); verificação de saúde a cada 5 min com 3
leituras ruins seguidas antes de agir; batimento (`pupPage.evaluate`) a cada 2 min, 3 falhas = página zumbi; `UNPAIRED`
confirmado 3 vezes → para e avisa, sem loop de QR; reconexão sempre por `destroy()` + novo cliente, com trava, **nunca
`logout()`**; `disconnected` com `getState()` ainda `CONNECTED` é falso alarme.

- [ ] **Passo 1: Instalar as dependências**

```bash
npm install whatsapp-web.js@1.34.7 qrcode-terminal@0.12.0 --save-exact
npm install -D @types/qrcode-terminal@0.12.2 --save-exact
```

Esperado: `package.json` ganha as três entradas. O puppeteer baixa um Chrome (~170 MB) na primeira vez.

- [ ] **Passo 2: Escrever o teste que falha** — `tests/saude.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { decidirSaude, novoEstadoSaude, tipoDaMensagem } from "../src/whatsapp/saude.js";

describe("decidirSaude", () => {
  it("CONNECTED é ok", () => {
    expect(decidirSaude("CONNECTED", novoEstadoSaude())).toBe("ok");
  });

  it("estado ruim só reconecta na 3ª leitura seguida e zera a contagem", () => {
    const s = novoEstadoSaude();
    expect(decidirSaude(null, s)).toBe("aguardar");
    expect(decidirSaude("OPENING", s)).toBe("aguardar");
    expect(decidirSaude("TIMEOUT", s)).toBe("reconectar");
    expect(s.naoSaudaveis).toBe(0);
  });

  it("uma leitura boa no meio zera a contagem", () => {
    const s = novoEstadoSaude();
    decidirSaude(null, s);
    decidirSaude(null, s);
    expect(decidirSaude("CONNECTED", s)).toBe("ok");
    expect(decidirSaude(null, s)).toBe("aguardar");
  });

  it("UNPAIRED confirmado 3 vezes → desvinculado, e depois disso nunca tenta de novo", () => {
    const s = novoEstadoSaude();
    expect(decidirSaude("UNPAIRED", s)).toBe("aguardar");
    expect(decidirSaude("UNPAIRED_IDLE", s)).toBe("aguardar");
    expect(decidirSaude("UNPAIRED", s)).toBe("desvinculado");
    expect(decidirSaude(null, s)).toBe("aguardar");
    expect(decidirSaude(null, s)).toBe("aguardar");
    expect(decidirSaude(null, s)).toBe("aguardar");
  });

  it("CONNECTED com 3 batimentos falhos é página zumbi → reconectar", () => {
    const s = novoEstadoSaude();
    s.falhasBatimento = 3;
    expect(decidirSaude("CONNECTED", s)).toBe("reconectar");
    expect(s.falhasBatimento).toBe(0);
  });
});

describe("tipoDaMensagem", () => {
  it("mapeia os tipos do whatsapp-web.js", () => {
    expect(tipoDaMensagem("chat")).toBe("texto");
    expect(tipoDaMensagem("image")).toBe("midia");
    expect(tipoDaMensagem("document")).toBe("midia");
    expect(tipoDaMensagem("video")).toBe("midia");
    expect(tipoDaMensagem("ptt")).toBe("audio");
    expect(tipoDaMensagem("audio")).toBe("audio");
    for (const t of ["sticker", "location", "vcard", "multi_vcard", "revoked", "reaction", "e2e_notification", "poll_creation"]) {
      expect(tipoDaMensagem(t)).toBe("ignorada");
    }
  });
});
```

- [ ] **Passo 3: Rodar e ver falhar**

Rode: `npx vitest run tests/saude.test.ts` → FAIL — import não resolve.

- [ ] **Passo 4: Implementar**

`src/whatsapp/saude.ts`:

```ts
import type { TipoMensagem } from "./canal.js";

export const LIMITE_NAO_SAUDAVEL = 3;
export const LIMITE_FALHAS_BATIMENTO = 3;

export interface EstadoSaude {
  naoSaudaveis: number;
  falhasBatimento: number;
  desvinculado: boolean;
}

export type DecisaoSaude = "ok" | "aguardar" | "reconectar" | "desvinculado";

export function novoEstadoSaude(): EstadoSaude {
  return { naoSaudaveis: 0, falhasBatimento: 0, desvinculado: false };
}

export function decidirSaude(estadoWhatsApp: string | null, s: EstadoSaude): DecisaoSaude {
  if (s.desvinculado) return "aguardar";
  if (estadoWhatsApp === "UNPAIRED" || estadoWhatsApp === "UNPAIRED_IDLE") {
    s.naoSaudaveis += 1;
    if (s.naoSaudaveis < LIMITE_NAO_SAUDAVEL) return "aguardar";
    s.desvinculado = true;
    return "desvinculado";
  }
  if (estadoWhatsApp !== "CONNECTED") {
    s.naoSaudaveis += 1;
    if (s.naoSaudaveis < LIMITE_NAO_SAUDAVEL) return "aguardar";
    s.naoSaudaveis = 0;
    return "reconectar";
  }
  s.naoSaudaveis = 0;
  if (s.falhasBatimento >= LIMITE_FALHAS_BATIMENTO) {
    s.falhasBatimento = 0;
    return "reconectar";
  }
  return "ok";
}

export function tipoDaMensagem(tipo: string): TipoMensagem {
  switch (tipo) {
    case "chat":
      return "texto";
    case "image":
    case "document":
    case "video":
      return "midia";
    case "ptt":
    case "audio":
      return "audio";
    default:
      return "ignorada";
  }
}
```

`src/whatsapp/sessao.ts`:

```ts
import { createRequire } from "module";
import wwebjs from "whatsapp-web.js";
import type { Message } from "whatsapp-web.js";
import type { CanalWhatsApp, ConversaPendente, MensagemRecebida } from "./canal.js";
import type { LogPonte } from "./log.js";
import { decidirSaude, novoEstadoSaude, tipoDaMensagem, type EstadoSaude } from "./saude.js";
import { ehConversaDireta, normalizarTelefone } from "./telefone.js";

const { Client, LocalAuth } = wwebjs;
type ClienteWhatsApp = InstanceType<typeof Client>;
// Os tipos de qrcode-terminal não têm export default; o require devolve o module.exports do CJS.
const qrcode = createRequire(import.meta.url)("qrcode-terminal") as typeof import("qrcode-terminal");

const PRONTO_TIMEOUT_MS = 90_000;
const SAUDE_INTERVALO_MS = 5 * 60_000;
const BATIMENTO_INTERVALO_MS = 2 * 60_000;
const VERSOES_REMOTAS = "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html";

export interface OpcoesSessao {
  sessaoDir: string;
  parearTelefone?: string;
  versaoWeb?: string;
  log: LogPonte;
}

function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<T>((_, rejeitar) => setTimeout(() => rejeitar(new Error("prazo esgotado")), ms)),
  ]);
}

export class CanalWwebjs implements CanalWhatsApp {
  private cliente: ClienteWhatsApp | null = null;
  private aoMensagemHandler: (m: MensagemRecebida) => void = () => {};
  private aoProntoHandler: () => void = () => {};
  private readonly versoes: Array<string | undefined>;
  private indiceVersao = 0;
  private reconectando = false;
  private vigiasInstalados = false;
  private saude: EstadoSaude = novoEstadoSaude();
  private meuWid = "";
  private meuTelefone = "";
  private readonly telefonesPorLid = new Map<string, string>();

  constructor(private readonly opcoes: OpcoesSessao) {
    this.versoes = opcoes.versaoWeb ? [opcoes.versaoWeb, undefined] : [undefined];
  }

  aoMensagem(handler: (m: MensagemRecebida) => void): void {
    this.aoMensagemHandler = handler;
  }

  aoPronto(handler: () => void): void {
    this.aoProntoHandler = handler;
  }

  meuChatId(): string {
    return this.meuWid;
  }

  async iniciar(): Promise<void> {
    await this.lancar();
    this.instalarVigias();
  }

  async enviar(chatId: string, texto: string): Promise<void> {
    // Sem sendSeen: false a biblioteca marca a conversa como lida a cada envio.
    await this.exigirCliente().sendMessage(chatId, texto, { sendSeen: false });
  }

  async digitando(chatId: string): Promise<void> {
    const chat = await this.exigirCliente().getChatById(chatId);
    await chat.sendStateTyping();
  }

  async marcarComoLida(chatId: string): Promise<void> {
    await this.exigirCliente().sendSeen(chatId);
  }

  async pendentes(): Promise<ConversaPendente[]> {
    const resultado: ConversaPendente[] = [];
    for (const chat of await this.exigirCliente().getChats()) {
      const chatId = chat.id._serialized;
      if (chat.isGroup || chat.unreadCount <= 0 || !ehConversaDireta(chatId)) continue;
      const recentes = await chat.fetchMessages({ limit: Math.min(chat.unreadCount + 20, 100) });
      const doCliente = recentes.filter((m) => !m.fromMe).slice(-chat.unreadCount);
      const mensagens = await Promise.all(doCliente.map((m) => this.converter(m)));
      if (mensagens.length > 0) resultado.push({ chatId, mensagens });
    }
    return resultado;
  }

  private exigirCliente(): ClienteWhatsApp {
    if (!this.cliente) throw new Error("WhatsApp não está conectado");
    return this.cliente;
  }

  private async lancar(): Promise<void> {
    const versao = this.versoes[this.indiceVersao];
    const cliente = new Client({
      authStrategy: new LocalAuth({ dataPath: this.opcoes.sessaoDir, clientId: "presentes-especiais" }),
      puppeteer: { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] },
      ...(versao
        ? { webVersion: versao, webVersionCache: { type: "remote" as const, remotePath: VERSOES_REMOTAS, strict: false } }
        : {}),
      ...(this.opcoes.parearTelefone
        ? { pairWithPhoneNumber: { phoneNumber: this.opcoes.parearTelefone, showNotification: true } }
        : {}),
    });
    this.cliente = cliente;
    let pronto = false;
    let vigiaPronto: ReturnType<typeof setTimeout> | undefined;

    cliente.on("qr", (qr) => {
      console.log("Escaneie o QR com o celular do chip (WhatsApp → Aparelhos conectados → Conectar aparelho):");
      qrcode.generate(qr, { small: true });
    });
    cliente.on("code", (codigo) => {
      console.log(`Código de pareamento: ${codigo} (WhatsApp → Aparelhos conectados → Conectar com número de telefone)`);
    });
    cliente.on("authenticated", () => {
      if (vigiaPronto) clearTimeout(vigiaPronto);
      vigiaPronto = setTimeout(() => {
        if (!pronto) void this.trocarVersao(cliente);
      }, PRONTO_TIMEOUT_MS);
    });
    cliente.on("ready", () => {
      pronto = true;
      if (vigiaPronto) clearTimeout(vigiaPronto);
      this.meuWid = cliente.info.wid._serialized;
      this.meuTelefone = normalizarTelefone(cliente.info.wid.user);
      this.saude = novoEstadoSaude();
      console.log(`WhatsApp pronto (${this.meuTelefone}).`);
      this.aoProntoHandler();
    });
    cliente.on("auth_failure", (mensagem) => this.opcoes.log({ type: "auth_failure", mensagem }));
    cliente.on("message_create", (msg) => {
      this.converter(msg)
        .then((m) => this.aoMensagemHandler(m))
        .catch((err) => this.opcoes.log({ type: "mensagem_nao_convertida", erro: String(err) }));
    });
    cliente.on("disconnected", (motivo) => void this.aoDesconectar(cliente, String(motivo)));

    await cliente.initialize();
  }

  private async converter(msg: Message): Promise<MensagemRecebida> {
    const chatId = msg.fromMe ? msg.to : msg.from;
    const direta = ehConversaDireta(chatId, msg.author);
    const telefone = direta ? await this.resolverTelefone(chatId) : null;
    const tipo = tipoDaMensagem(msg.type);
    const recebida: MensagemRecebida = {
      id: msg.id._serialized,
      chatId,
      telefone,
      deMim: msg.fromMe,
      paraMim: msg.fromMe && telefone !== null && telefone === this.meuTelefone,
      direta,
      tipo,
      texto: msg.body ?? "",
      timestamp: new Date((msg.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    };
    if (tipo === "midia") {
      recebida.baixarMidia = async () => {
        const midia = await msg.downloadMedia();
        if (!midia) return null;
        return { mime: midia.mimetype, base64: midia.data, ...(midia.filename ? { nome: midia.filename } : {}) };
      };
    }
    return recebida;
  }

  private async resolverTelefone(chatId: string): Promise<string | null> {
    if (chatId.endsWith("@c.us")) return normalizarTelefone(chatId.split("@")[0]);
    const conhecido = this.telefonesPorLid.get(chatId);
    if (conhecido) return conhecido;
    try {
      const [par] = await this.exigirCliente().getContactLidAndPhone([chatId]);
      if (par?.pn) {
        const telefone = normalizarTelefone(par.pn.split("@")[0]);
        this.telefonesPorLid.set(chatId, telefone);
        return telefone;
      }
    } catch (err) {
      this.opcoes.log({ type: "lid_sem_telefone", erro: String(err) });
    }
    return null;
  }

  private instalarVigias(): void {
    if (this.vigiasInstalados) return;
    this.vigiasInstalados = true;
    setInterval(() => void this.verificarSaude(), SAUDE_INTERVALO_MS);
    setInterval(() => void this.batimento(), BATIMENTO_INTERVALO_MS);
  }

  private async verificarSaude(): Promise<void> {
    if (this.reconectando) return;
    const estado = this.cliente ? await comPrazo(this.cliente.getState(), 5_000).catch(() => null) : null;
    const decisao = decidirSaude(estado, this.saude);
    if (decisao === "desvinculado") {
      console.error("🚨 WhatsApp DESVINCULADO. A ponte parou de tentar: suba de novo e escaneie o QR (ou use WHATSAPP_PAREAR_TELEFONE).");
    } else if (decisao === "reconectar") {
      await this.reconectar("verificação de saúde");
    }
  }

  private async batimento(): Promise<void> {
    const pagina = this.cliente?.pupPage;
    if (this.reconectando || !pagina) return;
    try {
      await comPrazo(pagina.evaluate(() => true), 10_000);
      this.saude.falhasBatimento = 0;
    } catch {
      this.saude.falhasBatimento += 1;
      this.opcoes.log({ type: "batimento_falhou", falhas: this.saude.falhasBatimento });
    }
  }

  private async reconectar(motivo: string): Promise<void> {
    if (this.reconectando) return;
    this.reconectando = true;
    console.warn(`Reconectando o WhatsApp (${motivo})…`);
    try {
      const antigo = this.cliente;
      this.cliente = null;
      // destroy(), nunca logout(): logout apaga a sessão e obriga a escanear o QR de novo.
      if (antigo) await antigo.destroy().catch(() => {});
      await this.lancar();
    } catch (err) {
      this.opcoes.log({ type: "reconexao_falhou", erro: String(err) });
    } finally {
      this.reconectando = false;
    }
  }

  private async trocarVersao(cliente: ClienteWhatsApp): Promise<void> {
    if (this.cliente !== cliente) return;
    this.indiceVersao = (this.indiceVersao + 1) % this.versoes.length;
    await this.reconectar(`autenticou mas não ficou pronta em ${PRONTO_TIMEOUT_MS / 1000}s`);
  }

  private async aoDesconectar(cliente: ClienteWhatsApp, motivo: string): Promise<void> {
    const estado = await comPrazo(cliente.getState(), 4_000).catch(() => null);
    if (estado === "CONNECTED") return;
    if (motivo === "LOGOUT" || estado === "UNPAIRED") {
      this.saude.desvinculado = true;
      console.error("🚨 WhatsApp desvinculado pelo celular. Suba de novo e escaneie o QR.");
      return;
    }
    setTimeout(() => {
      if (this.cliente === cliente) void this.reconectar(`desconectado: ${motivo}`);
    }, 5_000);
  }
}
```

`src/whatsapp/index.ts`:

```ts
import "dotenv/config";
import { config } from "../config.js";
import { criarClienteHttp } from "./agenteHttp.js";
import { criarLogPonte } from "./log.js";
import { Ponte } from "./ponte.js";
import { CanalWwebjs } from "./sessao.js";

async function main(): Promise<void> {
  const w = config.whatsapp;
  const log = criarLogPonte();
  const canal = new CanalWwebjs({
    sessaoDir: w.sessaoDir,
    log,
    ...(w.parearTelefone ? { parearTelefone: w.parearTelefone } : {}),
    ...(w.versaoWeb ? { versaoWeb: w.versaoWeb } : {}),
  });
  const ponte = new Ponte(
    canal,
    criarClienteHttp(config.agente.url, w.agenteTimeoutMs),
    {
      artesDir: w.artesDir,
      liberados: w.liberados,
      lote: { silencioMs: w.loteSilencioMs, maxMs: w.loteMaxMs, maxMensagens: w.loteMaxMensagens },
      avisoInstabilidadeMs: w.avisoInstabilidadeMin * 60_000,
      enviosPorMinuto: w.enviosPorMinuto,
    },
    log
  );
  ponte.iniciar(w.varreduraMs);
  if (w.liberados.length > 0) console.log(`Respondendo só a: ${w.liberados.join(", ")}`);
  await canal.iniciar();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`scripts/whatsapp.ts`:

```ts
import "dotenv/config";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { config } from "../src/config.js";

const AGENTES: Record<string, string[]> = {
  api: ["src/api/index.ts"],
  direto: ["src/duble/index.ts", "--modo", "direto"],
  eco: ["src/duble/index.ts", "--modo", "eco"],
};
const AGENTE_PADRAO = "direto";

function argumento(nome: string, padrao: string): string {
  const i = process.argv.indexOf(nome);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function subir(args: string[]): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", ...args], { stdio: "inherit" });
}

async function esperarAgente(tentativas = 120): Promise<boolean> {
  for (let i = 0; i < tentativas; i++) {
    try {
      if ((await fetch(`${config.agente.url}/api/health`)).ok) return true;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

async function main(): Promise<void> {
  const qual = argumento("--agente", AGENTE_PADRAO);
  const args = AGENTES[qual];
  if (!args) {
    console.error(`--agente inválido: ${qual} (use ${Object.keys(AGENTES).join(", ")})`);
    process.exit(1);
  }
  if (!existsSync(args[0])) {
    console.error(`${args[0]} ainda não existe nesta branch.`);
    process.exit(1);
  }
  const agente = subir(args);
  if (!(await esperarAgente())) {
    console.error("O agente não respondeu em /api/health em 2 min.");
    agente.kill();
    process.exit(1);
  }
  const ponte = subir(["src/whatsapp/index.ts"]);
  const encerrar = (codigo: number | null) => {
    agente.kill();
    ponte.kill();
    process.exit(codigo ?? 0);
  };
  agente.on("exit", encerrar);
  ponte.on("exit", encerrar);
  process.on("SIGINT", () => encerrar(0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`package.json` — em `"scripts"`, acrescente:

```json
    "whatsapp": "tsx scripts/whatsapp.ts",
    "whatsapp:ponte": "tsx src/whatsapp/index.ts",
```

`.env.example` — no fim do arquivo, acrescente:

```
# --- WhatsApp (Fase 4) ---
AGENTE_PORTA=3030
AGENTE_URL=http://127.0.0.1:3030
WHATSAPP_SESSAO_DIR=data/whatsapp-sessao
# Preencha (só dígitos, com DDI) para parear por código de 8 dígitos em vez de QR
WHATSAPP_PAREAR_TELEFONE=
# Versão do WhatsApp Web para tentar primeiro (vazio = a mais recente)
WHATSAPP_WEB_VERSAO=
# Vazio = responde qualquer número. Lista separada por vírgula restringe (use no primeiro teste)
WHATSAPP_LIBERADOS=
ARTES_DIR=data/artes
LOTE_SILENCIO_MS=5000
LOTE_MAX_MS=30000
LOTE_MAX_MENSAGENS=10
AGENTE_TIMEOUT_MS=120000
AVISO_INSTABILIDADE_MIN=10
ENVIOS_POR_MINUTO=20
VARREDURA_MS=120000
```

- [ ] **Passo 5: Rodar e ver passar**

Rode: `npx vitest run tests/saude.test.ts` → PASS (6). `npm test && npm run typecheck` → verde.
Se o `typecheck` reclamar dos tipos do whatsapp-web.js num `on(...)`, confira o nome do evento contra
`node_modules/whatsapp-web.js/index.d.ts` (seção `on(event: '…'`); não troque por `any`.

- [ ] **Passo 6: Fumaça (sem celular)**

Rode: `npm run whatsapp -- --agente eco`
Esperado, nesta ordem: `Dublê do agente (eco) em http://127.0.0.1:3030`, depois o QR no terminal. Pare com Ctrl+C
sem escanear. Confira que `data/whatsapp-sessao/` foi criada e não está no `git status`.

- [ ] **Passo 7: Commit**

```bash
git add src/whatsapp/saude.ts src/whatsapp/sessao.ts src/whatsapp/index.ts scripts/whatsapp.ts tests/saude.test.ts package.json package-lock.json .env.example
git commit -m "feat(fase-4): sessão whatsapp-web.js com as defesas do LembreMe, entrada da ponte e npm run whatsapp"
```

---

### Task 13 (A13): Primeiro teste no chip (manual, com o dublê `direto`)

Sem código novo. Quem conduz é o João; o celular do chip precisa estar à mão (ou o código de pareamento).

- [ ] **Passo 1: Preparar o `.env` local** (não versionado). Confira ou acrescente:

```
BRINDEME_MODE=http
ORCAMENTO_ESCRITA=simulada
STORE_NAME=Presentes Especiais
KB_INCLUIR_RASCUNHOS=true
WHATSAPP_LIBERADOS=<o seu número pessoal, só dígitos com DDI>
```

`WHATSAPP_LIBERADOS` restringe o primeiro teste ao seu número; esvazie só para o dogfooding completo.

- [ ] **Passo 2: Índice do catálogo** — se `data/produtos-index.json` não existir: `npm run sync:catalogo` (só leitura;
  a primeira carga leva minutos).

- [ ] **Passo 3: Subir** — `npm run whatsapp -- --agente direto`. O terminal mostra o estado da base de conhecimento,
  `escrita de orçamento: simulada` e o QR. Escaneie com o celular do chip.

- [ ] **Passo 4: Roteiro curto** (do seu número pessoal para o chip):

| # | Ação | Esperado |
|---|---|---|
| 1 | "oi" | Resposta da Lia; a conversa fica lida no celular do chip |
| 2 | "quero" / "50 canecas" / "pro natal" em menos de 5s | Uma resposta só |
| 3 | Mandar uma imagem PNG e um vídeo | Arte reconhecida; vídeo recusado com explicação |
| 4 | Mandar um áudio | Resposta fixa pedindo texto |
| 5 | Responder pelo celular do chip, na conversa | A IA fica quieta nas mensagens seguintes |
| 6 | Em "Mensagem para mim": `#devolver <seu número>` | "✅ … devolvido à IA"; a próxima mensagem sua é respondida |
| 7 | Em "Mensagem para mim": `#ajuda` | Lista de comandos |
| 8 | Pedir um orçamento até o fim | Código `TESTE-…`; nada aparece no painel da loja |

- [ ] **Passo 5: Registrar** em `docs/dogfooding-fase-4.md` (crie o arquivo) uma seção `## Rodada 1 — dublê direto
  (AAAA-MM-DD)` com a tabela acima e as colunas Observado e Print (nome do arquivo). Falhas seguem a seção 7.D da spec:
  viram issue só depois que o João revisar a lista.

- [ ] **Passo 6: Commit**

```bash
git add docs/dogfooding-fase-4.md
git commit -m "docs(fase-4): rodada 1 do teste no chip com o dublê direto"
```

---

## Entrega ao Gui

O que vai para ele quando o Pacote A estiver fechado:
- a branch `fase-4-integracao-whatsapp` (o João decide quando pushar);
- `docs/superpowers/plans/2026-10-14-fase-4-pacote-b-agente.md`;
- a bateria `tests/helpers/bateriaContrato.ts`: a API definitiva está pronta quando passar nela;
- o resultado da rodada 1 em `docs/dogfooding-fase-4.md`.
