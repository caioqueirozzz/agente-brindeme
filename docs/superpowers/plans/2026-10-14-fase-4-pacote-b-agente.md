# Fase 4 — Pacote B (API definitiva do agente) — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans para executar este plano task a task. Os passos usam checkbox (`- [ ]`).

**Objetivo:** Trocar o dublê do agente pela API definitiva — estado por telefone em arquivo, turno com chave única,
cancelamento real em 90s, desfazer turno que falha, correções do agente — e fechar a fase com a verificação real e o
dogfooding no chip.

**Arquitetura:** A API definitiva é uma classe `AgenteDefinitivo` que implementa a interface `Agente`
(`src/contrato/agente.ts`, do Pacote A) e é servida pelo mesmo `criarServidorAgente`. A ponte não muda. O estado de
cada conversa vive em `data/conversas/<telefone>.json` (`src/conversas/`). O `runTurn` ganha cancelamento por
`AbortSignal`, um gancho depois de ferramenta com efeito e o resumo da transferência no resultado.

**Stack:** Node ≥ 20, TypeScript ESM (`tsx`), vitest 2, zod 3, `@anthropic-ai/sdk` 0.36.

**Spec:** `docs/superpowers/specs/2026-10-14-fase-4-whatsapp-design.md`. **Pré-requisito:** Pacote A
(`docs/superpowers/plans/2026-10-14-fase-4-pacote-a-ponte.md`) concluído na mesma branch.

## Para quem chega sem contexto

- **Repo:** `C:\Users\joao_\dev\DC Tech\Presentes Especiais\repo-agente-brindeme` (GitHub `caioqueirozzz/agente-brindeme`).
- **Branch:** `fase-4-integracao-whatsapp`, com o Pacote A já commitado. Não troque de branch e não faça rebase.
- **Antes da Task B1:** `npm test` e `npm run typecheck` verdes. Confira que existem `src/contrato/agente.ts`,
  `src/contrato/servidorHttp.ts`, `tests/helpers/bateriaContrato.ts` e `tests/helpers/llmRoteirizado.ts`; se faltar
  algum, o Pacote A não terminou — pare e avise.
- **O que o Pacote A deixou:** `Agente` (`processarLote`, `processarEvento`), `TurnoEmAndamentoError`, schemas do
  contrato, `loteParaTexto`, `formatarParaWhatsApp`, `calcularTurnoId`, `EscritaSimuladaClient` (orçamento TESTE), o
  dublê `direto` (`src/duble/direto.ts`, referência de como chamar o `runTurn`) e o lançador `npm run whatsapp`.
- **Shell:** Git Bash no Windows.

## Restrições globais

- Nunca `git push`, nunca abrir PR. Commit local ao fim de cada task.
- Nunca commitar `.env`, `data/` ou `logs/`. Credenciais da loja nunca vão para arquivo versionado.
- Código, nomes e mensagens em português. Imports relativos terminam em `.js`.
- Comentário só para armadilha. O porquê vai na mensagem de commit.
- Números padrão: teto do turno 90s (`TURNO_TETO_MS`); 30 respostas por hora por telefone (`RESPOSTAS_POR_HORA`);
  2 falhas do mesmo lote → transferência `falha_sistema`; últimos 20 turnos e 200 ids guardados por conversa;
  sync do catálogo ao subir e a cada 6h.
- O agente nunca grava orçamento real na loja enquanto `ORCAMENTO_ESCRITA` não for `real`.
- Ao fim de cada task: `npm test` e `npm run typecheck` verdes.
- Mensagem de commit `feat(fase-4): …` / `fix(fase-4): …` / `test(fase-4): …`; acrescente o trailer de atribuição que a
  sua ferramenta exigir.

## Foco de revisão

1. O atendente devolve a conversa depois de uma transferência por limite: a IA volta a responder, sem o contador antigo
   transferir de novo (Task B5, teste "devolver depois do limite").
2. O mesmo lote repetido depois de uma falha do Claude não duplica a mensagem no histórico nem o arquivo recebido
   (Task B5, teste "repetir o lote depois de falha").
3. O atendente assume enquanto um turno roda: o turno termina, mas a conversa fica em `humano` em memória e no disco
   (Task B5, teste "evento durante o turno").
4. Arquivo de estado de outro telefone ou de formato antigo é tratado como corrompido, sem derrubar o agente (Task B1).
5. O modelo devolve texto vazio: `respostas: []`, sem quebrar o contrato (Task B5, teste "resposta vazia").

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/conversas/repositorio.ts` | `RepositorioConversas`: um arquivo por telefone, tmp + rename, corrompido → renomeia |
| `src/llm/types.ts`, `src/llm/anthropic.ts` (modifica) | `signal` até o SDK |
| `src/agent/runTurn.ts` (modifica) | Cancelamento, `aoEfeito`, `transferencia` e `lacunas` no resultado |
| `src/logging/logger.ts` (modifica) | Contexto fixo por linha (`turnoId`) |
| `src/tools/transferirHumano.ts` (modifica) | `ResumoTransferencia` exportado; `listAdmins` que falha não impede a transferência |
| `src/tools/registrarArte.ts`, `src/agent/state.ts`, `src/tools/index.ts` (modificam) | Arte casada com o arquivo que chegou pelo WhatsApp |
| `src/config.ts`, `.env.example` (modificam) | `STORE_NAME` padrão; chaves do agente |
| `src/api/resumoAtendente.ts` | Texto do aviso de transferência para "Mensagem para mim" |
| `src/api/agenteDefinitivo.ts` | `AgenteDefinitivo implements Agente` |
| `src/api/index.ts` | Entrada da API (`npm run agente`) |
| `scripts/whatsapp.ts` (modifica) | Agente padrão passa a ser `api` |
| `evals/runEvals.ts` (modifica) | `--via-api` |
| `docs/dogfooding-fase-4.md` | Verificação real, roteiro e registro |

---

### Task 1 (B1): Repositório de conversas

**Arquivos:**
- Criar: `src/conversas/repositorio.ts`
- Teste: `tests/repositorioConversas.test.ts`

**Interfaces:**
- Consome: `createInitialState`, `ConversationState` (`src/agent/state.ts`); `RespostaMensagens` (Pacote A).
- Produz: `interface TurnoGuardado { turnoId: string; resposta: RespostaMensagens }`;
  `interface Conversa { versao: 1; estado: ConversationState; idsVistos: string[]; turnos: TurnoGuardado[]; falhasPorTurno: Record<string, number>; respostasRecentes: string[] }`;
  `novaConversa(telefone): Conversa`; `class RepositorioConversas` com
  `constructor(dir: string, log?: (e: Record<string, unknown>) => void)`, `carregar(telefone): Conversa`,
  `salvar(c: Conversa): void`; `MAX_TURNOS_GUARDADOS = 20`, `MAX_IDS_VISTOS = 200`.

- [ ] **Passo 1: Escrever o teste que falha** — `tests/repositorioConversas.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MAX_IDS_VISTOS, MAX_TURNOS_GUARDADOS, RepositorioConversas, novaConversa } from "../src/conversas/repositorio.js";

const TEL = "5583999990000";

describe("RepositorioConversas", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "conversas-"));
  });

  it("telefone sem arquivo → conversa nova em modo ia", () => {
    const c = new RepositorioConversas(dir).carregar(TEL);
    expect(c.estado.telefone).toBe(TEL);
    expect(c.estado.modo).toBe("ia");
    expect(c.turnos).toEqual([]);
    expect(c.idsVistos).toEqual([]);
  });

  it("salva e relê depois de reiniciar, sem deixar .tmp", () => {
    const repo = new RepositorioConversas(dir);
    const c = repo.carregar(TEL);
    c.estado.modo = "humano";
    c.idsVistos.push("m1");
    repo.salvar(c);
    const relida = new RepositorioConversas(dir).carregar(TEL);
    expect(relida.estado.modo).toBe("humano");
    expect(relida.idsVistos).toEqual(["m1"]);
    expect(readdirSync(dir)).toEqual([`${TEL}.json`]);
  });

  it("arquivo ilegível vira .corrompido-<data>, a conversa recomeça e sai um alerta", () => {
    writeFileSync(join(dir, `${TEL}.json`), "{ quebrado", "utf-8");
    const alertas: Array<Record<string, unknown>> = [];
    const c = new RepositorioConversas(dir, (e) => alertas.push(e)).carregar(TEL);
    expect(c.estado.historico).toEqual([]);
    expect(existsSync(join(dir, `${TEL}.json`))).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith(`${TEL}.json.corrompido-`))).toBe(true);
    expect(alertas[0]).toMatchObject({ type: "alerta", motivo: "estado_corrompido" });
  });

  it("arquivo de outro telefone ou de outro formato também conta como corrompido", () => {
    writeFileSync(join(dir, `${TEL}.json`), JSON.stringify(novaConversa("5583111110000")), "utf-8");
    expect(new RepositorioConversas(dir).carregar(TEL).estado.telefone).toBe(TEL);
    writeFileSync(join(dir, `${TEL}.json`), JSON.stringify({ versao: 0 }), "utf-8");
    expect(new RepositorioConversas(dir).carregar(TEL).estado.telefone).toBe(TEL);
  });

  it("guarda só os últimos turnos e ids", () => {
    const repo = new RepositorioConversas(dir);
    const c = repo.carregar(TEL);
    for (let i = 0; i < MAX_TURNOS_GUARDADOS + 5; i++) {
      c.turnos.push({ turnoId: `t${i}`, resposta: { respostas: [], modo: "ia" } });
    }
    for (let i = 0; i < MAX_IDS_VISTOS + 5; i++) c.idsVistos.push(`m${i}`);
    repo.salvar(c);
    const relida = repo.carregar(TEL);
    expect(relida.turnos).toHaveLength(MAX_TURNOS_GUARDADOS);
    expect(relida.turnos[0].turnoId).toBe("t5");
    expect(relida.idsVistos).toHaveLength(MAX_IDS_VISTOS);
  });

  it("telefone fora do formato nunca vira nome de arquivo", () => {
    expect(() => new RepositorioConversas(dir).carregar("../segredo")).toThrow();
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/repositorioConversas.test.ts` → FAIL — import não resolve.

- [ ] **Passo 3: Implementar** — `src/conversas/repositorio.ts`

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createInitialState, type ConversationState } from "../agent/state.js";
import type { RespostaMensagens } from "../contrato/esquemas.js";

export const MAX_TURNOS_GUARDADOS = 20;
export const MAX_IDS_VISTOS = 200;

export interface TurnoGuardado {
  turnoId: string;
  resposta: RespostaMensagens;
}

export interface Conversa {
  versao: 1;
  estado: ConversationState;
  idsVistos: string[];
  turnos: TurnoGuardado[];
  /** turnoId → falhas seguidas do mesmo lote (a 2ª transfere). */
  falhasPorTurno: Record<string, number>;
  /** ISO das respostas da última hora, para o limite por telefone. */
  respostasRecentes: string[];
}

export function novaConversa(telefone: string): Conversa {
  return {
    versao: 1,
    estado: createInitialState(telefone),
    idsVistos: [],
    turnos: [],
    falhasPorTurno: {},
    respostasRecentes: [],
  };
}

export class RepositorioConversas {
  private readonly dir: string;

  constructor(
    dir: string,
    private readonly log: (evento: Record<string, unknown>) => void = () => {}
  ) {
    this.dir = resolve(dir);
  }

  carregar(telefone: string): Conversa {
    const arquivo = this.arquivo(telefone);
    if (!existsSync(arquivo)) return novaConversa(telefone);
    try {
      const c = JSON.parse(readFileSync(arquivo, "utf-8")) as Conversa;
      if (c?.versao !== 1 || c.estado?.telefone !== telefone || !Array.isArray(c.turnos)) {
        throw new Error("formato inesperado");
      }
      return c;
    } catch (err) {
      const destino = `${arquivo}.corrompido-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      renameSync(arquivo, destino);
      this.log({ type: "alerta", gravidade: "alta", motivo: "estado_corrompido", arquivo: destino, erro: String(err) });
      return novaConversa(telefone);
    }
  }

  salvar(c: Conversa): void {
    c.turnos = c.turnos.slice(-MAX_TURNOS_GUARDADOS);
    c.idsVistos = c.idsVistos.slice(-MAX_IDS_VISTOS);
    const arquivo = this.arquivo(c.estado.telefone);
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${arquivo}.tmp`;
    writeFileSync(tmp, JSON.stringify(c), "utf-8");
    try {
      renameSync(tmp, arquivo);
    } catch {
      // Windows: rename falha se outro processo estiver com o arquivo aberto.
      writeFileSync(arquivo, JSON.stringify(c), "utf-8");
    }
  }

  private arquivo(telefone: string): string {
    if (!/^\d{10,15}$/.test(telefone)) throw new Error("telefone inválido para nome de arquivo");
    return join(this.dir, `${telefone}.json`);
  }
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/repositorioConversas.test.ts` → PASS (6). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/conversas/repositorio.ts tests/repositorioConversas.test.ts
git commit -m "feat(fase-4): estado da conversa por telefone em arquivo (tmp + rename, corrompido renomeado)"
```

---

### Task 2 (B2): `runTurn` cancelável, gancho de efeito e resumo no resultado

**Arquivos:**
- Modificar: `src/llm/types.ts`, `src/llm/anthropic.ts`, `src/agent/runTurn.ts`, `src/logging/logger.ts`,
  `src/tools/transferirHumano.ts`
- Teste: `tests/runTurnFase4.test.ts`

**Interfaces:**
- Produz: `LLMProvider.chat` aceita `signal?: AbortSignal`;
  `runTurn(userMessage, state, llm, client, logger, opcoes?: OpcoesTurno)` com
  `interface OpcoesTurno { signal?: AbortSignal; aoEfeito?: () => void }`;
  `TurnResult` ganha `transferencia?: ResumoTransferencia` e `lacunas: string[]`;
  `new Logger(conversaId, contexto?: Record<string, string>)` (o contexto entra em toda linha);
  `export type MotivoTransferencia`, `export interface ResumoTransferencia` em `src/tools/transferirHumano.ts`.
- Chamadas antigas (`cli.ts`, `evals`, testes) continuam válidas: o parâmetro novo é opcional.

- [ ] **Passo 1: Escrever o teste que falha** — `tests/runTurnFase4.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { runTurn } from "../src/agent/runTurn.js";
import { createInitialState, type ConversationState } from "../src/agent/state.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { EscritaSimuladaClient } from "../src/integrations/brindeme/escritaSimulada.js";
import { Logger } from "../src/logging/logger.js";
import { setBaseConhecimento, setLacunaStore } from "../src/tools/consultarConhecimento.js";
import { MemoryLacunaStore } from "../src/knowledge/lacunas.js";
import { BaseConhecimento } from "../src/knowledge/base.js";
import { ScriptedLLM, endTurn, toolUse } from "./helpers/llmRoteirizado.js";
import type { LLMProvider, LLMResponse } from "../src/llm/types.js";

const TEL = "5583999990000";

function comOrcamentoPendente(state: ConversationState, token: string): ConversationState {
  state.orcamentoPendente = {
    token,
    expiraEm: new Date(Date.now() + 15 * 60_000).toISOString(),
    resumo: { tipo: "PJ", nome: "Empresa", email: "a@b.test", telefone: TEL, itens: [], total_estimado: 0, arte_refs: [] },
    body: {
      type: "PJ",
      customer_name: "Empresa",
      customer_phone: TEL,
      customer_email: "a@b.test",
      items: [{ subproduct_id: "sub-1", quantity: 50 }],
    },
  };
  return state;
}

describe("runTurn — Fase 4", () => {
  beforeEach(() => {
    setLacunaStore(new MemoryLacunaStore());
    setBaseConhecimento(new BaseConhecimento([], { incluirRascunhos: false }));
  });
  afterEach(() => setBaseConhecimento(null));

  it("sinal já cancelado: rejeita sem chamar o modelo", async () => {
    const llm = new ScriptedLLM([endTurn("oi")]);
    const controle = new AbortController();
    controle.abort();
    const state = createInitialState(TEL);
    await expect(
      runTurn("oi", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId), { signal: controle.signal })
    ).rejects.toThrow();
    expect(llm.seen).toHaveLength(0);
  });

  it("cancelado enquanto o modelo pensava: a ferramenta seguinte não roda", async () => {
    const controle = new AbortController();
    const client = new EscritaSimuladaClient(new MockBrindeMeClient());
    const criar = vi.spyOn(client, "createBudget");
    const llm: LLMProvider = {
      async chat(): Promise<LLMResponse> {
        controle.abort();
        return toolUse("criar_orcamento", { token_confirmacao: "tok" });
      },
    };
    const state = comOrcamentoPendente(createInitialState(TEL), "tok");
    await expect(
      runTurn("pode criar", state, llm, client, new Logger(state.conversaId), { signal: controle.signal })
    ).rejects.toThrow();
    expect(criar).not.toHaveBeenCalled();
  });

  it("aoEfeito roda logo depois de criar_orcamento", async () => {
    const state = comOrcamentoPendente(createInitialState(TEL), "tok");
    const vistos: string[] = [];
    const llm = new ScriptedLLM([toolUse("criar_orcamento", { token_confirmacao: "tok" }), endTurn("Criado!")]);
    await runTurn("pode criar", state, llm, new EscritaSimuladaClient(new MockBrindeMeClient()), new Logger(state.conversaId), {
      aoEfeito: () => vistos.push(state.orcamentoTokens.tok ?? "sem token"),
    });
    expect(vistos).toHaveLength(1);
    expect(vistos[0]).toMatch(/^TESTE-/);
  });

  it("aoEfeito roda logo depois de registrar_arte", async () => {
    const state = createInitialState(TEL);
    const artes: number[] = [];
    const llm = new ScriptedLLM([toolUse("registrar_arte", { descricao_arquivo: "logo.png" }), endTurn("Recebi!")]);
    await runTurn("[ARQUIVO recebido: logo.png (image/png, 2 KB)]", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId), {
      aoEfeito: () => artes.push(state.artes.length),
    });
    expect(artes).toEqual([1]);
  });

  it("devolve o resumo da transferência e a pergunta sem resposta", async () => {
    const state = createInitialState(TEL);
    const llm = new ScriptedLLM([
      toolUse("consultar_conhecimento", { pergunta: "qual o horário de vocês?" }),
      toolUse("transferir_humano", { motivo: "lacuna_conhecimento", prioridade: "normal" }),
      endTurn("Vou chamar alguém da equipe."),
    ]);
    const r = await runTurn("qual o horário?", state, llm, new MockBrindeMeClient(), new Logger(state.conversaId));
    expect(r.transferred).toBe(true);
    expect(r.transferencia?.motivo).toBe("lacuna_conhecimento");
    expect(r.lacunas).toEqual(["qual o horário de vocês?"]);
  });

  it("sem transferência: lacunas vazias e sem resumo", async () => {
    const state = createInitialState(TEL);
    const r = await runTurn("oi", state, new ScriptedLLM([endTurn("Olá!")]), new MockBrindeMeClient(), new Logger(state.conversaId));
    expect(r.lacunas).toEqual([]);
    expect(r.transferencia).toBeUndefined();
  });

  it("Logger grava o contexto (turnoId) em cada linha", () => {
    const id = `teste-contexto-${Date.now()}`;
    new Logger(id, { turnoId: "0123456789abcdef" }).log({ type: "state_change", change: "x" });
    const linha = readFileSync(join(process.cwd(), "logs", `${id}.jsonl`), "utf-8").trim();
    expect(JSON.parse(linha)).toMatchObject({ turnoId: "0123456789abcdef", type: "state_change" });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/runTurnFase4.test.ts`
Esperado: FAIL — os testes de cancelamento não rejeitam, `lacunas` é `undefined` e o Logger não grava `turnoId`.

- [ ] **Passo 3: Implementar**

`src/llm/types.ts` — na interface `LLMProvider`, o parâmetro de `chat` passa a ser:

```ts
  chat(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMTool[];
    model: string;
    signal?: AbortSignal;
  }): Promise<LLMResponse>;
```

`src/llm/anthropic.ts` — a assinatura de `chat` ganha `signal?: AbortSignal;` no tipo de `params`, e a chamada vira:

```ts
    const response = await this.client.messages.create(
      {
        model: params.model,
        max_tokens: 4096,
        system: params.system,
        messages: params.messages as Anthropic.MessageParam[],
        tools: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool["input_schema"],
        })),
      },
      { signal: params.signal }
    );
```

`src/logging/logger.ts` — a classe `Logger` passa a ser:

```ts
export class Logger {
  private logFile: string;

  constructor(
    conversaId: string,
    private readonly contexto: Record<string, string> = {}
  ) {
    this.logFile = join(logsDir, `${conversaId}.jsonl`);
  }

  log(event: LogEvent): void {
    const entry = {
      timestamp: new Date().toISOString(),
      ...this.contexto,
      ...maskSensitive(event) as object,
    };
    try {
      appendFileSync(this.logFile, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // non-fatal
    }
  }
}
```

`src/tools/transferirHumano.ts` — depois de `export const transferirHumanoSchema = …;` acrescente os tipos, e anote o
objeto `resumo` do handler com eles (`const resumo: ResumoTransferencia = { … }`, conteúdo igual ao de hoje):

```ts
export type MotivoTransferencia = (typeof MOTIVOS)[number];

export interface ResumoTransferencia {
  conversaId: string;
  telefone_cliente: string;
  cliente: ConversationState["cliente"];
  motivo: MotivoTransferencia;
  prioridade: "normal" | "alta";
  observacao?: string;
  produtos_discutidos: string[];
  orcamentos_na_conversa: string[];
  artes_registradas: string[];
  necessidade: ConversationState["necessidade"];
  ultimas_mensagens: string;
  responsavel: { id: string; nome: string };
  transferido_em: string;
}
```

`src/agent/runTurn.ts` — conteúdo final (o que não mudou foi mantido como está):

```ts
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { LLMProvider, LLMMessage } from "../llm/types.js";
import type { ConversationState } from "./state.js";
import { addMessage } from "./state.js";
import { tools, toolMap } from "../tools/index.js";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { Logger } from "../logging/logger.js";
import {
  translateApiError,
  isFalhaApi,
  exigeTransferenciaImediata,
} from "../integrations/brindeme/errors.js";
import { config } from "../config.js";
import type { ResumoTransferencia } from "../tools/transferirHumano.js";

const __dir = dirname(fileURLToPath(import.meta.url));

/** Falhas de API seguidas antes de instruir transferência (decisão técnica #6 do README). */
const FALHAS_PARA_TRANSFERIR = 2;

/** Ferramenta → status de sucesso que muda a loja ou o estado e precisa ser salvo na hora. */
const EFEITOS: Record<string, string> = {
  criar_orcamento: "criado",
  registrar_arte: "arte_registrada",
};

function loadSystemPrompt(state: ConversationState): string {
  const template = readFileSync(join(__dir, "prompt/system.md"), "utf-8");
  const stateForPrompt = {
    modo: state.modo,
    cliente: state.cliente,
    necessidade: state.necessidade,
    artes_registradas: state.artes.length,
    orcamentos_criados: state.orcamentos,
    produtos_discutidos: state.produtosDiscutidos,
    orcamento_pendente_expirado: state.orcamentoPendente
      ? new Date() > new Date(state.orcamentoPendente.expiraEm)
      : undefined,
  };

  return template
    .replace("{{ASSISTANT_NAME}}", config.assistantName)
    .replace(/\{\{STORE_NAME\}\}/g, config.storeName)
    .replace("{{ESTADO}}", JSON.stringify(stateForPrompt, null, 2));
}

export interface TurnResult {
  response: string | null;
  toolsCalled: Array<{ name: string; inputSummary: string }>;
  transferred: boolean;
  /** Resumo devolvido por transferir_humano quando a transferência aconteceu. */
  transferencia?: ResumoTransferencia;
  /** Perguntas que a base de conhecimento não cobriu neste turno. */
  lacunas: string[];
}

export interface OpcoesTurno {
  /** Conferido antes de cada chamada ao modelo e de cada ferramenta. */
  signal?: AbortSignal;
  /** Chamado logo depois de uma ferramenta com efeito (orçamento criado, arte registrada). */
  aoEfeito?: () => void;
}

export async function runTurn(
  userMessage: string,
  state: ConversationState,
  llm: LLMProvider,
  client: BrindeMeClient,
  logger: Logger,
  opcoes: OpcoesTurno = {}
): Promise<TurnResult> {
  logger.log({ type: "message_received", role: "user", content: userMessage });
  addMessage(state, "user", userMessage);

  if (state.modo === "humano") {
    logger.log({ type: "state_change", change: "message_in_human_mode_ignored" });
    return { response: null, toolsCalled: [], transferred: false, lacunas: [] };
  }

  const systemPrompt = loadSystemPrompt(state);

  const llmTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  // Build messages array from history (last 20 turns)
  const historyMessages: LLMMessage[] = state.historico
    .slice(-40)
    .slice(0, -1) // exclude the message we just added (re-added below)
    .map((m) => ({ role: m.role, content: m.content }));

  const messages: LLMMessage[] = [
    ...historyMessages,
    { role: "user", content: userMessage },
  ];

  const toolsCalled: Array<{ name: string; inputSummary: string }> = [];
  let transferred = false;
  let transferencia: ResumoTransferencia | undefined;
  const lacunas: string[] = [];
  /** Itens da base de conhecimento usados neste turno (auditoria da Fase 3). */
  const kbItens = new Set<string>();
  const resultado = (response: string | null): TurnResult => ({
    response,
    toolsCalled,
    transferred,
    lacunas,
    ...(transferencia ? { transferencia } : {}),
  });

  // Agentic loop
  let continueLoop = true;
  while (continueLoop) {
    opcoes.signal?.throwIfAborted();
    const response = await llm.chat({
      system: systemPrompt,
      messages,
      tools: llmTools,
      model: config.llmModel,
      signal: opcoes.signal,
    });

    if (response.stop_reason === "tool_use") {
      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      const toolResults: LLMMessage["content"] = [];
      if (!Array.isArray(toolResults)) throw new Error("unreachable");

      for (const block of assistantContent) {
        if (block.type !== "tool_use") continue;
        opcoes.signal?.throwIfAborted();

        const toolName = block.name!;
        const toolInput = block.input;
        const toolId = block.id!;
        const toolDef = toolMap.get(toolName);

        const inputSummary = JSON.stringify(toolInput).slice(0, 120);
        toolsCalled.push({ name: toolName, inputSummary });

        const start = Date.now();
        let output: unknown;
        let error: string | undefined;

        if (!toolDef) {
          output = { erro: "ferramenta_nao_encontrada" };
          error = "unknown_tool";
        } else {
          try {
            output = await toolDef.handler(toolInput, state, client);
          } catch (err) {
            output = { erro: translateApiError(err) };
            error = String(err);
          }
        }

        // Contagem centralizada de falhas de infraestrutura. Antes cada tool
        // engolia o erro internamente e o contador nunca subia, então a regra
        // "2 falhas seguidas → transferir" só funcionava em criar_orcamento.
        if (isFalhaApi(output)) {
          state.falhasConsecutivas += 1;
          const erro = (output as { erro?: { erro?: string; alerta?: boolean } }).erro;

          // 401/403 e 412 não esperam a segunda falha (tabela de falhas da Fase 2).
          const imediato = exigeTransferenciaImediata(output);
          if (imediato || state.falhasConsecutivas >= FALHAS_PARA_TRANSFERIR) {
            output = {
              ...(output as object),
              instrucao: "transferir",
              motivo_sugerido: "falha_sistema",
            };
          }
          if (erro?.alerta) {
            logger.log({
              type: "alerta",
              gravidade: "critica",
              motivo: erro.erro ?? "falha_api",
              ferramenta: toolName,
            });
          }
        } else {
          state.falhasConsecutivas = 0;
        }

        logger.log({
          type: "tool_call",
          name: toolName,
          input: toolInput,
          output,
          duration_ms: Date.now() - start,
          error,
        });

        const status = (output as { status?: unknown } | null)?.status;
        if (EFEITOS[toolName] !== undefined && status === EFEITOS[toolName]) opcoes.aoEfeito?.();

        if (toolName === "consultar_conhecimento") {
          const o = output as { resultado?: string; itens?: Array<{ id: string }> };
          const pergunta = String((toolInput as { pergunta?: unknown })?.pergunta ?? "");
          const ids = o.itens?.map((i) => i.id) ?? [];
          for (const id of ids) kbItens.add(id);
          if (o.resultado !== "encontrado") lacunas.push(pergunta);
          logger.log({
            type: "kb_consulta",
            pergunta,
            itens: ids,
            resultado: o.resultado === "encontrado" ? "encontrado" : "lacuna",
          });
        }

        if (toolName === "transferir_humano") {
          transferred = true;
          const o = output as { status?: string; resumo_para_atendente?: ResumoTransferencia };
          if (o.status === "transferido" && o.resumo_para_atendente) transferencia = o.resumo_para_atendente;
        }

        (toolResults as Array<{ type: string; tool_use_id: string; content: string }>).push({
          type: "tool_result",
          tool_use_id: toolId,
          content: JSON.stringify(output),
        });
      }

      messages.push({ role: "user", content: toolResults });
    } else {
      // end_turn or max_tokens
      const textBlocks = response.content.filter((b) => b.type === "text");
      const text = textBlocks.map((b) => b.text ?? "").join("\n").trim();

      logger.log({
        type: "response_sent",
        content: text,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        ...(kbItens.size > 0 ? { kb_itens: [...kbItens] } : {}),
      });

      addMessage(state, "assistant", text);
      continueLoop = false;

      return resultado(text);
    }
  }

  return resultado(null);
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/runTurnFase4.test.ts` → PASS (7). `npm test && npm run typecheck` → verde (os testes antigos de
`runTurn` não comparam o resultado inteiro; se algum comparar, acrescente `lacunas: []` ao esperado — é a única
mudança permitida em teste antigo).

- [ ] **Passo 5: Commit**

```bash
git add src/llm src/agent/runTurn.ts src/logging/logger.ts src/tools/transferirHumano.ts tests/runTurnFase4.test.ts
git commit -m "feat(fase-4): runTurn cancelável por AbortSignal, gancho após efeito e resumo/lacunas no resultado"
```

---

### Task 3 (B3): Correções do agente — transferência resiliente, nome da loja, arte real

**Arquivos:**
- Modificar: `src/tools/transferirHumano.ts`, `src/config.ts`, `.env.example`, `src/agent/state.ts`,
  `src/tools/registrarArte.ts`, `src/tools/index.ts`
- Teste: `tests/correcoesFase4.test.ts`

**Interfaces:**
- Produz: `interface ArquivoRecebido { nome: string; caminho: string; mime: string; bytes: number }` e
  `ConversationState.arquivosRecebidos?: ArquivoRecebido[]` (opcional: estados salvos antes continuam válidos);
  `createInitialState` devolve `arquivosRecebidos: []`.
- Comportamento: `transferir_humano` transfere mesmo com `listAdmins` falhando (responsável "Equipe");
  `registrar_arte` casa `descricao_arquivo` com um arquivo recebido (nome, sem diferenciar maiúsculas) e registra o
  caminho real; sem arquivo recebido, mantém a validação por extensão de hoje (o CLI depende disso).

- [ ] **Passo 1: Escrever o teste que falha** — `tests/correcoesFase4.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { createInitialState } from "../src/agent/state.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { transferirHumanoHandler } from "../src/tools/transferirHumano.js";
import { registrarArteHandler } from "../src/tools/registrarArte.js";

const TEL = "5583999990000";

describe("transferir_humano com a API da loja fora", () => {
  it("transfere mesmo quando listAdmins falha", async () => {
    const client = new MockBrindeMeClient();
    vi.spyOn(client, "listAdmins").mockRejectedValue(new Error("API fora"));
    const state = createInitialState(TEL);

    const r = await transferirHumanoHandler({ motivo: "falha_sistema", prioridade: "alta" }, state, client);

    expect(r.status).toBe("transferido");
    expect(r.resumo_para_atendente.responsavel).toEqual({ id: "desconhecido", nome: "Equipe" });
    expect(state.modo).toBe("humano");
  });
});

describe("registrar_arte com arquivo que chegou pelo WhatsApp", () => {
  it("registra o caminho real do arquivo recebido", async () => {
    const state = createInitialState(TEL);
    state.arquivosRecebidos = [{ nome: "Logo.PNG", caminho: "C:/artes/5583999990000/abc.png", mime: "image/png", bytes: 4_096 }];

    const r = await registrarArteHandler({ descricao_arquivo: "logo.png", posicao: "frente" }, state, new MockBrindeMeClient());

    expect(r).toMatchObject({ status: "arte_registrada", arquivo: "Logo.PNG", tamanho_kb: 4 });
    expect(state.artes).toEqual([
      { ref: expect.stringMatching(/^arte-/), arquivo: "C:/artes/5583999990000/abc.png", posicao: "frente", cores: undefined },
    ]);
  });

  it("sem arquivo recebido, continua validando pela extensão", async () => {
    const state = createInitialState(TEL);
    const r = await registrarArteHandler({ descricao_arquivo: "virus.exe" }, state, new MockBrindeMeClient());
    expect(r).toMatchObject({ erro: "formato_nao_aceito" });
  });

  it("estado novo já nasce com a lista de arquivos vazia", () => {
    expect(createInitialState(TEL).arquivosRecebidos).toEqual([]);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/correcoesFase4.test.ts`
Esperado: FAIL — `transferirHumanoHandler` rejeita com "API fora"; `arquivosRecebidos` não existe no tipo.

- [ ] **Passo 3: Implementar**

`src/tools/transferirHumano.ts` — troque a linha `const admins = await client.listAdmins();` por:

```ts
  // A transferência por falha de sistema acontece justamente com a API fora: listAdmins não pode derrubá-la.
  let admins: Awaited<ReturnType<BrindeMeClient["listAdmins"]>> = [];
  try {
    admins = await client.listAdmins();
  } catch {
    admins = [];
  }
```

`src/agent/state.ts`:
- depois de `export interface ArteRegistrada { … }`, acrescente:

```ts
export interface ArquivoRecebido {
  nome: string;
  caminho: string;
  mime: string;
  bytes: number;
}
```

- em `ConversationState`, depois de `artes: ArteRegistrada[];`:

```ts
  /** Arquivos que chegaram pelo WhatsApp (gravados pela ponte). Ausente em estados salvos antes da Fase 4. */
  arquivosRecebidos?: ArquivoRecebido[];
```

- em `createInitialState`, depois de `artes: [],`: `arquivosRecebidos: [],`

`src/tools/registrarArte.ts` — no começo de `registrarArteHandler`, antes da validação por extensão:

```ts
  const nomeProcurado = input.descricao_arquivo.trim().toLowerCase();
  const recebido = state.arquivosRecebidos?.find((a) => a.nome.toLowerCase() === nomeProcurado);
  if (recebido) {
    const ref = `arte-${uuidv4().slice(0, 8)}`;
    state.artes.push({ ref, arquivo: recebido.caminho, posicao: input.posicao, cores: input.cores });
    return {
      status: "arte_registrada",
      arte_ref: ref,
      arquivo: recebido.nome,
      tamanho_kb: Math.max(1, Math.round(recebido.bytes / 1024)),
      posicao: input.posicao ?? "não especificada",
      cores: input.cores ?? "não especificadas",
      mensagem: "Arte registrada! Vou incluir essa referência no orçamento para a equipe.",
    };
  }
```

`src/tools/index.ts` — a `description` de `registrar_arte` passa a ser:

```ts
      "Registra a arte que o cliente enviou. Pelo WhatsApp o arquivo aparece como [ARQUIVO recebido: <nome> (...)]; passe esse <nome> em descricao_arquivo. Valida o formato.",
```

`src/config.ts` — `storeName: process.env.STORE_NAME ?? "Presentes Especiais",`

`.env.example` — `STORE_NAME=Presentes Especiais`

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/correcoesFase4.test.ts` → PASS (4). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/tools/transferirHumano.ts src/tools/registrarArte.ts src/tools/index.ts src/agent/state.ts src/config.ts .env.example tests/correcoesFase4.test.ts
git commit -m "fix(fase-4): transferência não quebra com a API fora; arte casada com o arquivo recebido; loja Presentes Especiais"
```

---

### Task 4 (B4): Resumo para o atendente

**Arquivos:**
- Criar: `src/api/resumoAtendente.ts`
- Teste: `tests/resumoAtendente.test.ts`

**Interfaces:**
- Consome: `ResumoTransferencia`, `MotivoTransferencia` (B2); `ConversationState`.
- Produz: `formatarAvisoTransferencia(telefone: string, resumo: ResumoTransferencia, lacunas?: string[]): string`;
  `resumoDoEstado(estado: ConversationState, motivo: MotivoTransferencia, observacao?: string): ResumoTransferencia`
  (para as transferências que o próprio sistema faz: teto, falha do modelo, limite por hora).

- [ ] **Passo 1: Escrever o teste que falha** — `tests/resumoAtendente.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { addMessage, createInitialState } from "../src/agent/state.js";
import { formatarAvisoTransferencia, resumoDoEstado } from "../src/api/resumoAtendente.js";

const TEL = "5583999990000";

describe("aviso de transferência", () => {
  it("traz cliente, telefone completo, motivo, pergunta sem resposta, conversa e o comando de devolver", () => {
    const estado = createInitialState(TEL);
    estado.cliente = { nome: "Maria", tipo: "PJ" };
    estado.produtosDiscutidos = ["Caneca Branca"];
    estado.orcamentos = ["TESTE-1"];
    addMessage(estado, "user", "qual o horário?");
    addMessage(estado, "assistant", "Vou chamar alguém.");

    const texto = formatarAvisoTransferencia(TEL, resumoDoEstado(estado, "lacuna_conhecimento"), ["qual o horário de vocês?"]);

    expect(texto).toBe(
      [
        "🔔 *Transferência* — prioridade ALTA",
        `Cliente: Maria · PJ · ${TEL}`,
        "Motivo: lacuna_conhecimento",
        "Pergunta sem resposta: qual o horário de vocês?",
        "Produtos: Caneca Branca",
        "Orçamentos: TESTE-1",
        "",
        "Últimas mensagens:",
        "[cliente]: qual o horário?",
        "[agente]: Vou chamar alguém.",
        "",
        `Para devolver: #devolver ${TEL} [nota]`,
      ].join("\n")
    );
  });

  it("prioridade normal e cliente sem nome", () => {
    const resumo = { ...resumoDoEstado(createInitialState(TEL), "pedido_cliente", "quer falar com o dono"), prioridade: "normal" as const };
    const texto = formatarAvisoTransferencia(TEL, resumo);
    expect(texto.split("\n").slice(0, 3)).toEqual([
      "🔔 *Transferência*",
      `Cliente: sem nome · ${TEL}`,
      "Motivo: pedido_cliente — quer falar com o dono",
    ]);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/resumoAtendente.test.ts` → FAIL — import não resolve.

- [ ] **Passo 3: Implementar** — `src/api/resumoAtendente.ts`

```ts
import type { ConversationState } from "../agent/state.js";
import type { MotivoTransferencia, ResumoTransferencia } from "../tools/transferirHumano.js";

export function resumoDoEstado(
  estado: ConversationState,
  motivo: MotivoTransferencia,
  observacao?: string
): ResumoTransferencia {
  return {
    conversaId: estado.conversaId,
    telefone_cliente: estado.telefone,
    cliente: estado.cliente,
    motivo,
    prioridade: "alta",
    ...(observacao ? { observacao } : {}),
    produtos_discutidos: estado.produtosDiscutidos,
    orcamentos_na_conversa: estado.orcamentos,
    artes_registradas: estado.artes.map((a) => a.arquivo),
    necessidade: estado.necessidade,
    ultimas_mensagens: estado.historico
      .slice(-4)
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n"),
    responsavel: { id: "sistema", nome: "Equipe" },
    transferido_em: new Date().toISOString(),
  };
}

export function formatarAvisoTransferencia(
  telefone: string,
  resumo: ResumoTransferencia,
  lacunas: string[] = []
): string {
  const cliente = [resumo.cliente.nome, resumo.cliente.tipo].filter(Boolean).join(" · ") || "sem nome";
  const linhas = [
    `🔔 *Transferência*${resumo.prioridade === "alta" ? " — prioridade ALTA" : ""}`,
    `Cliente: ${cliente} · ${telefone}`,
    `Motivo: ${resumo.motivo}${resumo.observacao ? ` — ${resumo.observacao}` : ""}`,
  ];
  if (lacunas.length > 0) linhas.push(`Pergunta sem resposta: ${lacunas.join(" | ")}`);
  if (resumo.produtos_discutidos.length > 0) linhas.push(`Produtos: ${resumo.produtos_discutidos.join(", ")}`);
  if (resumo.orcamentos_na_conversa.length > 0) linhas.push(`Orçamentos: ${resumo.orcamentos_na_conversa.join(", ")}`);
  if (resumo.artes_registradas.length > 0) linhas.push(`Artes: ${resumo.artes_registradas.join(", ")}`);
  if (resumo.ultimas_mensagens) {
    linhas.push(
      "",
      "Últimas mensagens:",
      resumo.ultimas_mensagens.replace(/^\[user\]/gm, "[cliente]").replace(/^\[assistant\]/gm, "[agente]")
    );
  }
  linhas.push("", `Para devolver: #devolver ${telefone} [nota]`);
  return linhas.join("\n");
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/resumoAtendente.test.ts` → PASS (2). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/api/resumoAtendente.ts tests/resumoAtendente.test.ts
git commit -m "feat(fase-4): aviso de transferência legível para Mensagem para mim"
```

---

### Task 5 (B5): `AgenteDefinitivo`

**Arquivos:**
- Criar: `src/api/agenteDefinitivo.ts`
- Teste: `tests/agenteDefinitivo.test.ts`

**Interfaces:**
- Consome: `Agente`, `TurnoEmAndamentoError` (A1); `loteParaTexto`, `formatarParaWhatsApp` (A1); `RepositorioConversas`,
  `Conversa` (B1); `runTurn`, `TurnResult` (B2); `formatarAvisoTransferencia`, `resumoDoEstado` (B4).
- Produz: `class AgenteDefinitivo implements Agente` com `constructor(deps: DepsAgente)`;
  `interface DepsAgente { repo; llm; client; tetoMs: number; respostasPorHora: number; aoTurno?: (r: TurnResult) => void }`;
  `MSG_FALHA`, `MSG_LIMITE`, `FALHAS_DO_LOTE_PARA_TRANSFERIR = 2`.

Ordem de `processarLote` (spec, seção 5.A passo 5):
1. lote já respondido (`turnoId` guardado) → resposta guardada;
2. outro turno rodando na conversa → `TurnoEmAndamentoError` (vira 409);
3. só as mensagens com id ainda não visto seguem; nenhuma nova → `{ respostas: [], modo }`;
4. conversa em `humano` → mensagem no histórico, sem modelo;
5. passou de `respostasPorHora` → transferência pelo sistema com `MSG_LIMITE`;
6. senão `runTurn` com teto de `tetoMs` (AbortController) e `aoEfeito` salvando a conversa;
7. falha: tira a mensagem do cliente do histórico (efeitos ficam), conta a falha do lote; teto estourado ou 2ª falha →
   transferência pelo sistema com `MSG_FALHA`; 1ª falha comum → salva e relança (vira 503 e a ponte repete).

As conversas ficam em cache na instância: turno e evento da mesma conversa mexem no mesmo objeto, então o evento do
atendente durante um turno não é sobrescrito quando o turno salva.

- [ ] **Passo 1: Escrever o teste que falha** — `tests/agenteDefinitivo.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgenteDefinitivo, MSG_FALHA, MSG_LIMITE } from "../src/api/agenteDefinitivo.js";
import { RepositorioConversas } from "../src/conversas/repositorio.js";
import { TurnoEmAndamentoError } from "../src/contrato/agente.js";
import { calcularTurnoId } from "../src/contrato/turno.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { EscritaSimuladaClient } from "../src/integrations/brindeme/escritaSimulada.js";
import type { BrindeMeClient } from "../src/integrations/brindeme/client.js";
import { setBaseConhecimento, setLacunaStore } from "../src/tools/consultarConhecimento.js";
import { MemoryLacunaStore } from "../src/knowledge/lacunas.js";
import { BaseConhecimento } from "../src/knowledge/base.js";
import type { LLMProvider, LLMResponse } from "../src/llm/types.js";
import { ScriptedLLM, endTurn, toolUse } from "./helpers/llmRoteirizado.js";
import { pedido } from "./helpers/bateriaContrato.js";

const TEL = "5583999990000";
const T = "2026-10-14T12:00:00.000Z";

function montar(
  llm: LLMProvider,
  extra: { tetoMs?: number; respostasPorHora?: number; client?: BrindeMeClient; dir?: string } = {}
) {
  const dir = extra.dir ?? mkdtempSync(join(tmpdir(), "conversas-"));
  const repo = new RepositorioConversas(dir);
  const agente = new AgenteDefinitivo({
    repo,
    llm,
    client: extra.client ?? new MockBrindeMeClient(),
    tetoMs: extra.tetoMs ?? 90_000,
    respostasPorHora: extra.respostasPorHora ?? 30,
  });
  return { agente, repo, dir };
}

function semearOrcamentoPendente(dir: string, token: string): void {
  const repo = new RepositorioConversas(dir);
  const c = repo.carregar(TEL);
  c.estado.orcamentoPendente = {
    token,
    expiraEm: new Date(Date.now() + 15 * 60_000).toISOString(),
    resumo: { tipo: "PJ", nome: "Empresa", email: "a@b.test", telefone: TEL, itens: [], total_estimado: 0, arte_refs: [] },
    body: {
      type: "PJ",
      customer_name: "Empresa",
      customer_phone: TEL,
      customer_email: "a@b.test",
      items: [{ subproduct_id: "sub-1", quantity: 50 }],
    },
  };
  repo.salvar(c);
}

describe("AgenteDefinitivo", () => {
  beforeEach(() => {
    setLacunaStore(new MemoryLacunaStore());
    setBaseConhecimento(new BaseConhecimento([], { incluirRascunhos: false }));
  });
  afterEach(() => setBaseConhecimento(null));

  it("lote repetido devolve a resposta guardada, inclusive depois de reiniciar", async () => {
    const llm = new ScriptedLLM([endTurn("Olá! **Bem-vindo**")]);
    const { agente, dir } = montar(llm);
    const p = pedido(TEL, ["r1"]);
    const a = await agente.processarLote(p);
    expect(a).toEqual({ respostas: ["Olá! *Bem-vindo*"], modo: "ia" });
    expect(await agente.processarLote(p)).toEqual(a);
    const reiniciado = montar(llm, { dir }).agente;
    expect(await reiniciado.processarLote(p)).toEqual(a);
    expect(llm.seen).toHaveLength(1);
  });

  it("outro lote da mesma conversa com turno rodando → TurnoEmAndamentoError", async () => {
    const { agente } = montar(new ScriptedLLM([endTurn("a"), endTurn("b")], 100));
    const primeiro = agente.processarLote(pedido(TEL, ["e1"]));
    await expect(agente.processarLote(pedido(TEL, ["e2"]))).rejects.toBeInstanceOf(TurnoEmAndamentoError);
    await primeiro;
  });

  it("só as mensagens novas vão ao modelo", async () => {
    const llm = new ScriptedLLM([endTurn("1"), endTurn("2")]);
    const { agente } = montar(llm);
    const m1 = { id: "n1", timestamp: T, texto: "oi" };
    const m2 = { id: "n2", timestamp: T, texto: "quero canecas" };
    await agente.processarLote({ turnoId: calcularTurnoId(["n1"]), telefone: TEL, mensagens: [m1] });
    await agente.processarLote({ turnoId: calcularTurnoId(["n1", "n2"]), telefone: TEL, mensagens: [m1, m2] });
    expect(llm.seen[1].at(-1)).toEqual({ role: "user", content: "quero canecas" });
  });

  it("conversa em humano: guarda a mensagem e não chama o modelo", async () => {
    const llm = new ScriptedLLM();
    const { agente, repo } = montar(llm);
    await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "at1", texto: "assumi", timestamp: T });
    expect(await agente.processarLote(pedido(TEL, ["h1"], "cadê meu pedido?"))).toEqual({ respostas: [], modo: "humano" });
    expect(llm.seen).toHaveLength(0);
    expect(repo.carregar(TEL).estado.historico.map((m) => m.content)).toEqual(["[Atendente]: assumi", "cadê meu pedido?"]);
  });

  it("falha do Claude desfaz o turno; na 2ª falha do mesmo lote transfere", async () => {
    const llm = new ScriptedLLM([new Error("overloaded"), new Error("overloaded")]);
    const { agente, repo } = montar(llm);
    const p = pedido(TEL, ["f1"], "oi");

    await expect(agente.processarLote(p)).rejects.toThrow("overloaded");
    const depois = repo.carregar(TEL);
    expect(depois.estado.historico).toEqual([]);
    expect(depois.idsVistos).toEqual([]);

    const r = await agente.processarLote(p);
    expect(r.respostas).toEqual([MSG_FALHA]);
    expect(r.modo).toBe("humano");
    expect(r.avisoAtendente).toContain("Motivo: falha_sistema");
    expect(r.avisoAtendente).toContain(`#devolver ${TEL}`);
  });

  it("repetir o lote depois de falha não duplica mensagem nem arquivo", async () => {
    const llm = new ScriptedLLM([new Error("overloaded"), endTurn("Recebi a arte.")]);
    const { agente, repo } = montar(llm);
    const arquivo = { caminho: "C:/artes/abc.png", mime: "image/png", bytes: 2_048, nome: "logo.png" };
    const p = { turnoId: calcularTurnoId(["a1"]), telefone: TEL, mensagens: [{ id: "a1", timestamp: T, texto: "segue", arquivo }] };

    await expect(agente.processarLote(p)).rejects.toThrow();
    await agente.processarLote(p);

    const c = repo.carregar(TEL);
    expect(c.estado.arquivosRecebidos).toHaveLength(1);
    expect(c.estado.historico.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("teto de tempo: cancela, não cria o orçamento depois e transfere", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conversas-"));
    semearOrcamentoPendente(dir, "tok");
    const client = new EscritaSimuladaClient(new MockBrindeMeClient());
    const criar = vi.spyOn(client, "createBudget");
    const lento: LLMProvider = {
      async chat(): Promise<LLMResponse> {
        await new Promise((r) => setTimeout(r, 100));
        return toolUse("criar_orcamento", { token_confirmacao: "tok" });
      },
    };
    const { agente } = montar(lento, { tetoMs: 20, client, dir });

    const r = await agente.processarLote(pedido(TEL, ["t1"], "pode criar"));

    expect(criar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ respostas: [MSG_FALHA], modo: "humano" });
    expect(r.avisoAtendente).toContain("turno passou do teto de tempo");
  });

  it("o estado vai para o disco logo depois de criar_orcamento, antes do turno acabar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conversas-"));
    semearOrcamentoPendente(dir, "tok");
    let derrubar: ((e: Error) => void) | undefined;
    const llm: LLMProvider = {
      chat: vi
        .fn<LLMProvider["chat"]>()
        .mockResolvedValueOnce(toolUse("criar_orcamento", { token_confirmacao: "tok" }))
        .mockImplementationOnce(() => new Promise<LLMResponse>((_, rej) => (derrubar = rej))),
    };
    const { agente } = montar(llm, { client: new EscritaSimuladaClient(new MockBrindeMeClient()), dir });

    const turno = agente.processarLote(pedido(TEL, ["o1"], "pode criar"));
    await vi.waitFor(() => expect(derrubar).toBeDefined());
    expect(new RepositorioConversas(dir).carregar(TEL).estado.orcamentoTokens.tok).toMatch(/^TESTE-/);

    derrubar!(new Error("processo caiu"));
    await expect(turno).rejects.toThrow("processo caiu");
  });

  it("limite por hora: transfere uma vez com aviso; depois a IA fica quieta", async () => {
    const llm = new ScriptedLLM([endTurn("1"), endTurn("2")]);
    const { agente } = montar(llm, { respostasPorHora: 2 });
    await agente.processarLote(pedido(TEL, ["l1"]));
    await agente.processarLote(pedido(TEL, ["l2"]));

    const r = await agente.processarLote(pedido(TEL, ["l3"]));
    expect(r).toMatchObject({ respostas: [MSG_LIMITE], modo: "humano" });
    expect(r.avisoAtendente).toContain("limite de respostas por hora");
    expect(await agente.processarLote(pedido(TEL, ["l4"]))).toEqual({ respostas: [], modo: "humano" });
    expect(llm.seen).toHaveLength(2);
  });

  it("devolver depois do limite: a IA volta a responder", async () => {
    const llm = new ScriptedLLM([endTurn("1"), endTurn("de volta")]);
    const { agente } = montar(llm, { respostasPorHora: 1 });
    await agente.processarLote(pedido(TEL, ["d1"]));
    await agente.processarLote(pedido(TEL, ["d2"]));
    await agente.processarEvento({ tipo: "devolver", telefone: TEL });
    expect(await agente.processarLote(pedido(TEL, ["d3"]))).toEqual({ respostas: ["de volta"], modo: "ia" });
  });

  it("eventos: atendente repetido não duplica; devolver volta à IA com a nota e zera as falhas", async () => {
    const { agente, repo } = montar(new ScriptedLLM());
    const ev = { tipo: "mensagem_atendente" as const, telefone: TEL, id: "at9", texto: "assumi", timestamp: T };
    await agente.processarEvento(ev);
    await agente.processarEvento(ev);
    expect(await agente.processarEvento({ tipo: "devolver", telefone: TEL, nota: "pagou" })).toEqual({ modo: "ia" });
    const c = repo.carregar(TEL);
    expect(c.estado.historico.map((m) => m.content)).toEqual([
      "[Atendente]: assumi",
      '[Atendente devolveu o atendimento à IA com a nota: "pagou"]',
    ]);
    expect(c.estado.falhasConsecutivas).toBe(0);
  });

  it("evento durante o turno: o turno termina e a conversa fica em humano", async () => {
    const { agente, repo } = montar(new ScriptedLLM([endTurn("resposta")], 100));
    const turno = agente.processarLote(pedido(TEL, ["x1"]));
    await new Promise((r) => setTimeout(r, 20));
    await agente.processarEvento({ tipo: "mensagem_atendente", telefone: TEL, id: "at2", texto: "eu assumo", timestamp: T });
    const r = await turno;
    expect(r.modo).toBe("humano");
    expect(repo.carregar(TEL).estado.modo).toBe("humano");
  });

  it("transferência pela ferramenta: aviso legível com a pergunta sem resposta", async () => {
    const llm = new ScriptedLLM([
      toolUse("consultar_conhecimento", { pergunta: "qual o horário de vocês?" }),
      toolUse("transferir_humano", { motivo: "lacuna_conhecimento", prioridade: "normal" }),
      endTurn("Vou chamar alguém da equipe."),
    ]);
    const { agente } = montar(llm);
    const r = await agente.processarLote(pedido(TEL, ["tr1"], "qual o horário de vocês?"));
    expect(r.modo).toBe("humano");
    expect(r.respostas).toEqual(["Vou chamar alguém da equipe."]);
    expect(r.avisoAtendente).toContain("Pergunta sem resposta: qual o horário de vocês?");
  });

  it("arquivo do lote fica no estado e registrar_arte usa o caminho real", async () => {
    const llm = new ScriptedLLM([toolUse("registrar_arte", { descricao_arquivo: "logo.png" }), endTurn("Recebi!")]);
    const { agente, repo } = montar(llm);
    const arquivo = { caminho: "C:/artes/abc.png", mime: "image/png", bytes: 2_048, nome: "logo.png" };
    await agente.processarLote({ turnoId: calcularTurnoId(["f9"]), telefone: TEL, mensagens: [{ id: "f9", timestamp: T, texto: "", arquivo }] });
    const c = repo.carregar(TEL);
    expect(c.estado.arquivosRecebidos).toEqual([{ nome: "logo.png", caminho: "C:/artes/abc.png", mime: "image/png", bytes: 2_048 }]);
    expect(c.estado.artes[0].arquivo).toBe("C:/artes/abc.png");
  });

  it("resposta vazia do modelo vira lista vazia", async () => {
    const { agente } = montar(new ScriptedLLM([endTurn("")]));
    expect(await agente.processarLote(pedido(TEL, ["v1"]))).toEqual({ respostas: [], modo: "ia" });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rode: `npx vitest run tests/agenteDefinitivo.test.ts` → FAIL — import de `../src/api/agenteDefinitivo.js` não resolve.

- [ ] **Passo 3: Implementar** — `src/api/agenteDefinitivo.ts`

```ts
import { TurnoEmAndamentoError, type Agente } from "../contrato/agente.js";
import type {
  Evento,
  MensagemLote,
  PedidoMensagens,
  RespostaEvento,
  RespostaMensagens,
} from "../contrato/esquemas.js";
import { formatarParaWhatsApp, loteParaTexto } from "../contrato/texto.js";
import { addMessage, type ConversationState } from "../agent/state.js";
import { runTurn, type TurnResult } from "../agent/runTurn.js";
import type { LLMProvider } from "../llm/types.js";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";
import { Logger } from "../logging/logger.js";
import type { Conversa, RepositorioConversas } from "../conversas/repositorio.js";
import type { MotivoTransferencia } from "../tools/transferirHumano.js";
import { formatarAvisoTransferencia, resumoDoEstado } from "./resumoAtendente.js";

export const MSG_FALHA =
  "Tive um problema técnico agora. Já chamei alguém da nossa equipe para continuar com você por aqui. 🙏";
export const MSG_LIMITE =
  "Recebemos muitas mensagens em pouco tempo. Uma pessoa da nossa equipe vai continuar com você por aqui. 🙏";
export const FALHAS_DO_LOTE_PARA_TRANSFERIR = 2;

export interface DepsAgente {
  repo: RepositorioConversas;
  llm: LLMProvider;
  client: BrindeMeClient;
  tetoMs: number;
  respostasPorHora: number;
  /** Para os evals: recebe o resultado bruto de cada turno. */
  aoTurno?: (resultado: TurnResult) => void;
}

export class AgenteDefinitivo implements Agente {
  private readonly conversas = new Map<string, Conversa>();
  private readonly emAndamento = new Set<string>();

  constructor(private readonly deps: DepsAgente) {}

  async processarLote(pedido: PedidoMensagens): Promise<RespostaMensagens> {
    const conversa = this.conversa(pedido.telefone);
    const guardado = conversa.turnos.find((t) => t.turnoId === pedido.turnoId);
    if (guardado) return guardado.resposta;
    if (this.emAndamento.has(pedido.telefone)) throw new TurnoEmAndamentoError();
    this.emAndamento.add(pedido.telefone);
    try {
      return await this.executar(conversa, pedido);
    } finally {
      this.emAndamento.delete(pedido.telefone);
    }
  }

  async processarEvento(evento: Evento): Promise<RespostaEvento> {
    const conversa = this.conversa(evento.telefone);
    const { estado } = conversa;
    if (evento.tipo === "mensagem_atendente") {
      if (!conversa.idsVistos.includes(evento.id)) {
        estado.modo = "humano";
        addMessage(estado, "assistant", `[Atendente]: ${evento.texto}`);
        conversa.idsVistos.push(evento.id);
      }
    } else {
      estado.modo = "ia";
      estado.falhasConsecutivas = 0;
      conversa.respostasRecentes = [];
      addMessage(
        estado,
        "assistant",
        evento.nota
          ? `[Atendente devolveu o atendimento à IA com a nota: "${evento.nota}"]`
          : "[Atendente devolveu o atendimento à IA]"
      );
    }
    this.deps.repo.salvar(conversa);
    return { modo: estado.modo };
  }

  private conversa(telefone: string): Conversa {
    let c = this.conversas.get(telefone);
    if (!c) {
      c = this.deps.repo.carregar(telefone);
      this.conversas.set(telefone, c);
    }
    return c;
  }

  private async executar(conversa: Conversa, pedido: PedidoMensagens): Promise<RespostaMensagens> {
    const { estado } = conversa;
    const logger = new Logger(estado.conversaId, { turnoId: pedido.turnoId });
    const novas = pedido.mensagens.filter((m) => !conversa.idsVistos.includes(m.id));
    if (novas.length === 0) return { respostas: [], modo: estado.modo };
    const texto = loteParaTexto(novas);

    if (estado.modo === "humano") {
      addMessage(estado, "user", texto);
      return this.concluir(conversa, pedido, novas, { respostas: [], modo: "humano" });
    }

    if (this.excedeuLimite(conversa)) {
      addMessage(estado, "user", texto);
      return this.transferirPeloSistema(conversa, pedido, novas, MSG_LIMITE, "outro", "limite de respostas por hora", logger);
    }

    registrarArquivos(estado, novas);
    const posicaoDaMensagem = estado.historico.length;
    const controle = new AbortController();
    const teto = setTimeout(() => controle.abort(), this.deps.tetoMs);
    try {
      const r = await runTurn(texto, estado, this.deps.llm, this.deps.client, logger, {
        signal: controle.signal,
        aoEfeito: () => this.deps.repo.salvar(conversa),
      });
      this.deps.aoTurno?.(r);
      conversa.respostasRecentes.push(new Date().toISOString());
      return this.concluir(conversa, pedido, novas, {
        respostas: formatarParaWhatsApp(r.response ?? ""),
        modo: estado.modo,
        ...(r.transferencia
          ? { avisoAtendente: formatarAvisoTransferencia(pedido.telefone, r.transferencia, r.lacunas) }
          : {}),
      });
    } catch (err) {
      desfazerMensagem(estado, posicaoDaMensagem, texto);
      const estourou = controle.signal.aborted;
      const falhas = (conversa.falhasPorTurno[pedido.turnoId] ?? 0) + 1;
      conversa.falhasPorTurno[pedido.turnoId] = falhas;
      logger.log({
        type: "alerta",
        gravidade: "alta",
        motivo: estourou ? "teto_do_turno" : `falha_no_turno: ${String(err).slice(0, 200)}`,
      });
      if (estourou || falhas >= FALHAS_DO_LOTE_PARA_TRANSFERIR) {
        addMessage(estado, "user", texto);
        const observacao = estourou ? "turno passou do teto de tempo" : "o modelo falhou duas vezes neste lote";
        return this.transferirPeloSistema(conversa, pedido, novas, MSG_FALHA, "falha_sistema", observacao, logger);
      }
      this.deps.repo.salvar(conversa);
      throw err;
    } finally {
      clearTimeout(teto);
    }
  }

  private excedeuLimite(conversa: Conversa): boolean {
    const umaHoraAtras = Date.now() - 3_600_000;
    conversa.respostasRecentes = conversa.respostasRecentes.filter((t) => Date.parse(t) > umaHoraAtras);
    return conversa.respostasRecentes.length >= this.deps.respostasPorHora;
  }

  private transferirPeloSistema(
    conversa: Conversa,
    pedido: PedidoMensagens,
    novas: MensagemLote[],
    mensagem: string,
    motivo: MotivoTransferencia,
    observacao: string,
    logger: Logger
  ): RespostaMensagens {
    const { estado } = conversa;
    estado.modo = "humano";
    addMessage(estado, "assistant", mensagem);
    logger.log({ type: "transfer", motivo, prioridade: "alta" });
    return this.concluir(conversa, pedido, novas, {
      respostas: [mensagem],
      modo: "humano",
      avisoAtendente: formatarAvisoTransferencia(pedido.telefone, resumoDoEstado(estado, motivo, observacao)),
    });
  }

  private concluir(
    conversa: Conversa,
    pedido: PedidoMensagens,
    novas: MensagemLote[],
    resposta: RespostaMensagens
  ): RespostaMensagens {
    conversa.idsVistos.push(...novas.map((m) => m.id));
    conversa.turnos.push({ turnoId: pedido.turnoId, resposta });
    delete conversa.falhasPorTurno[pedido.turnoId];
    this.deps.repo.salvar(conversa);
    return resposta;
  }
}

function registrarArquivos(estado: ConversationState, novas: MensagemLote[]): void {
  const lista = (estado.arquivosRecebidos ??= []);
  for (const m of novas) {
    if (m.arquivo && !lista.some((a) => a.caminho === m.arquivo!.caminho)) {
      lista.push({ nome: m.arquivo.nome, caminho: m.arquivo.caminho, mime: m.arquivo.mime, bytes: m.arquivo.bytes });
    }
  }
}

function desfazerMensagem(estado: ConversationState, posicao: number, texto: string): void {
  const m = estado.historico[posicao];
  if (m?.role === "user" && m.content === texto) estado.historico.splice(posicao, 1);
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rode: `npx vitest run tests/agenteDefinitivo.test.ts` → PASS (15). `npm test && npm run typecheck` → verde.

- [ ] **Passo 5: Commit**

```bash
git add src/api/agenteDefinitivo.ts tests/agenteDefinitivo.test.ts
git commit -m "feat(fase-4): API definitiva do agente — turno com chave, teto de 90s, desfazer turno e limites"
```

---

### Task 6 (B6): Entrada da API, configuração e contrato contra a API definitiva

**Arquivos:**
- Criar: `src/api/index.ts`, `tests/contratoApiDefinitiva.test.ts`
- Modificar: `src/config.ts`, `scripts/whatsapp.ts`, `package.json`, `.env.example`

**Interfaces:**
- Consome: `AgenteDefinitivo` (B5), `RepositorioConversas` (B1), `criarServidorAgente` (A2), `avisarConhecimentoECatalogo`
  (A5), `sincronizarCatalogo`, `FileProductIndexStore` (`src/catalogo/indice.ts`), `bateriaContrato` (A2).
- Produz: `config.agente.{conversasDir, tetoMs, respostasPorHora}`; `npm run agente`; `npm run whatsapp` passa a subir a API.

- [ ] **Passo 1: Escrever o teste que falha** — `tests/contratoApiDefinitiva.test.ts`

```ts
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgenteDefinitivo } from "../src/api/agenteDefinitivo.js";
import { RepositorioConversas } from "../src/conversas/repositorio.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { ScriptedLLM } from "./helpers/llmRoteirizado.js";
import { bateriaContrato } from "./helpers/bateriaContrato.js";

bateriaContrato(
  "API definitiva",
  ({ atrasoMs }) =>
    new AgenteDefinitivo({
      repo: new RepositorioConversas(mkdtempSync(join(tmpdir(), "contrato-"))),
      llm: new ScriptedLLM([], atrasoMs),
      client: new MockBrindeMeClient(),
      tetoMs: 90_000,
      respostasPorHora: 30,
    })
);
```

- [ ] **Passo 2: Rodar**

Rode: `npx vitest run tests/contratoApiDefinitiva.test.ts`
Esperado: PASS (7) — a API definitiva já cumpre o contrato do dublê. Se algum falhar, a falha está na Task B5: corrija
lá, nunca na bateria.

- [ ] **Passo 3: Implementar a entrada e a configuração**

`src/config.ts` — o bloco `agente` passa a ser:

```ts
  agente: {
    porta: int(process.env.AGENTE_PORTA, 3030),
    url: (process.env.AGENTE_URL ?? "http://127.0.0.1:3030").replace(/\/+$/, ""),
    conversasDir: process.env.CONVERSAS_DIR ?? "data/conversas",
    /** Precisa ser menor que AGENTE_TIMEOUT_MS da ponte (120s). */
    tetoMs: int(process.env.TURNO_TETO_MS, 90_000),
    respostasPorHora: int(process.env.RESPOSTAS_POR_HORA, 30),
  },
```

`src/api/index.ts`:

```ts
import "dotenv/config";
import { config } from "../config.js";
import { criarServidorAgente } from "../contrato/servidorHttp.js";
import { RepositorioConversas } from "../conversas/repositorio.js";
import { FileProductIndexStore, sincronizarCatalogo } from "../catalogo/indice.js";
import { createBrindeMeClient } from "../integrations/brindeme/factory.js";
import { AnthropicProvider } from "../llm/anthropic.js";
import { avisarConhecimentoECatalogo } from "../partida.js";
import { AgenteDefinitivo } from "./agenteDefinitivo.js";

const SEIS_HORAS_MS = 6 * 3_600_000;

async function main(): Promise<void> {
  const client = createBrindeMeClient();
  console.log(`API da loja: ${config.brindeMe.mode} · escrita de orçamento: ${config.brindeMe.escritaOrcamento}`);
  await avisarConhecimentoECatalogo(client);

  const store = new FileProductIndexStore();
  if (store.carregar().produtos.length === 0) {
    console.error("Índice do catálogo vazio: o agente não sobe sem ele. Rode antes: npm run sync:catalogo (a 1ª carga leva minutos).");
    process.exit(1);
  }

  const sincronizar = () =>
    sincronizarCatalogo(client, store, {
      concorrencia: config.catalogo.concorrencia,
      maxIdadeHoras: config.catalogo.maxIdadeHoras,
    })
      .then((r) =>
        console.log(`Catálogo sincronizado: ${r.ativos} ativos, ${r.novos} novos, ${r.removidos} removidos${r.completo ? "" : " (incompleto)"}`)
      )
      .catch((err) =>
        console.error(`Sync do catálogo falhou; o índice anterior continua valendo: ${err instanceof Error ? err.message : err}`)
      );
  // Só com a API real: em mock, o sync gravaria os produtos de teste dentro do índice real.
  if (config.brindeMe.mode === "http") {
    void sincronizar();
    setInterval(() => void sincronizar(), SEIS_HORAS_MS);
  }

  const log = (e: Record<string, unknown>) => console.error(JSON.stringify(e));
  const agente = new AgenteDefinitivo({
    repo: new RepositorioConversas(config.agente.conversasDir, log),
    llm: new AnthropicProvider(),
    client,
    tetoMs: config.agente.tetoMs,
    respostasPorHora: config.agente.respostasPorHora,
  });
  criarServidorAgente(agente, log).listen(config.agente.porta, "127.0.0.1", () => {
    console.log(`Agente em http://127.0.0.1:${config.agente.porta}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`scripts/whatsapp.ts` — `const AGENTE_PADRAO = "direto";` vira `const AGENTE_PADRAO = "api";`

`package.json` — em `"scripts"`, acrescente `"agente": "tsx src/api/index.ts",`

`.env.example` — na seção `# --- WhatsApp (Fase 4) ---`, acrescente:

```
CONVERSAS_DIR=data/conversas
TURNO_TETO_MS=90000
RESPOSTAS_POR_HORA=30
```

- [ ] **Passo 4: Verificar**

Rode: `npm test && npm run typecheck` → verde.
Rode: `npm run agente` com `BRINDEME_MODE=mock` → Esperado: estado da base, índice montado dos mocks,
`Agente em http://127.0.0.1:3030`. Em outro terminal, `curl -s http://127.0.0.1:3030/api/health` → `{"ok":true}`.
Pare com Ctrl+C.

- [ ] **Passo 5: Commit**

```bash
git add src/api/index.ts src/config.ts scripts/whatsapp.ts package.json .env.example tests/contratoApiDefinitiva.test.ts
git commit -m "feat(fase-4): entrada da API definitiva (índice obrigatório, sync a cada 6h) e npm run whatsapp com a API"
```

---

### Task 7 (B7): Evals pela API nova

**Arquivos:**
- Modificar: `evals/runEvals.ts`

Sem teste automático: os evals chamam o modelo de verdade e rodam na Task B8. O `typecheck` cobre a compilação.

**Interfaces:**
- Consome: `AgenteDefinitivo` com `aoTurno` (B5), `RepositorioConversas` (B1), `calcularTurnoId`, `LIMITE_TEXTO` (A1).
- Produz: `npm run evals -- --via-api [id-do-cenário]`.

- [ ] **Passo 1: Implementar**

Em `evals/runEvals.ts`:

1. Imports novos, junto dos outros:

```ts
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import type { TurnResult } from "../src/agent/runTurn.js";
import { AgenteDefinitivo } from "../src/api/agenteDefinitivo.js";
import { RepositorioConversas } from "../src/conversas/repositorio.js";
import { calcularTurnoId } from "../src/contrato/turno.js";
import { LIMITE_TEXTO } from "../src/contrato/esquemas.js";
import { config } from "../src/config.js";
```

(`readdirSync`, `readFileSync` já vêm de `"fs"` no import existente; acrescente `mkdtempSync` nele em vez de criar
outro import de `"fs"`.)

2. Depois das constantes de cor:

```ts
const VIA_API = process.argv.includes("--via-api");

async function turnoPelaApi(
  agente: AgenteDefinitivo,
  capturado: { r?: TurnResult },
  telefone: string,
  texto: string,
  id: string
): Promise<TurnResult> {
  capturado.r = undefined;
  const resposta = await agente.processarLote({
    turnoId: calcularTurnoId([id]),
    telefone,
    mensagens: [{ id, timestamp: new Date().toISOString(), texto: texto.slice(0, LIMITE_TEXTO) }],
  });
  const bruto = capturado.r ?? { response: null, toolsCalled: [], transferred: false, lacunas: [] };
  return { ...bruto, response: resposta.respostas.join("\n\n") || null };
}
```

3. Em `runScenario`, logo depois de `const logger = new Logger(\`eval-${scenario.id}\`);`:

```ts
  const capturado: { r?: TurnResult } = {};
  const agenteApi = VIA_API
    ? new AgenteDefinitivo({
        repo: new RepositorioConversas(mkdtempSync(join(tmpdir(), `eval-${scenario.id}-`))),
        llm,
        client,
        tetoMs: config.agente.tetoMs,
        respostasPorHora: 1_000,
        aoTurno: (r) => {
          capturado.r = r;
        },
      })
    : null;
```

4. O laço das mensagens passa a ser:

```ts
  for (const [i, msg] of scenario.mensagens.entries()) {
    const userMsg = msg.startsWith("/arte ")
      ? `[IMAGEM enviada: ${msg.slice(6).trim()}]`
      : msg;

    const result = agenteApi
      ? await turnoPelaApi(agenteApi, capturado, telefone, userMsg, `${scenario.id}-${i}`)
      : await runTurn(userMsg, state, llm, client, logger);
```

(o resto do corpo do laço não muda).

5. Em `main`, troque `const specificScenario = process.argv[2];` por:

```ts
  const specificScenario = process.argv.slice(2).find((a) => !a.startsWith("--"));
```

e, logo depois do título `=== Evals — Agente de Atendimento ===`, acrescente:

```ts
  if (VIA_API) console.log(`${GRAY}Rodando pela API definitiva (AgenteDefinitivo), não pelo runTurn direto.${RESET}\n`);
```

- [ ] **Passo 2: Verificar**

Rode: `npm run typecheck && npm test` → verde.

- [ ] **Passo 3: Commit**

```bash
git add evals/runEvals.ts
git commit -m "feat(fase-4): evals podem rodar pela API definitiva (--via-api)"
```

---

### Task 8 (B8): Verificação antes do chip (real, uma vez)

Usa a API da loja **só para leitura** e o modelo de verdade (custo de tokens). Não muda código; se algo falhar, abre
issue (seção 7.D da spec) e só corrige depois da revisão do João.

- [ ] **Passo 1:** `npm run check:api` → acesso ok e total de produtos. Falhou → pare: token ou URL no `.env`.
- [ ] **Passo 2:** `npm run sync:catalogo` → índice em `data/produtos-index.json`, `completo: true`.
- [ ] **Passo 3:** `npm run evals` (caminho antigo) e `npm run evals -- --via-api` (caminho novo).
- [ ] **Passo 4:** `npm run avaliar:recomendacao`.
- [ ] **Passo 5: Registrar** em `docs/dogfooding-fase-4.md`, seção `## Verificação antes do chip (AAAA-MM-DD)`: a saída
  resumida de cada comando (sem token, sem dado de cliente).

**Regra de parada:** cenário que passa no caminho antigo e falha no `--via-api` é bug da API nova → issue e correção
antes do dogfooding. Cenário que falha nos dois caminhos é anterior à Fase 4 → issue para o dono da Fase 3, sem
bloquear, **exceto** os cenários 05 (orçamento completo) e 10 (pede atendente), que bloqueiam o dogfooding.

- [ ] **Passo 6: Commit**

```bash
git add docs/dogfooding-fase-4.md
git commit -m "docs(fase-4): verificação real antes do chip"
```

---

### Task 9 (B9): Dogfooding final com a API definitiva, e issues

Quem conduz é o João; quem escreve o roteiro e registra é o Gui (ou quem estiver executando este plano).

- [ ] **Passo 1: `.env` do teste** — `BRINDEME_MODE=http`, `ORCAMENTO_ESCRITA=simulada`, `KB_INCLUIR_RASCUNHOS=true`,
  `WHATSAPP_LIBERADOS=` com os números dos testadores (separados por vírgula).

- [ ] **Passo 2: Subir** — `npm run whatsapp` (agora sobe a API definitiva). Se a sessão do chip já foi pareada na
  rodada 1, não aparece QR.

- [ ] **Passo 3: Roteiro** — em `docs/dogfooding-fase-4.md`, seção `## Rodada final — API definitiva (AAAA-MM-DD)`,
  uma linha por cenário com as colunas Esperado, Observado, Print, turnoId:

| # | Cenário | Esperado |
|---|---|---|
| 1 | "oi" até o orçamento | Orçamento `TESTE-…`; nada no painel da loja |
| 2 | Três mensagens picadas em menos de 5s | Um lote, uma resposta |
| 3 | Arte em imagem, arte em PDF e um vídeo | As duas artes registradas com o caminho real; vídeo recusado com explicação |
| 4 | Áudio | Resposta fixa pedindo texto |
| 5 | "qual o horário de vocês?" | Lacuna → transferência; "Mensagem para mim" traz "Pergunta sem resposta" |
| 6 | Atendente responde pelo celular → cliente escreve → `#devolver <número> nota` | IA quieta até o `#devolver`; "✅ devolvido"; a IA volta na próxima mensagem do cliente |
| 7 | Derrubar ponte e agente (Ctrl+C) no meio de um turno e subir de novo | Nenhuma mensagem perdida; no máximo uma parte repetida |
| 8 | Derrubar só o agente (`npm run whatsapp:ponte` sozinho) por mais de 10 min | Cliente recebe o aviso de instabilidade uma vez; alerta em "Mensagem para mim"; ao religar o agente (`npm run agente`), a varredura responde o que ficou |
| 9 | API da loja fora (troque `BRINDEME_BASE_URL` por uma URL inválida e reinicie o agente) | Duas falhas → transferência `falha_sistema` com resumo |

- [ ] **Passo 4: Issues** — para cada linha que não passou e cada erro visto fora do roteiro, prepare o corpo num
  arquivo temporário fora do repo e **mostre a lista ao João antes de abrir**. Com o OK dele:

```bash
gh label create fase-4 --repo caioqueirozzz/agente-brindeme --color 1D76DB --description "Fase 4 — WhatsApp" || true
gh label create dogfooding --repo caioqueirozzz/agente-brindeme --color FBCA04 --description "Achado no teste real" || true
gh issue create --repo caioqueirozzz/agente-brindeme \
  --title "[Fase 4] <cenário>: <sintoma>" \
  --label fase-4 --label dogfooding --assignee @me \
  --body-file <arquivo-do-corpo>.md
```

`--assignee @me` atribui a quem roda o comando (o João, na máquina dele). Corpo da issue:

```markdown
**Cenário:** <número> — <nome>
**Passos:**
1. …
**Esperado:** …
**Observado:** …
**turnoId:** `<id>` (em `logs/ponte.jsonl` e `logs/<conversaId>.jsonl`)
**Print:** anexado pela interface web (o `gh` não sobe imagem)
```

Nada de telefone completo, credencial ou dado de cliente real no corpo nem no print.

- [ ] **Passo 5: Fechar o registro** — no `docs/dogfooding-fase-4.md`, cada linha que falhou aponta para o número da
  issue. A fase termina quando os 9 cenários passam ou cada falha tem a sua issue aberta. A correção de cada issue é
  feita pelo João com o Claude, uma por vez, começando por um teste que reproduz o erro.

- [ ] **Passo 6: Commit**

```bash
git add docs/dogfooding-fase-4.md
git commit -m "docs(fase-4): dogfooding final com a API definitiva"
```
