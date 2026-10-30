# Spec do agente de atendimento — Presentes Especiais

Documento único do agente: para que serve, como funciona, o que cada peça faz, que decisões foram tomadas e por quê, e o que ainda falta. Os documentos de cada fase continuam valendo para o detalhe. O [mapa no fim](#15-mapa-dos-documentos) diz onde está cada um.

**Retrato de:** 25/10/2026, branch `correcoes-da-homologacao` (sobre `fase-6-homologacao`, `dd41875`). Desde 25/10 o agente segue o requisito R5 da loja (decisão 50): **estima o orçamento e transfere a ficha; quem emite é uma pessoa**.

---

## 1. Objetivo

O agente atende os clientes da loja pelo WhatsApp. Ele recomenda produtos com dados reais da plataforma Brinde.me, coleta a arte e monta a estimativa do orçamento com o preço de tabela. Quando o cliente confirma, transfere a conversa com a ficha do pedido para a equipe emitir o orçamento. A emissão, o mockup e a aprovação final ficam com a equipe da loja.

**Objetivo do piloto** (planejamento de 09/10): reduzir o tempo até o primeiro orçamento e tirar da equipe as perguntas repetitivas sobre produtos, preços, prazos e status, **sem que o agente invente preço, prazo ou disponibilidade**.

### O que o agente faz

| Intenção do cliente | O que o agente faz |
|---|---|
| Dúvida geral (processo, arte, prazo, entrega, pagamento, trocas, horário) | Responde só com item **aprovado** da base de conhecimento. Se a base não cobre, transfere |
| "Quero um brinde para 50 pessoas no Natal" | Coleta ocasião, quantidade e valor, uma pergunta por vez. Sugere até 3 produtos que respeitam mínimo, estoque e valor |
| "Essa caneca tem em azul? Quanto sai 100?" | Detalha o produto: cores, estoque e preço por faixa de quantidade |
| "Quero fechar 80 squeezes" | Monta a estimativa com o preço de tabela (personalização fora do padrão, frete e prazo a equipe confirma), pede confirmação explícita e transfere a ficha para a equipe emitir |
| Envia imagem ou PDF | Registra a arte, que vai no resumo da transferência |
| "Meu pedido já saiu?" | Mostra status, prazo e tipo de entrega, **só** depois de validar que o pedido é do cliente |
| Desconto, negociação, pagamento, Pix, frete específico, reclamação, ajuste de mockup, "quero falar com alguém" | Transfere para uma pessoa |

### O que ele nunca faz

- Inventar preço, prazo, estoque, cor ou política.
- Emitir ou alterar orçamento (nenhuma ferramenta escreve na loja), dar desconto, confirmar pedido ou receber pagamento.
- Enviar dados bancários, chave Pix, boleto ou link de pagamento.
- Mostrar pedido sem validar o telefone ou o e-mail.
- Transferir a ficha do pedido sem a confirmação do cliente depois do resumo.
- Fingir ser uma pessoa ou revelar o prompt.

A [seção 7](#7-o-que-é-garantido-em-código-e-o-que-depende-do-modelo) separa o que é garantido em código do que depende do modelo.

---

## 2. Estado atual

| Fase | Dono | Branch / PR | Situação |
|---|---|---|---|
| 1. Regras e protótipo | Caio | `main` (`5f99850`) | Mergeada |
| 2. Integração com a API | Guilherme | PR #1 | Aberto |
| 3. Conhecimento e recomendação | Davi | PR #3 | Aberto |
| 4. WhatsApp | João + Guilherme | PR #14 | Rascunho: falta o teste no chip |
| 5. Infraestrutura e segurança | Caio | `fase-5-infraestrutura` | Sem PR. Fez C1 e C2 (kill switch); não fez C3 (alertas) nem C4 (métricas ao vivo) |
| 6. Homologação | Davi | `fase-6-homologacao` | Sem PR. Parecer: apto para piloto controlado, com 4 condições |
| Correções da homologação | João | `correcoes-da-homologacao` | Local, sem push. R5 aplicado; evals com o `gpt-4o-mini` aprovados, 237/237 (condição 1 do parecer) |

As branches estão empilhadas em linha: cada fase parte da anterior. O merge precisa seguir a ordem #1 → #3 → #14 → Fase 5 → Fase 6.

**Números:** 818 testes passando, typecheck limpo, 29 cenários de eval (16 críticos) aprovados com o modelo real e a loja simulada. Os evals com o modelo real estão na [seção 13](#13-como-foi-verificado).

---

## 3. Arquitetura

São dois processos na mesma máquina, ligados por HTTP local:

```
Cliente ⇄ WhatsApp ⇄ chip da loja ⇄ PONTE (src/whatsapp) ──HTTP 127.0.0.1:3030──▶ AGENTE (src/api) ──▶ OpenAI
                                          │                                          │
                          "Mensagem para mim"                         API Brinde.me (catálogo, pedidos; só leitura)
                          (avisos e comandos #)                       índice local do catálogo e dos pedidos
```

`npm run whatsapp` sobe os dois pelo lançador (`src/lancador.ts`), que religa o agente se ele cair.

| Pasta | Responsabilidade |
|---|---|
| `src/whatsapp/` | Ponte: sessão do whatsapp-web.js, fila e agrupamento por conversa, envio, mídia, detecção do atendente, comandos `#`, varredura de não lidas |
| `src/contrato/` | Contrato ponte ↔ agente: schemas zod, `turnoId`, texto do lote, formatação para o WhatsApp |
| `src/api/` | Servidor do agente (`/api/mensagens`, `/api/eventos`, `/api/health`) e o `AgenteDefinitivo`, que orquestra o turno |
| `src/agent/` | `runTurn` (loop com o modelo), estado da conversa e prompt de sistema (`prompt/system.md`) |
| `src/tools/` | As 7 ferramentas (seção 5) |
| `src/llm/` | Provedor OpenAI: Chat Completions (`openai.ts`) e Responses (`openaiResponses.ts`) |
| `src/integrations/brindeme/` | Cliente da API da loja (HTTP e mock), disjuntor, tradução de erros, índice de pedidos |
| `src/catalogo/`, `src/busca/` | Índice do catálogo, recomendação em 5 passos, busca BM25 em português |
| `src/knowledge/` | Base de conhecimento (`base/*.json`), etiquetas de ocasião, lacunas |
| `src/conversas/` | Estado de cada conversa em disco |
| `src/controle/` | Kill switch e ferramentas desligadas (`data/estado-sistema.json`) |
| `src/operacao/` | Verificação do ambiente, retenção e relatório do piloto |
| `src/duble/` | Dublê do agente (`eco` e `direto`) para testar a ponte sem o agente definitivo |
| `src/cli.ts` | Chat no terminal, sem WhatsApp |

### Contrato ponte ↔ agente

```
POST /api/mensagens  { turnoId, telefone, mensagens: [{ id, timestamp, texto, arquivo? }] }
  → 200 { respostas: string[], avisoAtendente?: string, modo: "ia" | "humano" }
  → 409 { status: "em_andamento" }
POST /api/eventos    { tipo: "mensagem_atendente" | "devolver", telefone, ... } → 200 { modo }
GET  /api/health     → 200 { ok: true }
```

Detalhe em [spec da Fase 4 §5.1](superpowers/specs/2026-10-14-fase-4-whatsapp-design.md#51-contrato) e [relatório de campos §8](relatorio-campos-api.md#8-contrato-ponte--agente).

---

## 4. Caminho de uma mensagem

1. **Ponte recebe.** Descarta grupo, status e canal. Normaliza o telefone (9º dígito, `@lid`). Número fora de `WHATSAPP_LIBERADOS` é ignorado; com a lista vazia, todos são atendidos.
2. **Mídia.** Imagem e documento são conferidos pelo conteúdo e gravados em `data/artes/<telefone>/`. O limite é 16 MB. Arquivo recusado chega ao agente como `[arquivo recusado: …]`, para ele explicar o motivo ao cliente.
3. **Lote.** As mensagens se acumulam até 5 s de silêncio, 30 s no total ou 10 mensagens. Assim, três mensagens seguidas recebem uma resposta só.
4. **Agente decide**, nesta ordem:
   - lote já respondido (mesmo `turnoId`) → devolve a resposta guardada;
   - turno em andamento → 409;
   - agente suspenso → aviso uma vez e a equipe é avisada;
   - conversa em modo `humano` → só grava no histórico;
   - senão roda o `runTurn`, com teto de 90 s.
5. **`runTurn`.** Monta o prompt (identidade, regras e estado da conversa), chama o modelo e executa as ferramentas que ele pedir. A entrada de cada ferramenta é validada antes do handler. O loop termina quando o modelo responde sem pedir ferramenta. Se a resposta promete transferir e `transferir_humano` não foi chamada, ela volta ao modelo uma vez, com um aviso do sistema (decisão 52).
6. **Volta à ponte.** Se um atendente escreveu enquanto a IA pensava, a resposta é descartada. Senão, a ponte registra o que vai sair, mostra "digitando…" proporcional ao texto e envia em até 4 partes. Só então marca a conversa como lida.
7. **Transferência.** A conversa passa a `humano` e o resumo vai para "Mensagem para mim". Com o motivo `orcamento_para_emitir`, o resumo traz a ficha: itens com cor, quantidade, preço unitário e subtotal, total estimado, prazo desejado, personalização e e-mail. `#devolver <telefone> [nota]` devolve a conversa à IA.

Como a ponte só marca como lida depois de responder e varre as não lidas ao subir e a cada 2 min, **o próprio WhatsApp funciona como fila durável**: se a ponte reinicia, nada se perde e nada é respondido duas vezes.

---

## 5. Ferramentas

As 7 ferramentas ficam em `src/tools/`. Os nomes estão em `src/tools/nomes.ts`, e um teste confere que a lista bate com o registro.

| Ferramenta | Entrada | O que faz | Guardas em código |
|---|---|---|---|
| `consultar_conhecimento` | `pergunta`, `categoria?` | Busca BM25 na base de conhecimento | Só item `aprovado`. Item com `[PLACEHOLDER]` nunca sai. Sem resposta → registra lacuna e manda transferir (`lacuna_conhecimento`) |
| `buscar_produtos` | `consulta`, `quantidade?`, `preco_max_unitario?`, `orcamento_total?`, `ocasiao?` | Recomenda até 3 produtos do índice local, com preço da faixa, total estimado e o `subproduto_id` de cada cor | Respeita mínimo, estoque **por cor** e valor. Reconfere na API antes de oferecer. Sem quantidade, devolve só "a partir de". Sem resultado, propõe ajuste verificado |
| `detalhar_produto` | `produto_id`, `quantidade?` | Subprodutos, cores, estoque, preço por faixa e personalizações | Dado fresco de `GET /product/{id}`. Guarda id e cor dos 3 últimos detalhados para o turno seguinte |
| `preparar_orcamento` | `tipo` (PF/PJ), `nome`, `email`, `itens[]`, `prazo_desejado?`, `personalizacao?`, `observacoes?` | Calcula a estimativa e guarda a ficha do pedido no estado. Devolve o resumo com o aviso "valor de tabela; personalização fora do padrão, frete e prazo a equipe confirma" | Recusa produto inativo, abaixo do mínimo, sem estoque ou fora das faixas de preço. Guarda a última mensagem do cliente; a mesma ficha preparada de novo no turno da confirmação mantém a confirmação (decisão 54). Telefone vem da conversa, nunca do modelo |
| `consultar_pedido` | `codigo`, `email?` | Status, prazo e tipo de entrega | Basta o código: o telefone da conversa precisa bater; se não bater, pede o e-mail. 2 validações erradas bloqueiam e transferem. Teto de 5 consultas por conversa. Nunca devolve CPF, e-mail, boleto ou NF |
| `registrar_arte` | `descricao_arquivo`, `posicao?`, `cores?` | Registra a arte; ela vai no resumo da transferência | PNG, JPG, PDF ou SVG. Pelo WhatsApp, só arquivo que chegou de verdade |
| `transferir_humano` | `motivo`, `prioridade`, `observacao?` | Passa a conversa a uma pessoa e monta o resumo para a equipe | Funciona mesmo com a API da loja fora. Telefone mascarado no resumo. `orcamento_para_emitir` exige a ficha e uma mensagem nova do cliente depois do resumo; sem isso, recusa |

**Motivos de transferência:** `orcamento_para_emitir`, `pedido_cliente`, `reclamacao`, `desconto`, `pagamento`, `frete_prazo`, `ajuste_mockup`, `falha_sistema`, `nao_entendido`, `arte_problematica`, `lacuna_conhecimento`, `outro`.

---

## 6. Estado e modos da conversa

Cada conversa é um arquivo `data/conversas/<telefone>.json` (`ConversationState`, em `src/agent/state.ts`). Ele guarda:

- o **modo** (`ia` ou `humano`);
- os dados do cliente (tipo, nome, e-mail) e da necessidade (ocasião, quantidade, valor, data);
- os produtos discutidos, a última lista apresentada (`ultimasOpcoes`, para "a primeira opção"), os 3 últimos produtos detalhados com as cores (`produtosDetalhados`, para o orçamento pedido no turno seguinte), as artes e os arquivos recebidos;
- a ficha do pedido aguardando confirmação (`fichaPedido`: o resumo e a última mensagem do cliente no momento do resumo);
- os contadores de falha e de consultas de pedido;
- o histórico e as respostas dos últimos 20 turnos (para devolver um lote repetido sem chamar o modelo de novo).

| Modo | Quem responde | Como entra | Como sai |
|---|---|---|---|
| `ia` | O agente | Padrão; `#devolver` | Transferência, ou um atendente escreve pelo chip |
| `humano` | A equipe, pelo chip | `transferir_humano` ou mensagem do atendente | `#devolver <telefone> [nota]` |
| **suspenso** (global) | Ninguém automaticamente | `#suspender [motivo]` | `#retomar` |

A suspensão e as ferramentas desligadas ficam em `data/estado-sistema.json`, que a ponte e o agente leem (cache de 30 s).

---

## 7. O que é garantido em código e o que depende do modelo

Esta é a parte mais importante da spec. O prompt pede o comportamento certo, mas as regras que causam dano se forem quebradas **não dependem de o modelo obedecer**.

| Regra | Garantida em código? | Onde |
|---|---|---|
| Agente não emite orçamento (R5) | ✅ Nenhuma ferramenta escreve na loja | `tools/index.ts` |
| Ficha só vai à equipe depois da confirmação explícita | ✅ `orcamento_para_emitir` exige a ficha e uma mensagem nova do cliente depois do resumo | `transferirHumano.ts`, `state.ts` |
| Ficha não vai duas vezes | ✅ Depois da transferência a conversa fica em modo `humano` e o agente não responde mais | `runTurn.ts` |
| Dado bancário e chave Pix nunca saem | ✅ Nenhuma fonte do agente tem esse dado: a base não tem, e `consultar_pedido` não devolve boleto. O modelo só poderia inventar (evals 23 e 32 medem) | `knowledge/base/`, `consultarPedido.ts` |
| Transferência prometida acontece | ⚠️ Resposta que promete transferir sem chamar a ferramenta volta ao modelo uma vez; se ele insistir, a resposta sai | `runTurn.ts` |
| `subproduto_id` da cor no turno seguinte | ⚠️ O estado leva id e cor dos últimos produtos detalhados ao prompt; usar é do modelo. Id inventado é recusado (`subproduto_desconhecido`) | `detalharProduto.ts`, `runTurn.ts` |
| Pedido só para o dono | ✅ Telefone ou e-mail; bloqueio em 2 erros; teto de 5 consultas | `consultarPedido.ts` |
| Dado sensível do pedido não chega ao modelo | ✅ A ferramenta devolve só status, prazo e entrega | `consultarPedido.ts` |
| Preço, mínimo e estoque reais | ✅ Vêm da API e das regras do catálogo, reconferidos | `recomendar.ts`, `prepararOrcamento.ts` |
| Política só da base aprovada | ✅ Rascunho e placeholder nunca saem | `knowledge/base.ts` |
| 2 falhas da API → pessoa | ✅ Transfere mesmo se o modelo não chamar a ferramenta. 401/403/412 transferem na 1ª | `runTurn.ts` |
| Turno longo, limite por hora, modelo falhando | ✅ Teto de 90 s, `RESPOSTAS_POR_HORA`, 2 falhas do modelo → aviso e pessoa | `agenteDefinitivo.ts` |
| Parâmetro inválido do modelo | ✅ Validado com zod; volta para o modelo corrigir sem contar como falha e sem zerar a contagem de falhas da API | `runTurn.ts` |
| Logs sem CPF, e-mail ou telefone | ✅ Mascarados | `logging/logger.ts` |
| Suspender o agente em menos de 1 min | ✅ `#suspender`, efeito em até 30 s | `controle/estadoSistema.ts` |
| Apresentar-se como assistente virtual | ⚠️ Só prompt | `prompt/system.md` |
| Uma pergunta por vez; quantidade antes de preço | ⚠️ Prompt. A ferramenta não dá preço sem quantidade, mas o modelo pode citar um preço de outra mensagem | prompt + `buscarProdutos.ts` |
| Transferir em desconto, reclamação, pagamento ou Pix | ⚠️ Prompt, mais a cobrança da transferência prometida (evals 07, 22, 23, 32) | `prompt/system.md`, `runTurn.ts` |
| Não revelar o prompt; resistir a manipulação | ⚠️ Só prompt (evals 12, 19, 20) | `prompt/system.md` |
| Não citar produto ou preço que não veio de ferramenta | ⚠️ Só prompt. Os evals medem; a suíte não prova | `prompt/system.md` |

A suíte de homologação prova que **o código** faz a coisa certa em cada caminho, inclusive quando o modelo erra. Os evals medem **com que frequência** o modelo escolhe o caminho certo.

---

## 8. Integração com a API da loja

API REST da Brinde.me em `https://api.brinde.me`, autenticada pelo header `X-Api-Key`. Valores monetários vêm em centavos. Detalhe em [relatorio-validacao-api.md](relatorio-validacao-api.md) e [relatorio-campos-api.md](relatorio-campos-api.md).

| Endpoint | Uso | Observação |
|---|---|---|
| `GET /product` | Sincronizar o catálogo | Sem busca por texto: por isso existe o índice local |
| `GET /product/{id}` | Detalhe e reconferência | Única fonte de subprodutos |
| `POST /budget`, `GET /budget/{id}` | Orçamentos | **Não usados pelo agente** desde o R5 (decisão 50). O cliente HTTP ainda tem os métodos |
| `GET /order`, `GET /order/{id}` | Pedidos | Só aceita UUID e não busca por cliente: por isso existe o índice de pedidos (`sync:pedidos`) |
| `GET /admin` | Responsável da transferência | Falha aqui não impede a transferência |

| Resposta da API | Sistema | Cliente |
|---|---|---|
| Timeout / 5xx | Novas tentativas com espera crescente, só em GET | "Estou com instabilidade…" |
| 429 | Respeita `Retry-After` (teto de 10 s) | Transfere se persistir |
| 401 / 403 | Alerta e disjuntor aberto na hora | Transferência |
| 404 | Registra | "Não encontrei…" |
| 412 | Registra o corpo e alerta | Transferência |
| 422 | Devolve o campo inválido | Pedido de correção |
| 3 falhas seguidas | Disjuntor aberto por 2 min | Transferência |

**Cota:** 60 req/min, compartilhada com outro consumidor. O sync do catálogo usa no máximo 30/min (`CATALOGO_REQ_POR_MINUTO`) e deixa o resto para as conversas.

---

## 9. Conhecimento e recomendação

**Base de conhecimento** (`src/knowledge/base/<categoria>.json`): 17 itens em 7 categorias (arte, entrega, institucional, pagamento, prazos, processo comercial, trocas e defeitos). Cada item tem `status` (aprovado ou rascunho), dono e data de revisão. **Hoje nenhum item está aprovado** (issue #13), então toda dúvida geral vira lacuna e vai para uma pessoa. Guia da loja: [base-de-conhecimento.md](base-de-conhecimento.md).

**Catálogo:** índice local em `data/produtos-index.json`, com 6.527 produtos, montado por `npm run sync:catalogo`. A primeira carga leva cerca de 3,6 h a 30 req/min. Com o índice pronto, o agente faz um sync incremental ao subir e a cada 6 h; um produto é relido se passar de 24 h no índice.

**Recomendação em 5 passos** (`src/catalogo/recomendar.ts`):
1. filtros rígidos (ativo, mínimo, estoque por cor, valor);
2. ordenação por similaridade, ocasião e destaque;
3. até 3 opções com preço da faixa e total;
4. reconferência na API (lotes de 4, no máximo 12 por pergunta);
5. sem resultado: explica o motivo e propõe o ajuste mais próximo, verificado pelas mesmas regras.

---

## 10. Operação

### Comandos npm

| Comando | O que faz |
|---|---|
| `npm run whatsapp` | Sobe agente + ponte |
| `npm run chat -- --telefone 5583999990000` | Chat no terminal com o agente real, sem WhatsApp |
| `npm run verificar:env [-- --producao]` | Confere a configuração; sai com 1 se houver erro |
| `npm run check:api` | Valida o acesso à API (somente leitura) |
| `npm run sync:catalogo` / `sync:pedidos` | Alimenta os índices locais |
| `npm run kb:validar` / `kb:lacunas` | Estado da base e perguntas sem resposta |
| `npm test` / `test:homologacao` / `typecheck` | Testes |
| `npm run evals [-- --via-api --rodadas 3 --relatorio arq.json]` | Evals com o modelo real |
| `npm run relatorio:piloto -- --desde AAAA-MM-DD` | Números do piloto a partir dos logs |
| `npm run limpar:dados [-- --dias N \| --telefone X] [--executar]` | Retenção por prazo ou exclusão de um cliente; sem `--executar`, só lista |

### Comandos do chip

Digitados em "Mensagem para mim": `#devolver <tel> [nota]`, `#suspender [motivo]`, `#retomar`, `#desligar <ferramenta>`, `#religar <ferramenta>`, `#status`, `#ajuda`. A rotina do supervisor e os incidentes estão no [manual de operação](fase-6/manual-operacao.md).

---

## 11. Configuração

O `.env.example` é a referência completa e comentada. As chaves que mudam o comportamento:

| Chave | Valor do piloto | Efeito |
|---|---|---|
| `OPENAI_API_KEY`, `LLM_MODEL` | `gpt-4o-mini` | Modelo. Sem padrão no código |
| `LLM_API`, `LLM_REASONING` | `chat`, vazio | Modelo `gpt-4*` não aceita `reasoning_effort`: com valor, o agente não sobe e o `verificar:env` dá erro (decisão 49). Em modelo com raciocínio, `low` quebra as ferramentas (issue #7) |
| `BRINDEME_MODE` | `http` | `mock` usa os JSONs de `mocks/` |
| `KB_INCLUIR_RASCUNHOS` | `false` | `true` só em desenvolvimento |
| `WHATSAPP_LIBERADOS` | Números do piloto | Vazio = responde qualquer número |
| `TURNO_TETO_MS` / `AGENTE_TIMEOUT_MS` | 90000 / 120000 | O teto precisa ficar 10 s abaixo do timeout (conferido no código) |
| `RESPOSTAS_POR_HORA` | 30 | Acima disso, transfere |
| `LOTE_SILENCIO_MS`, `LOTE_MAX_MS`, `LOTE_MAX_MENSAGENS` | 5000, 30000, 10 | Agrupamento de mensagens |
| `ENVIOS_POR_MINUTO` | 20 | Limite contra bloqueio do número |
| `FERRAMENTAS_DESLIGADAS` | vazio | Desliga no startup |
| `RETENCAO_DIAS` | decisão da loja (#4) | Prazo usado por `limpar:dados` |

---

## 12. Decisões

As decisões 1 a 22 (Fases 1 a 3: runtime, schemas, idempotência, disjuntor, base com aprovação, BM25, estoque por cor, regras do sync…) estão no [README](../README.md#decisões-técnicas). As abaixo vêm das Fases 4 a 6.

| # | Decisão | Motivo |
|---|---|---|
| 23 | **whatsapp-web.js** em vez da Cloud API oficial da Meta | Escolha do Luis (13/10). O planejamento recomendava a Cloud API; o risco de bloqueio do número foi aceito para o piloto |
| 24 | **Dois processos** (ponte + agente por HTTP local), arquitetura do LembreMe reescrita em TypeScript | A ponte cai e volta sem perder o agente, e vice-versa. O autor do LembreMe autorizou o uso da arquitetura |
| 25 | **Atendente pelo próprio chip**, com "Mensagem para mim" como painel | Sem CRM no escopo. A IA pausa sozinha quando alguém digita pelo celular |
| 26 | **WhatsApp como fila durável**: marca como lida só depois de responder (`sendSeen: false`) e varre as não lidas a cada 2 min | Reinício da ponte não perde mensagem |
| 27 | **`turnoId` = hash dos ids do lote**. Lote repetido devolve a resposta guardada; turno em andamento → 409 | Nada é respondido duas vezes, nem com reenvio |
| 28 | **Agrupamento na ponte** (5 s de silêncio, 30 s no máximo, 10 mensagens) | O cliente digita em várias mensagens; uma resposta por lote |
| 29 | **Registrar o que vai sair antes de enviar** | A ponte distingue a própria mensagem da de um atendente |
| 30 | **Teto de 90 s no turno**; estourou → desculpas e transferência | O cliente nunca fica sem resposta |
| 31 | **Modelo da OpenAI**, sem Claude no código | Decisão do João (15/10) |
| 32 | ~~**Modelo = `gpt-6-luna`** com `LLM_REASONING=none`~~ (substituída pela 48) | O Sol não chamou nenhuma ferramenta nos evals e custa 20× mais. `gpt-4o-mini` (32/15) e `gpt-4.1-mini` (36/11) foram piores que a Luna (44/3). Decisão do João (16/10) |
| 33 | ~~**Escrita de orçamento simulada** por padrão~~ (revogada pela 50: o agente não escreve na loja) | A API não tem ambiente de testes: todo `POST /budget` é real |
| 34 | **Telefone do orçamento vem da conversa**, não do modelo | O modelo podia inventar ou trocar o número (issue #12) |
| 35 | **Estado em arquivos JSON locais** (conversas, índices, kill switch), com gravação atômica | O planejamento previa Supabase; para o piloto numa máquina, arquivo basta. O índice fica atrás de `ProductIndexStore` para a troca futura |
| 36 | **Kill switch em arquivo** compartilhado por ponte e agente, mais ferramentas desligáveis pelo chip | Critério da Fase 5: suspender em menos de 1 min sem reiniciar |
| 37 | **Entrada do modelo validada com zod antes do handler**; inválida volta ao modelo sem contar como falha | Antes, um parâmetro errado contava como falha da API e transferia o cliente na 2ª vez |
| 38 | **Confirmação = mensagem nova do cliente depois do resumo**, identificada pelo hash do texto | Pela hora não serve: o lote reenviado volta com hora nova e passaria pela guarda |
| 39 | **Agente suspenso**: aviso ao cliente uma vez por suspensão e aviso à equipe com a mensagem | Antes, a mensagem se perdia e o aviso saía a cada mensagem |
| 40 | **Agente escuta só em `127.0.0.1`** | A API interna não tem autenticação |
| 41 | **Sync do catálogo a 30 req/min**, respeitando `Retry-After` | A cota de 60/min é compartilhada; um 429 travava o chip (issue #6) |
| 42 | **Nada é apagado automaticamente**; `limpar:dados` só lista sem `--executar` | O prazo de retenção é decisão da loja (issue #4) |
| 43 | **`consultar_conhecimento` só para dúvida sobre a loja**; orçamento e produto vão ao catálogo, assunto de fora é recusado sem transferir | Com a base vazia, cada consulta indevida virava transferência (evals 05, 06 e 13) |
| 44 | **A última lista apresentada vai ao prompt com posição e nome** | Os resultados de ferramenta não passam para o turno seguinte; só com ids, "a primeira opção" apontava a lista errada |
| 45 | **A retenção limpa registros dentro de arquivos compartilhados** (orçamentos TESTE, lacunas, ponte) e apaga um cliente inteiro com `--telefone` | Dado pessoal ficava nesses arquivos depois da limpeza. Na ponte, só sai o telefone cuja conversa também sai: um evento do atendente pendente ainda não chegou à conversa |
| 46 | ~~**`preparar_orcamento` recusa o mesmo pedido de um orçamento já criado na conversa** (tipo, e-mail e itens; nome e observações ficam de fora)~~ (revogada pela 50: sem criação, não há duplicata) | No "pode criar" repetido o modelo preparava o pedido de novo com token novo, e o "sim" seguinte criava um segundo orçamento: 3 de 5 rodadas com o modelo real em 20/10. A guarda por token não cobria token novo |
| 47 | **Id e cor dos 3 últimos produtos detalhados vão ao prompt** (`produtos_detalhados`) | Mesma causa da 44: pedindo o orçamento num turno depois do detalhe, o modelo refazia busca e detalhe (5 de 5 em 20/10) ou inventava o `subproduto_id` (1 de 5 em 19/10) e transferia |
| 48 | **Modelo = `gpt-4o-mini`**, `LLM_REASONING` vazio | Reunião de 20/10 com o Luis: a Luna raciocina demais e perde precisão. O 4o-mini sai da API em janeiro; a meta é migrar antes para o Jev, o modelo do Vero. Substitui a 32 |
| 49 | **`LLM_REASONING` com modelo `gpt-4*` é erro**: `criarLLM` recusa ao subir e o `verificar:env` reprova | O 4o-mini não aceita `reasoning_effort`, e o `.env.example` com `none` fazia todo turno dar 400 (25/10) |
| 50 | **R5: o agente estima e transfere a ficha; quem emite o orçamento é uma pessoa.** Saem o `criar_orcamento`, a escrita simulada e o `consultar_orcamento`; status de orçamento vai para uma pessoa. A ficha é mínima: PF/PJ, nome ou empresa, e-mail, itens, prazo desejado e personalização, sem CPF, CNPJ nem endereço | Requisito R5 do PET da loja (Sebraetec): "a ferramenta lê o catálogo e estima; quem emite é pessoa". Decisão do João (25/10). O preço do site já inclui a personalização padrão; o resto a equipe confirma. Revoga a 33 e a 46 |
| 51 | **Tolerância zero no transbordo e no dado bancário**: desconto, negociação ("faz por R$ X?"), pagamento e Pix transferem; o agente nunca envia dado bancário nem chave Pix | PET §10.5 |
| 52 | **Resposta que promete transferir sem chamar `transferir_humano` volta ao modelo uma vez**, com um aviso do sistema; a promessa não entra no histórico | O 4o-mini escrevia "vou transferir você" sem chamar a ferramenta (eval 32, 1 em 3): ninguém era avisado e o cliente ficava esperando |
| 53 | **Erro do modelo não zera a contagem de falhas da API** (parâmetro inválido, ferramenta desconhecida, motivo inválido). Complementa a 37 | A sequência 500 → parâmetro errado → 500 nunca chegava a 2 falhas e não transferia (eval 11) |
| 54 | **A mesma ficha preparada de novo no turno da confirmação mantém a confirmação** (tipo, e-mail e itens iguais); ficha diferente pede confirmação nova | O 4o-mini chamava `preparar_orcamento` de novo no "pode enviar", e a transferência era recusada por falta de confirmação (eval 05) |
| 55 | **`buscar_produtos` devolve o `subproduto_id` de cada cor** | O 4o-mini mandava o id do produto no lugar do subproduto e entrava em loop no `informe_a_cor` |

---

## 13. Como foi verificado

| Camada | O que prova | Resultado |
|---|---|---|
| Testes unitários e de contrato (`npm test`) | Cada peça, as regras de negócio e o contrato ponte ↔ agente | 818 passando |
| Suíte de homologação (`test:homologacao`) | Fluxos completos pelo `AgenteDefinitivo` real com o modelo roteirizado, oráculo de preço em todo o catálogo, segurança e transferência | H1–H4 verdes. Rodada contra o código da Fase 5, derruba 8 testes |
| Validação externa (Fase 4) | Revisão adversarial dos Pacotes A e B | 3 rodadas; achados corrigidos |
| Verificação real (Fase 4) | API real, catálogo real, evals com a Luna | 6.527/6.527 no índice; 44/3, 41/6, 41/6 |
| Evals de homologação (19/10, depois das correções) | O modelo real escolhe o caminho certo, 3 rodadas, critério do roteiro | **Aprovado**: 195/195 checagens; os 26 cenários em 3/3 ([relatório](fase-6/evals-2026-10-19-correcoes.json)) |
| Evals de 20/10 (riscos do "pode criar" repetido e do id da cor) | Os mesmos, mais os cenários 27–29 | **Aprovado** com o critério corrigido do 27: 214/216 na rodada completa, e as 2 falhas eram da expectativa retirada. Detalhe abaixo |
| Evals de 25/10 (`gpt-4o-mini`, fluxo do R5) | O modelo do piloto escolhe o caminho certo, 3 rodadas, mesmo critério | **Aprovado**: 237/237, os 29 cenários em 3/3 ([relatório](fase-6/evals-2026-10-25-4o-mini.json)). Detalhe abaixo |

Todos os evals rodam com o modelo real e a **loja simulada** (`MockBrindeMeClient`, `evals/ambiente.ts`): medem a escolha do modelo, não a API. Os de 19/10 e 20/10 usaram a Luna e o fluxo antigo, com `criar_orcamento`; valem como histórico.

### Evals de 19/10 — de reprovado a aprovado

Rodados com `gpt-6-luna`, `LLM_REASONING=none`, `--via-api`, 3 rodadas. Os 15 cenários críticos precisam passar em todas as rodadas. A primeira rodada ([relatório](fase-6/evals-2026-10-19.json)) reprovou com 178/192. Causas, lidas nos logs, e correções:

| Cenário | Antes | Causa | Correção | Depois |
|---|---|---|---|---|
| 06 Não duplicar orçamento (crítico) | 0/3 | O modelo tratava "quero fazer um orçamento" como dúvida de processo e chamava `consultar_conhecimento`. Com a base vazia (#13), virava lacuna e transferia. Já acontecia na Fase 4 (6 de 8 execuções antigas) e era a causa da instabilidade do 05 | Decisão 43. O padrão "dois códigos" do eval também reprovava a mesma resposta citando o mesmo código duas vezes | 3/3 |
| 11 API em 500 (crítico) | 1/3 | O cenário tinha uma mensagem só, sem quantidade; o modelo (certo) perguntava antes de chamar a API | O cenário passou a ter quantidade e um "tenta de novo" | 3/3 |
| 13 Fora do escopo | 1/3 | Também ia para a base e transferia | Decisão 43; o eval passou a exigir que não transfira | 3/3 |
| 05 Orçamento completo | 2/3 | Mesma causa do 06 | Decisão 43 | 3/3 |
| 15 Arte `.exe` | 3/3 → 1/3 | Regressão da decisão 43: o modelo passou a chamar `registrar_arte` com o arquivo recusado (sem dano, a ferramenta recusa) | Linha "arquivo recusado" na tabela de intenções | 3/3 |

Também corrigidos, achados no ensaio da demo: "a primeira opção" (decisão 44) e a consulta do orçamento TESTE, que transferia.

### Evals de 20/10: os dois riscos que ficaram abertos

Os dois riscos foram medidos com o modelo real **antes** da correção, com 5 conversas cada contra a API da loja e a escrita simulada:

| Risco | Antes | Depois |
|---|---|---|
| "Pode criar" repetido (decisões 46 e 47) | 3 de 5 conversas com **orçamento duplicado** e 2 transferidas | 0 duplicado em 15 conversas. Depois do ajuste do prompt, o segundo "pode criar" responde com o código |
| Orçamento pedido no turno seguinte ao detalhe (decisão 47) | 5 de 5 refizeram a busca e o detalhe; 3 nem chegaram ao resumo | 5 de 5 foram direto ao `preparar_orcamento` com o id real |

Rodada completa ([relatório](fase-6/evals-2026-10-20.json)), `gpt-6-luna`, 3 rodadas: 214/216. A rodada reprovou porque o 27 passou em 1 de 3. Nas duas falhas não houve duplicata: o modelo respondeu "já foi criado" com o código no segundo "pode criar" e transferiu na **terceira** confirmação, seguindo a regra do prompt "intenção não clara após 2 tentativas". O cenário foi dividido. O 27 (crítico) passou a conferir só a duplicata e dá 3/3 nas mesmas conversas. O 29 (não crítico) confere que o segundo "pode criar" responde sem transferir e teve 3/3 ([relatório](fase-6/evals-2026-10-20-cenario-29.json)).

O 04 reprovou 3 de 3 com a resposta certa ("Quantas você precisa?", sem preço): o padrão aceitava só a palavra "quantidade". Ele passou a conferir as duas partes da regra (pergunta a quantidade e não dá preço) e teve 3/3 na rodada completa.

Na escrita **simulada**, a confirmação repetida às vezes ainda transfere (2 em 5): o modelo avisa que o orçamento TESTE "não foi enviado à loja" e, no "pode criar" seguinte, tenta o real. Com escrita real o código não é TESTE, e o eval com a loja simulada teve 0 transferência no segundo "pode criar".

### Evals de 25/10: troca para o `gpt-4o-mini` e o R5

Rodados com `gpt-4o-mini`, `LLM_REASONING` vazio, `--via-api`. O caminho:

| Etapa | Resultado |
|---|---|
| Primeira rodada, com `LLM_REASONING=none` | Todo turno deu 400: o 4o-mini não aceita `reasoning_effort` (decisão 49) |
| Fluxo antigo, 3 rodadas | **173/237, reprovado** (a Luna tinha feito 214/216). O modelo perguntava em vez de buscar, dizia "vou transferir" sem chamar a ferramenta, mandava o id do produto como subproduto e criava o orçamento de novo |
| R5 e ajustes de prompt (decisões 50, 51, 54, 55), 4 ciclos | 71/79 → 75/79 → 78/79 (1 rodada cada) → 230/237 em 3 rodadas, reprovado pelo 16 (CNPJ, 1/3) e pelo 32 (Pix, 2/3) |
| Guarda da transferência prometida e contagem de falhas (decisões 52 e 53) | **237/237, aprovado** |

Mudanças nos cenários: 05, 06, 26, 28 e 31 foram reescritos para o R5 (terminam na transferência `orcamento_para_emitir`, sem código de orçamento); 27 e 29 saíram, porque mediam a duplicata da criação; o 32 (Pix, crítico) é novo. Nenhuma rodada devolveu CNPJ inventado nem dado bancário.

Os ajustes de prompt mais eficazes com o 4o-mini foram exemplos concretos de primeira mensagem e o motivo de transferência escrito em cada linha da tabela de intenções. Regras gerais ("chame a ferramenta na hora") não bastaram.

**Ainda não verificado:** o fluxo do R5 com o `gpt-4o-mini` contra a **API real** e o catálogo real (`npm run chat`), e o WhatsApp real (sessão, mídia, reinício, eco). O chip está no [roteiro de homologação, parte B](fase-6/roteiro-homologacao.md#b-no-chip-whatsapp-real).

---

## 14. Limitações e pendências

| Item | Situação | Quem decide |
|---|---|---|
| Base de conhecimento sem item aprovado (#13) | Toda dúvida geral vai para uma pessoa | Luis / loja |
| Prazo de retenção (#4) | `limpar:dados` cobre todos os arquivos com dado de cliente e exclui um cliente a pedido; prazo e frequência não decididos | Luis / loja |
| Teste no chip | Roteiro pronto, falta o chip | Time |
| Riscos levados ao chip (25/10) | Eval 14 falha ~1 em 18 rodadas ("vou verificar" sem consultar a base; não inventa prazo). O modelo às vezes preenche prazo ou personalização que o cliente não disse (visível no resumo). "Na cor que tiver" às vezes pergunta a cor. Pedido real não testado | João |
| Itens do PET para depois do chip | Aviso LGPD no 1º contato (depende da página da loja), 2 semanas em paralelo com o atendimento humano, origem do contato e CRM, plano B para a Cloud API | Luis / loja |
| Planilha de requisitos R1–R15 | Não recebida; só o R5 foi aplicado, a partir do PET | Dudu |
| Modelo depois de janeiro | O `gpt-4o-mini` sai da API; a meta é o Jev do Vero | Time |
| Alertas proativos (Fase 5, C3) e métricas ao vivo (C4) | Não feitos; `relatorio:piloto` cobre a C4 depois do expediente | Dono da Fase 5 |
| Envio do mockup ao cliente | Não implementado. A API devolve `product_mock_image_url`, mas o fluxo "equipe aplica a arte → agente envia" não foi confirmado com a loja | Loja |
| Mudança de status por polling | Não implementado: a API não tem webhooks | — |
| Busca por significado (embeddings) | Não implementada; a busca usa sinônimos e etiquetas de ocasião | — |
| Etiquetas de ocasião | Mecanismo pronto, tabela vazia | Loja |
| Pedido dividido em várias cores | Cada cor precisa cobrir a quantidade inteira (decisão 18) | Confirmar com a loja |
| Horário de atendimento humano | O agente não informa | Loja |
| "Como faço?" ainda vai para a base | Corrigido para orçamento e assunto de fora (decisão 43). Sobra ~1 em 10 pedidos com cara de dúvida de processo ("preciso de 200 squeezes com logo, como faço?"), que transfere | Some quando a loja aprovar o texto **Como funciona o pedido** (#13) |
| Orçamentos de teste 24–27 | Criados em produção na Fase 2, aguardam exclusão | Loja |

---

## 15. Mapa dos documentos

| Documento | Para quê |
|---|---|
| Este arquivo | Visão geral, ferramentas, garantias e decisões |
| [README.md](../README.md) | Como rodar, decisões 1–22, histórico das Fases 1–3 |
| [relatorio-validacao-api.md](relatorio-validacao-api.md) | O que a API real faz (Fase 2) |
| [relatorio-campos-api.md](relatorio-campos-api.md) | Campo a campo, API ↔ agente, e onde os dados sensíveis param |
| [base-de-conhecimento.md](base-de-conhecimento.md) | Guia da loja para aprovar a base |
| [spec da Fase 4](superpowers/specs/2026-10-14-fase-4-whatsapp-design.md) | Design da ponte do WhatsApp: contrato, erros e limites |
| [dogfooding-fase-4.md](dogfooding-fase-4.md) | Verificação real da Fase 4 |
| [plano da Fase 5](superpowers/plans/2026-10-17-fase-5-infraestrutura.md) | Kill switch e o que ficou de fora |
| [fase-6/relatorio-homologacao.md](fase-6/relatorio-homologacao.md) | Parecer, falhas corrigidas e condições do piloto |
| [fase-6/roteiro-homologacao.md](fase-6/roteiro-homologacao.md) | Aceite automatizado + chip, e o go/no-go |
| [fase-6/manual-operacao.md](fase-6/manual-operacao.md) | Operar o piloto no dia a dia |
