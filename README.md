# Agente de Atendimento — Fase 1

Protótipo de agente IA de atendimento para loja de brindes personalizados. Esta fase valida o comportamento (intenções, ferramentas, transferências) com ferramentas simuladas e chat no terminal. Não há integração real com API, WhatsApp ou banco de dados.

## Como rodar

### Pré-requisitos

- Node.js 20+
- Chave da API Anthropic

### Instalação

```bash
npm install
cp .env.example .env
# edite .env e preencha ANTHROPIC_API_KEY
```

### Chat no terminal

```bash
npm run chat -- --telefone 5583999990000
```

**Comandos disponíveis no chat:**

| Comando | Descrição |
|---|---|
| `/arte <arquivo.png>` | Simula envio de imagem |
| `/estado` | Exibe o estado estruturado da conversa (JSON) |
| `/falha <tipo> [n]` | Injeta falha nas próximas n chamadas da API (`timeout`, `500`, `404`, `412`, `422`) |
| `/humano` | Simula atendente assumindo o controle |
| `/retomar [nota]` | Devolve à IA com nota opcional do atendente |
| `/reset` | Reinicia a conversa |
| `/sair` | Encerra |

As ferramentas chamadas em cada turno são exibidas em cinza.

### Testes unitários

```bash
npm test
```

### Avaliação de comportamento (evals)

Requer `ANTHROPIC_API_KEY` configurada:

```bash
npm run evals
# ou um cenário específico:
npm run evals -- 01_saudacao
```

### Verificação de tipos

```bash
npm run typecheck
```

### Validação de acesso à API da loja (Fase 2)

O cliente HTTP real (`HttpBrindeMeClient`) fica atrás da mesma interface `BrindeMeClient`. A escolha entre mock e API real é por variável de ambiente — nenhuma tool sabe qual está em uso:

```bash
# .env
BRINDEME_MODE=http
BRINDEME_BASE_URL=https://...
BRINDEME_TOKEN=...
BRINDEME_AUTH_SCHEME=bearer   # ou: header + BRINDEME_AUTH_HEADER=X-API-Key
```

```bash
npm run check:api
```

O script é **somente leitura** (não cria orçamento) e valida, em ordem: acesso/token → listagem de produtos → detalhe com SKU, cores, estoque, faixas de preço e imagens → atendentes → pedido. Para testar a consulta de pedido, defina `BRINDEME_PEDIDO_TESTE=<código>`.

O diagnóstico distingue as falhas que importam: **401/403** aponta token ou esquema de auth errado, **404** aponta base URL ou caminho errado, e falha de conexão aponta rede.

Com `BRINDEME_MODE=http`, o comando `/falha` do chat não funciona — injeção de falha só existe no mock.

---

## Arquitetura

O agente recebe uma mensagem do usuário em `runTurn`, que monta o prompt de sistema (identidade + FAQ + estado estruturado), constrói o histórico de mensagens e entra em um loop com o LLM (Anthropic). Quando o modelo emite `tool_use`, o handler correspondente é executado usando o `BrindeMeClient` (mock nesta fase); o resultado volta ao LLM como `tool_result`, e o loop continua até `stop_reason = end_turn`. O estado da conversa (`ConversationState`) é atualizado diretamente pelos handlers e persiste em memória. Logs são gravados em JSONL por conversa em `logs/`, com CPF, e-mail e telefone mascarados. Ferramentas dependem apenas da interface `BrindeMeClient` — a Fase 2 só precisa adicionar `HttpBrindeMeClient`.

---

## Decisões técnicas

| # | Decisão | Motivo |
|---|---|---|
| 1 | `tsx` como runtime | Zero configuração para TypeScript + ESM |
| 2 | `zod-to-json-schema` para tool definitions | Zod valida entrada em runtime; o mesmo schema vai pro LLM |
| 3 | `BrindeMeClient` como interface TypeScript | Troca por implementação HTTP na Fase 2 sem tocar nas tools |
| 4 | Token de confirmação para `criar_orcamento` | Garante em código que o cliente viu o resumo antes |
| 5 | Idempotência pelo token no `ConversationState` + header `Idempotency-Key` | Vale para mock e HTTP; antes dependia de `instanceof MockBrindeMeClient` e o cliente real perderia a proteção em silêncio |
| 6 | `falhasConsecutivas` contado em `runTurn`, não nas tools | As tools capturam o erro internamente; contar no loop faz a regra "2 falhas → transferir" valer para todas as 8 ferramentas |
| 7 | `modo = "humano"` faz short-circuit antes do LLM | `runTurn` retorna `null`; CLI exibe mensagem de pausa |
| 8 | `tags_ocasiao` nos mocks (não vem da API) | Placeholder para busca semântica da Fase 3; tabela própria no Supabase |
| 9 | Preços como `number` (reais) nos mocks | Unidade real (texto ou centavos) a confirmar na Fase 2 |
| 10 | `translateApiError` em `errors.ts`, fora do mock | As tools dependem do tradutor em produção também |
| 11 | Retry exponencial só em GET; `createBudget` sem retry | POST repetido duplicaria orçamento — melhor falhar e deixar o agente decidir |
| 12 | Esquema de auth e caminhos dos endpoints configuráveis | A spec da loja ainda não confirmou o formato; trocar é mudar `.env` ou a constante `ENDPOINTS` |
| 13 | Tabela de preços por subproduto, não por produto | 3 dos 8 produtos do mock têm preço diferente por cor; a busca anuncia o menor ("a partir de") e o detalhe devolve a tabela de cada cor |
| 14 | Teto de consultas de pedido por conversa | O caminho "telefone não bate → pede e-mail" era gratuito e permitia varrer códigos: a resposta distinguia código real de inexistente |

---

## Estado da integração — Fase 2

Validado contra `https://api.brinde.me` com header `X-Api-Key` em 12/10/2026.
**Relatório completo: [docs/relatorio-validacao-api.md](docs/relatorio-validacao-api.md)**

| Entregável da Fase 2 | Status |
|---|---|
| Validar acessos e comportamento real (8 dos 9 endpoints) | ✅ |
| Módulo cliente da API com testes | ✅ |
| Ferramentas implementadas com testes de contrato | ✅ |
| Job de sincronização de pedidos e validação do cliente | ✅ |
| Relatório de validação da API | ✅ |

### Comandos

```bash
npm run check:api                  # valida acesso e as consultas (somente leitura)
npm run sync:pedidos -- --dias 180 # alimenta o índice local de pedidos
npm run test:orcamento             # exercita POST /budget (CRIA ORÇAMENTO REAL)
```

### O que a validação descobriu

- **A API ignora `Idempotency-Key`** — testado: duas chamadas com a mesma chave criaram orçamentos distintos. A guarda por token no estado da conversa é a única proteção contra duplicata
- **Orçamento PJ aceita `cnpj` e `trade_name`**, e o CNPJ é validado (CNPJ inválido → 422)
- **412 é validação de parâmetro de query**, não precondição HTTP — e é bug do nosso lado
- **Valores monetários em centavos** (`price: 377` = R$ 3,77)
- **Quatro envelopes de resposta diferentes** entre os endpoints
- **`GET /order/{id}` só aceita UUID** — daí o job de sincronização
- **Não existe busca por texto em `/product`** — o índice de catálogo é Fase 3, como o planejamento previu
- Itens de orçamento expõem `cost` (custo da loja) — nunca mapeado

### Tratamento de falhas

| Resposta | Sistema | Cliente |
|---|---|---|
| Timeout / 5xx | Retry com espera crescente, só em GET | "Estou com instabilidade…" |
| 401 / 403 | Alerta crítico + disjuntor abre na hora | Transferência |
| 404 | Registra | "Não encontrei esse pedido…" |
| 412 | Registra o corpo completo + alerta | Transferência |
| 422 | Devolve o campo inválido | Pedido de correção |
| 3 falhas seguidas | **Disjuntor** abre por 2 min | Transferência |

## Lacunas da API a confirmar na Fase 2

- **Status reais de pedido e orçamento** — a spec não lista os valores de `status_id`/`status_name`
- **Erro 412** — sem descrição na spec; o mock trata como genérico
- **Unidade monetária** — valores aparecem ora como texto, ora como inteiro na documentação
- **Campos PJ** — campos adicionais para pessoa jurídica (`cnpj`, `razao_social`) não estão documentados
- **Busca de pedido por código ou telefone** — `GET /order` filtra só por vendedor e período; busca direta por código precisará de workaround
- **Webhooks** — não documentados; atualização de status em tempo real pendente

---

## O que a loja precisa aprovar (antes da Fase 4)

- [ ] **Persona** — nome, tom e frases de saudação do assistente
- [ ] **FAQ** — todos os valores marcados como `[PLACEHOLDER]` em `src/knowledge/faq.md`
- [ ] **Matriz de intenções** — confirmar fluxos de reclamação, devolução e garantia
- [ ] **Responsáveis** — definir regra de atribuição de admin além do "primeiro da lista"
- [ ] **Horário de atendimento humano** — para o agente informar corretamente quando não há atendente disponível

---

## Resultado dos evals

Os evals requerem `ANTHROPIC_API_KEY`. Execute `npm run evals` para ver o relatório completo. Resultados esperados e ajustes sugeridos no prompt:

### Cenários que tendem a falhar e ajustes sugeridos

**Cenário 11 (API em 500 duas vezes → transferir):** O comportamento depende de o modelo interpretar `instrucao: "transferir"` no retorno da ferramenta e chamar `transferir_humano` voluntariamente. Ajuste sugerido: adicionar ao prompt uma instrução explícita — *"Quando o retorno de uma ferramenta incluir `instrucao: 'transferir'`, chame imediatamente `transferir_humano` com `motivo: 'falha_sistema'`."*

**Cenário 14 (Prazo não aprovado):** O modelo pode citar os valores fictícios do rascunho da FAQ sem os colchetes. Ajuste sugerido: remover completamente os valores de prazo da FAQ e substituir por *"[A confirmar com a loja — não informe prazos ao cliente sem aprovação]"*.

**Cenário 4 (Preço sem quantidade):** Em contextos onde o produto já está definido pelo histórico, o modelo pode responder com a faixa de preço sem pedir a quantidade. Ajuste sugerido: adicionar ao prompt — *"Quando o cliente perguntar preço, sempre pergunte a quantidade antes de dar o valor, pois o preço varia por faixa."*
