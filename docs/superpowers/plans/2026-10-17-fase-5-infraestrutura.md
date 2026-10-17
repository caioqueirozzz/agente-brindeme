# Fase 5 — Infraestrutura, Segurança e Auditoria — Plano de implementação

**Objetivo:** Fechar as lacunas de operação da Fase 4 — kill switch em runtime, ferramentas desligáveis sem deploy,
alertas proativos, métricas ao vivo, verificação de segredos e retenção de dados.

**Stack:** Node ≥ 20, TypeScript ESM, vitest 2, arquitetura de dois processos separados (agente + ponte).

**Base:** branch `fase-4-integracao-whatsapp` concluída. 653 testes verdes (3 arquivos falham por falta de
`npm install`). `data/estado-sistema.json` será o canal de controle compartilhado entre os dois processos.

## Estado da Fase 4 (o que existe)

- **Logging**: JSONL por conversa em `logs/` + `logs/api.jsonl`; mascaramento de CPF, email e telefone
- **Circuit breaker**: disjuntor na integração com a API Brinde.me
- **Modo humano**: atendente pode assumir/devolver via `#devolver` no chip
- **Orçamento simulado**: `ORCAMENTO_ESCRITA=simulada` protege a API real por padrão
- **Kill switch parcial**: `WHATSAPP_LIBERADOS` restringe quem é atendido, mas exige reinício do processo

## Lacunas a fechar

| # | Lacuna | Task |
|---|---|---|
| 1 | Sem kill switch em runtime — só restart do processo | C1 |
| 2 | Sem como desligar ferramenta individual sem deploy | C2 |
| 3 | Alertas críticos só nos logs, nunca no chip do supervisor | C3 |
| 4 | Sem métricas ao vivo (volume, custos, transferências) | C4 |
| 5 | Sem verificação de segredos no startup | C5 |
| 6 | Dados acumulam indefinidamente (LGPD) | C5 |

## Restrições globais

- Nunca `git push`, nunca abrir PR. Commit local ao fim de cada task.
- Nunca commitar `.env` ou `data/`. Credenciais nunca vão para arquivo versionado.
- Código, nomes e mensagens em português. Imports relativos terminam em `.js`.
- Ao fim de cada task: `npm test && npm run typecheck` verdes.
- Mensagem de commit `feat(fase-5): …` / `fix(fase-5): …`.

## Estrutura de arquivos nova

| Arquivo | Responsabilidade |
|---|---|
| `src/controle/estadoSistema.ts` | Lê/escreve `data/estado-sistema.json`; cache 30s; nunca lança |
| `src/api/alertas.ts` | `MonitorAlertas`: throttle por tipo, emite via callback |
| `src/metricas/contadores.ts` | Contadores em memória; expõe snapshot |
| `scripts/verificarEnv.ts` | Checa chaves obrigatórias; exit 1 se ausente |
| `scripts/limparDados.ts` | Remove conversas/artes/logs antigos (LGPD) |
| `.env.production.example` | Referência de produção sem valores inseguros |

---

### Task C1: Kill switch geral e comandos `#suspender` / `#retomar`

**Arquivos:**
- Criar: `src/controle/estadoSistema.ts`
- Modificar: `src/whatsapp/atendente.ts`, `src/api/agenteDefinitivo.ts`
- Teste: `tests/estadoSistema.test.ts` + casos em `tests/killswitch.test.ts`

**Interfaces:**
```ts
// src/controle/estadoSistema.ts
export interface EstadoSistema {
  suspenso: boolean;
  suspensoPor?: string;
  suspensoEm?: string;
  ferramentasDesligadas?: string[];  // usado pela C2
}
export function lerEstadoSistema(arquivo?: string): EstadoSistema   // cache 30s
export function escreverEstadoSistema(estado: EstadoSistema, arquivo?: string): void
export function invalidarCache(): void  // para testes
```

**Comportamento:**
- `AgenteDefinitivo.processarLote`: após o check de `guardado`, se `suspenso` → retorna
  `{ respostas: [MSG_SUSPENSAO], modo: "ia" }` sem salvar o turno (cliente pode tentar de novo)
- `DepsAgente` ganha `lerEstado?: () => EstadoSistema` (override para testes)
- `#suspender [motivo]` → escreve `{ suspenso: true }` + envia confirmação em "Mensagem para mim"
- `#retomar` → escreve `{ suspenso: false }` + confirma
- Apenas mensagens `deMim` em "Mensagem para mim" podem suspender (mesma segurança do `#devolver`)
- `MSG_SUSPENSAO = "Estamos fora do ar temporariamente. A nossa equipe responde em breve. 🙏"`

**Critério:** `#suspender` no chip → agente para em ≤ 30s; `#retomar` → retoma sem restart.

---

### Task C2: Ferramentas desligadas por runtime

**Arquivos:**
- Modificar: `src/agent/runTurn.ts`, `src/config.ts`, `src/api/agenteDefinitivo.ts`, `.env.example`
- Criar: (usa `estadoSistema.ts` da C1)
- Teste: casos em `tests/killswitch.test.ts` + `tests/runTurnFase4.test.ts`

**Interfaces:**
```ts
// OpcoesTurno em runTurn.ts
export interface OpcoesTurno {
  signal?: AbortSignal;
  aoEfeito?: () => void;
  aoTransferir?: (...) => void;
  ferramentasDesligadas?: Set<string>;  // nova
}
```

**Comportamento:**
- `FERRAMENTAS_DESLIGADAS=criar_orcamento` em `.env` → desligado no startup, requer restart
- `#desligar <ferramenta>` / `#religar <ferramenta>` → runtime via `data/estado-sistema.json`
- `runTurn`: se `ferramenta ∈ ferramentasDesligadas` → `{ erro: "ferramenta_desligada", instrucao: "transferir", motivo_sugerido: "falha_sistema" }`
- `AgenteDefinitivo.executar`: combina config + runtime → passa `ferramentasDesligadas` a `runTurn`

---

### Task C3: Alertas proativos para "Mensagem para mim"

**Arquivos:**
- Criar: `src/api/alertas.ts`
- Modificar: `src/api/agenteDefinitivo.ts`, `src/api/index.ts`
- Teste: `tests/alertas.test.ts`

**Nota de arquitetura:** agente e ponte são processos separados. O alerta é escrito em
`data/alertas-pendentes.json` pelo processo do agente e lido na varredura da ponte.

**Eventos que disparam alerta:**
| Evento | Trigger | Throttle |
|---|---|---|
| `falha_sistema_repetida` | 3+ turnos transferidos por `falha_sistema` na última hora | 1/hora |
| `turno_teto_repetido` | 3+ tetos estourados na última hora | 1/hora |
| `api_401_403` | Qualquer 401 ou 403 da Brinde.me | 1/ocorrência |
| `custo_alto` | Tokens diários > `ALERTA_TOKENS_DIARIO` (padrão 500k) | 1/dia |

---

### Task C4: `GET /api/status` — métricas ao vivo

**Arquivos:**
- Criar: `src/metricas/contadores.ts`
- Modificar: `src/contrato/servidorHttp.ts`, `src/api/agenteDefinitivo.ts`
- Teste: `tests/metricasStatus.test.ts`

**Rota:** `GET /api/status` → JSON com `suspenso`, `conversas_ativas`, `orcamentos_criados_hoje`,
`transferencias_hoje`, `falhas_api_hoje`, `tokens_hoje`, `uptime_s`. Contadores em memória; reinício zera.

---

### Task C5: Verificação de segredos e retenção de dados

**Arquivos:**
- Criar: `scripts/verificarEnv.ts`, `scripts/limparDados.ts`, `.env.production.example`
- Modificar: `src/api/index.ts`, `src/whatsapp/index.ts`

**`verificarEnv.ts`:** exit 1 se chave obrigatória ausente; aviso se `BRINDEME_MODE=mock` em produção
ou `KB_INCLUIR_RASCUNHOS=true` fora de dev.

**`limparDados.ts`:** remove conversas/artes antigas conforme `RETENCAO_*_DIAS`; aceita `--simular`.

## Critério de pronto da Fase 5

1. `npm test && npm run typecheck` verdes com os novos testes
2. `#suspender` no chip para o agente em ≤ 30s sem reiniciar processo; `#retomar` retoma
3. `FERRAMENTAS_DESLIGADAS=criar_orcamento` → agente tenta transferir em vez de criar
4. Falha de sistema repetida (3× em 1h) → supervisor recebe alerta no chip
5. `npm run verificar:env` falha com exit 1 se `OPENAI_API_KEY` ausente
6. `npm run limpar:dados -- --simular` lista elegíveis sem deletar nada
