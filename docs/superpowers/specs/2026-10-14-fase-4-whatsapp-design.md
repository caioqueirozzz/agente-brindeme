# Fase 4 — Agente no WhatsApp (design)

- **Data:** 14/10/2026 · **Prazo:** sexta, 16/10/2026
- **Responsáveis:** João (ponte, fila, atendente) e Guilherme (API do agente, estado, correções)
- **Base:** branch `fase-3-conhecimento-recomendacao` (`80bf90d`, PR #3), que está empilhada sobre a Fase 2 (PR #1)
- **Status:** design aprovado por seções em 13–14/10; esta spec aguarda revisão do João

## 1. Objetivo e critério de pronto

Colocar o agente das Fases 1–3 para atender clientes num número de WhatsApp dedicado, usando **whatsapp-web.js**,
com um atendente humano capaz de assumir e devolver a conversa pelo próprio chip.

A fase está pronta quando:

1. `npm run whatsapp` sobe a ponte e o agente, e o agente responde no chip de teste;
2. os testes automáticos (vitest) e o `typecheck` passam, incluindo o teste de contrato contra o dublê e contra a API
   definitiva;
3. os 9 cenários do dogfooding (seção 7.C) passam ou têm issue aberta (seção 7.D).

## 2. Contexto e restrições

- **Reunião de 13/10 (Luis):** João e Gui fazem a integração com whatsapp-web.js. O escopo é só o agente, sem CRM, e o
  teste roda no número que o Luis forneceu.
- **Desvio consciente do planejamento:** o planejamento do Caio (09/10) recomendava a Cloud API oficial da Meta. O Luis
  escolheu whatsapp-web.js, que traz risco de bloqueio do número; para teste, isso foi aceito.
- **Referência:** a ponte do LembreMe (`index.mjs`, em Node; o agente de lá é em Python). O autor autorizou o uso da
  arquitetura. Ela é **reescrita em TypeScript** neste repo, não copiada.
- **Ambiente:** o sistema roda no PC do João até sexta. O código fica pronto para container, com as pastas de sessão e de
  estado configuráveis.
- **Fase 3:** a recomendação usa o índice local `data/produtos-index.json` (`npm run sync:catalogo`). Os 17 itens da
  base de conhecimento estão em rascunho.

## 3. Decisões aprovadas

| # | Tema | Decisão |
|---|---|---|
| 1 | Número | Número dedicado que responde qualquer pessoa. A lista de liberados existe só como chave no `.env` (vazia = todos) |
| 2 | Onde roda | No PC do João até sexta. Sessão e estado ficam em pastas configuráveis |
| 3 | Atendente | Tudo pelo próprio chip. A IA pausa sozinha quando alguém digita pelo celular. O resumo da transferência e o `#devolver` ficam na conversa "Mensagem para mim" |
| 4 | Divisão | João: ponte, fila e agrupamento, tomada pelo atendente. Gui: API do agente, estado, correções, relatório de campos e roteiro de teste. A verificação e o dogfooding estão no escopo |
| 5 | Escrita na loja | Leitura real da API. O orçamento é simulado e marcado como TESTE até a escrita real ser ligada no `.env` |
| 6 | Arquitetura | A do LembreMe: 2 processos, ponte Node + agente por HTTP, em TypeScript. Ajustes: fila por conversa, agrupamento na ponte, eventos do atendente |
| 7 | Melhorias | Entram as melhorias 1–7 (abaixo). A 8 (cache de prompt) fica para depois de sexta |
| 8 | Horas | Não contar horas; fazer o máximo. As sessões do João rodam já, sem depender do Gui, e o que sobrar vai para o Gui |
| 9 | Base de conhecimento no teste | Rodar com `KB_INCLUIR_RASCUNHOS=true`. Respondem 7 itens; os 10 com `[PLACEHOLDER]` viram lacuna e transferem. A checklist do README vai ao Luis como pendência, sem bloquear |
| 10 | Erros do dogfooding | Cada falha vira uma issue no GitHub para o João corrigir com o Claude (seção 7.D) |

**Melhorias aprovadas**

1. WhatsApp como fila durável: a ponte só marca como lida depois de responder, e varre as não lidas ao subir e a cada
   2 min (João).
2. Turno com chave única: `turnoId` = hash dos ids do lote. Lote repetido devolve a resposta guardada; turno em andamento
   devolve 409 (Gui).
3. Registrar o que vai sair antes de enviar, para não confundir a própria mensagem com a de um atendente (João).
4. Estado gravado em arquivo temporário + rename (Gui).
5. Teto de 90s no turno. Estourou → desculpas + transferência; a ponte espera um pouco mais que isso (Gui).
6. Contra bloqueio: "digitando…" proporcional ao texto, nunca puxar conversa, limite de envios por minuto (João).
7. Um id por turno nos logs dos dois processos (Gui).

## 4. Arquitetura

Dois processos na mesma máquina, conversando por HTTP local:

```
cliente ⇄ WhatsApp ⇄ [ponte: src/whatsapp/]  ──HTTP──▶  [API do agente: src/api/] ─▶ runTurn ─▶ API da loja
                          │                                      │
                  data/whatsapp-sessao/              data/conversas/<telefone>.json
                  data/artes/<telefone>/
```

### 4.1 As peças

| Peça | O que faz | Dono |
|---|---|---|
| **Contrato** (`src/contrato/`) | Schemas zod de `/api/mensagens` e `/api/eventos`, `loteParaTexto` (lote → texto do `runTurn`) e `formatarParaWhatsApp` (negrito `**x**` → `*x*`, quebra em partes). É usado pelos dois lados | João |
| **Dublê do agente** (`src/duble/`) | Servidor que cumpre o contrato. Modo `eco` (testes automáticos) e modo `direto` (chama o `runTurn` real com estado em memória). Permite que o João teste no chip com o agente real sem esperar a API definitiva | João |
| **Ponte** (`src/whatsapp/`) | Sessão, QR ou código de pareamento, versão do WhatsApp Web, reconexão sem logout e verificação de vida (as defesas do LembreMe). Também: telefone (9º dígito, `@lid`), só conversa direta, fila por conversa, agrupamento, envio, detecção do atendente, "Mensagem para mim", varredura e `salvarMidia` | João |
| **API do agente** (`src/api/`) | `POST /api/mensagens`, `POST /api/eventos`, `GET /api/health`. Valida com o contrato, descarta mensagem repetida pelo id e guarda a resposta de cada turno | Gui |
| **Conversas** (`src/conversas/`) | Estado por telefone em `data/conversas/<telefone>.json`. É a única fonte do `modo` (`ia` / `humano`) | Gui |
| **Agente** (existe) | Correções: `transferir_humano` sem quebrar com a API fora; orçamento simulado TESTE; `registrar_arte` conferindo o arquivo real; `STORE_NAME` = Presentes Especiais; resumo da transferência legível; cancelamento e desfazer turno (seção 6) | Gui |

**Ajuste de divisão (decorre da decisão 8):** `salvarMidia` e `formatarParaWhatsApp` passam para o pacote do João.
A ponte precisa da primeira e o dublê `direto` precisa da segunda, e as duas ficam disponíveis para o Gui reaproveitar.

### 4.2 Unidades da ponte

A ponte não fala com o whatsapp-web.js diretamente: depende de uma interface `CanalWhatsApp` (receber, enviar,
"digitando", marcar como lida, listar não lidas, baixar mídia, estado da sessão). O adaptador real usa whatsapp-web.js;
os testes usam um **WhatsApp falso** que implementa a mesma interface.

| Unidade | Responsabilidade |
|---|---|
| `canal.ts` | Interface `CanalWhatsApp` e tipos de mensagem recebida |
| `sessao.ts` | Adaptador whatsapp-web.js: `LocalAuth` na pasta configurada, QR no terminal ou código de pareamento, troca de versão, reconexão com trava, verificação periódica |
| `telefone.ts` | Normalização (9º dígito, `@lid` → telefone) e filtro (grupo, status, canal) |
| `fila.ts` | Buffer por conversa, regra de fechamento do lote e um turno por vez em cada conversa |
| `agenteHttp.ts` | Cliente do contrato: 409, desistência, agente fora |
| `envio.ts` | Registro de "saindo", "digitando…", limitador global, partes já enviadas e marcar como lida |
| `atendente.ts` | Detecção da mensagem do atendente, "Mensagem para mim", `#devolver` e comando desconhecido |
| `varredura.ts` | Não lidas ao subir e a cada 2 min |
| `midia.ts` | `salvarMidia`: tipo e tamanho reais, gravação em `data/artes/<telefone>/<id>.<ext>` |
| `index.ts` | Liga as unidades e sobe o processo |

`npm run whatsapp` sobe os dois processos através de um lançador próprio (`scripts/whatsapp.ts`, com `child_process`, sem
dependência nova), e cada processo também sobe sozinho. Dependências novas: `whatsapp-web.js`, numa versão fixada (nunca
`#main` solto), e `qrcode-terminal`.

## 5. Caminho de uma mensagem

**A. Do cliente até a resposta**

1. A ponte descarta grupo, status e canal. O telefone normalizado é a chave da conversa.
2. Arte, imagem ou documento passa por `salvarMidia` e vai para `data/artes/<telefone>/<id>.<ext>`. Áudio recebe uma
   resposta fixa e não chega ao agente.
3. A mensagem entra no buffer da conversa, e o relógio de 5s de silêncio recomeça. Com um turno rodando, o buffer só
   acumula.
4. Fechado o lote (regra na seção 6, item 8), a ponte manda "digitando…" e faz o `POST /api/mensagens`.
5. No agente, nesta ordem:
   - lote já respondido → devolve a resposta guardada;
   - turno em andamento → 409;
   - id já visto → descarta;
   - conversa em `humano` → só grava no histórico;
   - senão roda o `runTurn` (teto de 90s), salva o estado e guarda a resposta pela chave do turno.
6. Na volta:
   - se um atendente digitou depois do envio do lote, a resposta é descartada;
   - senão a ponte registra a resposta como "saindo", manda "digitando…" proporcional e envia;
   - se houve transferência, avisa em "Mensagem para mim";
   - **só então marca como lida**;
   - se o buffer encheu nesse meio-tempo, ele vira o próximo lote.

**B. Transferência:** a conversa passa a `humano` e o cliente recebe a mensagem do agente. "Mensagem para mim" recebe o
resumo: cliente, telefone, motivo, produtos, orçamento, arte e últimas mensagens. Com `lacuna_conhecimento`, o resumo
traz a pergunta que ficou sem resposta.

**C. Atendente assume:** uma mensagem que sai do número sem estar registrada como "saindo" gera
`POST /api/eventos` `mensagem_atendente`. A conversa vai para `humano` e o texto entra no histórico como
`[Atendente]: …`. Conversa pausada não é marcada como lida, para continuar aparecendo para o atendente.

**D. Devolver:** `#devolver 5583999990000 [nota]` em "Mensagem para mim":
- a conversa volta a `ia`, a nota entra no histórico e o contador de falhas é zerado;
- a ponte confirma com "✅ devolvido à IA";
- a IA só volta a falar na próxima mensagem do cliente;
- comando desconhecido → a ponte responde com a lista de comandos.

**E. Recuperação:** ao ficar pronta e a cada 2 min, a ponte varre as conversas diretas não lidas cuja última mensagem é
do cliente. O que já passou pelo agente cai na chave do turno e não roda de novo.

**F. Partida do agente:**
- índice do catálogo vazio impede a subida (rode `npm run sync:catalogo`; a 1ª carga leva minutos);
- índice existente → sync incremental em segundo plano ao subir e a cada 6h;
- o estado da base de conhecimento aparece no terminal, como no CLI. A função `avisarConhecimentoECatalogo` sai do
  `cli.ts` para os dois usarem.

### 5.1 Contrato

```
POST /api/mensagens
{ turnoId, telefone, mensagens: [{ id, timestamp, texto, arquivo?: { caminho, mime, bytes, nome } }] }
→ 200 { respostas: string[], avisoAtendente?: string, modo: "ia" | "humano" }
→ 409 { status: "em_andamento" }

POST /api/eventos
{ tipo: "mensagem_atendente", telefone, id, texto, timestamp }
{ tipo: "devolver", telefone, nota? }
→ 200 { modo }

GET /api/health
→ 200 { ok: true }
```

- `turnoId` = sha256 dos ids das mensagens do lote, em ordem, cortado em 16 caracteres hex.
- `loteParaTexto` junta as mensagens uma por linha. Arquivo vira `[ARQUIVO recebido: <nome> (<mime>, <KB> KB)]`;
  arquivo recusado vira `[arquivo recusado: <nome>, <motivo>]`.
- `formatarParaWhatsApp` quebra a resposta nos parágrafos (linha em branco), com no máximo 4 partes; o que passar disso
  vai junto na última.
- A resposta de cada turno fica guardada no arquivo da conversa (últimos 20 turnos), para sobreviver a um reinício do
  agente. O "em andamento" vive só em memória.

## 6. Erros e limites

**Quatro buracos achados no código atual:**

1. `llm.chat` no `runTurn` (`src/agent/runTurn.ts:90`) não tem try/catch, e o SDK faz 2 tentativas com timeout padrão
   de 10 min.
2. Um turno que falha suja o histórico: `addMessage` (`runTurn.ts:56`) grava a mensagem do cliente antes da chamada ao
   Claude, então repetir o turno duplica a mensagem.
3. Para o teto de 90s valer, o cancelamento tem que ser real: um `AbortSignal` que chega até o `llm.chat` e é conferido
   antes de cada ferramenta. Só cronometrar deixa o turno rodando por trás, e ele pode criar um orçamento depois das
   desculpas.
4. A guarda anti-duplicata (`state.orcamentoTokens`) vive só no estado, e a API da loja ignora `Idempotency-Key`
   (testado em 12/10). Se o agente cair entre `criar_orcamento` e salvar o estado, a repetição do lote cria outro
   orçamento.

**Na ponte (João)**

1. **Agente fora:** a ponte não marca como lida, e a varredura de 2 min repete com o mesmo `turnoId`. Passados
   **10 min** sem resposta, o cliente recebe uma mensagem fixa ("estamos com instabilidade, já te respondemos"), uma vez
   por queda, e "Mensagem para mim" recebe um alerta.
2. **409:** a ponte pergunta de novo a cada 5s, por até 120s.
3. **Chamada sem resposta:** a ponte desiste em 120s (90s + folga) e trata como agente fora.
4. **Envio falha:** tenta mais uma vez; se falhar de novo, não marca como lida. Na repetição, o agente devolve a resposta
   guardada e a ponte pula as partes já enviadas (lista em memória por `turnoId`). Um reinício da ponte no meio pode
   duplicar uma parte; isso foi aceito.
5. **Sessão cai** (defesas do LembreMe):
   - reconecta com trava e sem logout;
   - autenticou sem ficar pronta → troca a versão do WhatsApp Web;
   - a verificação periódica pega página travada mesmo com estado CONNECTED;
   - **desvinculada (UNPAIRED confirmado) → para de tentar e avisa no terminal**, sem loop de QR.

   Alertas de WhatsApp fora ficam no terminal.
6. **Arte que não baixa ou é recusada pelo `salvarMidia`:** entra no lote como `[arquivo recusado: nome, motivo]`.
7. **Tipos sem suporte:**
   - áudio → resposta fixa;
   - figurinha, localização, contato, reação, edição e mensagem apagada → ignorados **e marcados como lidos** (senão a
     varredura os vê pendentes para sempre).
8. **Lote:** fecha com 5s de silêncio, 30s desde a primeira mensagem ou 10 mensagens, o que vier antes. O texto é cortado
   em 4.000 caracteres.
9. **Contra bloqueio:** no máximo 20 envios por minuto no número todo, e "digitando…" limitado a 4s.

**No agente (Gui, ou João se sobrar)**

10. **API da loja fora:** o disjuntor e a regra de 2 falhas → transferir já existem, mas dependem do `transferir_humano`
    corrigido. Hoje o `listAdmins()` (`src/tools/transferirHumano.ts:32`) não tem try/catch: a transferência falha
    junto, o modelo tenta de novo e a conversa nunca pausa.
11. **Claude fora (buraco 1):** a API captura o erro e desfaz o turno. Tira a mensagem do cliente do histórico, mantém o
    registro de efeitos (orçamentos, artes) e devolve erro; a ponte age como no item 1. Na **segunda falha do mesmo
    lote**, o agente transfere sozinho (`falha_sistema`) e manda mensagem fixa.
12. **Teto de 90s (buraco 3):** cancelamento real. Estourou → turno desfeito como no item 11, desculpas e transferência.
13. **Agente cai no meio do turno (buraco 4):** o estado é salvo logo depois de cada ferramenta com efeito
    (`criar_orcamento`, `registrar_arte`), não só no fim.
14. **Arquivo de estado ilegível:** renomeia para `.corrompido-<data>`, a conversa recomeça e o log recebe um alerta.
15. **Índice do catálogo:** vazio não sobe; se o sync falhar, mantém o índice anterior (a Fase 3 já faz isso) e loga.

**Limites**

16. No máximo 30 respostas por hora por telefone, porque o número aceita qualquer pessoa. Passou disso, a conversa vai
    para o atendente uma vez, com aviso.
17. O histórico mandado ao modelo fica nas últimas 40 mensagens (já é assim).

## 7. Testes e verificação

**A. Automáticos** (vitest, sem rede, relógio simulado)

- **Ponte**, contra o WhatsApp falso e o dublê `eco`:
  - fechamento do lote em 5s, 30s ou 10 mensagens;
  - pausa durante o turno e o 409;
  - desistência em 120s e o aviso de 10 min;
  - pular partes já enviadas e o limite de 20 envios por minuto;
  - mensagem "saindo" × mensagem do atendente;
  - 9º dígito e `@lid`;
  - `#devolver` e comando desconhecido.
- **Teste de contrato compartilhado:** a mesma bateria roda contra o dublê e contra a API definitiva.
- **API e agente (Gui):**
  - lote repetido → resposta guardada; 409; id repetido; conversa em `humano`;
  - falha do Claude desfaz o turno;
  - cancelamento antes da próxima ferramenta;
  - estado salvo depois do `criar_orcamento`;
  - arquivo de estado corrompido;
  - `transferir_humano` com o `listAdmins` falhando;
  - escrita desligada → nenhum POST de orçamento no cliente http.
- Os 18 cenários de evals (`evals/runEvals.ts`, que hoje chama o `runTurn` direto) ganham a opção de rodar pela API nova.

**B. Antes do chip** (uma vez, contra o real): `npm run check:api` e `npm run sync:catalogo` (só leitura), depois
`npm run evals` e `npm run avaliar:recomendacao` com o modelo. A Fase 3 nunca rodou assim.

**C. Dogfooding.** O Gui escreve o roteiro e registra os resultados; o João conduz. A primeira rodada usa o dublê
`direto` e a final usa a API definitiva, ambas com `KB_INCLUIR_RASCUNHOS=true`.

1. "oi" → orçamento TESTE
2. três mensagens picadas viram um lote só
3. arte em imagem e em PDF, mais uma recusada
4. áudio
5. "qual o horário de vocês?" → lacuna → transferência com resumo
6. atendente responde pelo celular → IA fica quieta → `#devolver`
7. reiniciar a ponte e o agente no meio do turno
8. agente desligado por mais de 10 min → aviso de instabilidade; ao religar, a varredura pega o que ficou
9. API da loja fora → transferência

Cada cenário registra o esperado, o observado e um print em `docs/dogfooding-fase-4.md`.

**D. Depois do dogfooding: issues.** Cada cenário que falhar, e qualquer outro erro visto durante o roteiro, vira **uma
issue** no repositório do GitHub:

- título `[Fase 4] <cenário>: <sintoma>`, etiquetas `fase-4` e `dogfooding`, atribuída ao João;
- corpo: cenário, passos, esperado, observado, print e o `turnoId` dos logs;
- sem telefone completo, sem credencial e sem dado de cliente real;
- o João revisa a lista antes de as issues serem abertas;
- a correção é feita pelo João com o Claude, uma issue por vez. Cada correção começa por um teste que reproduz o erro, e
  o registro do dogfooding passa a apontar para a issue.

O dogfooding termina quando os 9 cenários passam ou quando cada falha tem a sua issue aberta.

## 8. Configuração (`.env`)

Chaves novas (os valores são os padrões):

| Chave | Padrão | Lado |
|---|---|---|
| `AGENTE_PORTA` | `3030` | agente |
| `AGENTE_URL` | `http://127.0.0.1:3030` | ponte |
| `WHATSAPP_SESSAO_DIR` | `data/whatsapp-sessao` | ponte |
| `WHATSAPP_PAREAR_TELEFONE` | vazio (usa QR) | ponte |
| `WHATSAPP_LIBERADOS` | vazio (responde todos) | ponte |
| `LOTE_SILENCIO_MS` / `LOTE_MAX_MS` / `LOTE_MAX_MENSAGENS` | `5000` / `30000` / `10` | ponte |
| `AGENTE_TIMEOUT_MS` | `120000` | ponte |
| `AVISO_INSTABILIDADE_MIN` | `10` | ponte |
| `ENVIOS_POR_MINUTO` | `20` | ponte |
| `VARREDURA_MS` | `120000` | ponte |
| `CONVERSAS_DIR` / `ARTES_DIR` | `data/conversas` / `data/artes` | agente / ponte |
| `TURNO_TETO_MS` | `90000` | agente |
| `RESPOSTAS_POR_HORA` | `30` | agente |
| `ORCAMENTO_ESCRITA` | `simulada` (ou `real`) | agente |

Mudam: `STORE_NAME` passa a ter `Presentes Especiais` como padrão; no teste, `KB_INCLUIR_RASCUNHOS=true`.

## 9. Divisão e ordem

O pacote do João vem primeiro e não depende do Gui. O primeiro item é o contrato com o dublê; o segundo, o WhatsApp
falso, que viabiliza os testes da ponte. Com o dublê `direto`, o primeiro teste no chip já usa o agente real. O Gui depois
troca o dublê pela API definitiva sem mexer na ponte, e o teste de contrato é o que garante essa troca. O que o João não
alcançar até sexta vai para o Gui, na ordem do plano.

## 10. Fora do escopo

- Redis ou outra fila, banco de dados, callback assíncrono, mais de uma ponte
- Cache de prompt (melhoria 8, depois de sexta: o estado está dentro do prompt de sistema e quebra o cache)
- Reagir a edição ou mensagem apagada
- Alerta fora do terminal quando o WhatsApp cai
- Limite de gasto diário global
- CRM e Cloud API oficial da Meta

## 11. Pendências externas e riscos

- **Celular do chip:** falta definir quem fica com ele para o pareamento da primeira vez (videochamada ou código de
  8 dígitos via `WHATSAPP_PAREAR_TELEFONE`).
- **Checklist do README "O que a loja precisa aprovar"** (8 itens, todos abertos): vai ao Luis como pendência. O horário
  de atendimento humano importa para transferências fora do expediente.
- **Achados do PR #1:** o `listAdmins` e o `STORE_NAME` são resolvidos nesta fase. Os orçamentos de teste 24–27 continuam
  em produção, aguardando exclusão pela loja.
- **Risco de bloqueio do número** (whatsapp-web.js não é oficial): mitigado pela melhoria 6 e pelo limite de envios.
- **whatsapp-web.js quebra com atualizações do WhatsApp Web:** por isso a versão fica fixada e a troca de versão do
  LembreMe é reaproveitada.
- **PC com pouca RAM:** o Chromium da sessão e os dois processos Node rodam juntos; suba só este projeto durante o teste.
