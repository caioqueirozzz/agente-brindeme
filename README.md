# Agente de Atendimento

Agente IA de atendimento no WhatsApp para loja de brindes personalizados: recomenda produtos, prepara e cria orçamentos, consulta pedidos e transfere para uma pessoa quando precisa.

## Piloto (Fase 6) — comece por aqui

| Documento | Para quê |
|---|---|
| [docs/fase-6/relatorio-homologacao.md](docs/fase-6/relatorio-homologacao.md) | O que foi testado, as falhas corrigidas, o que falta e o parecer |
| [docs/fase-6/roteiro-homologacao.md](docs/fase-6/roteiro-homologacao.md) | Roteiro de aceite (automatizado + chip) e critérios de go/no-go |
| [docs/fase-6/manual-operacao.md](docs/fase-6/manual-operacao.md) | Ligar, acompanhar, comandos do chip, transferências, incidentes, LGPD |

| Comando | O que faz |
|---|---|
| `npm run verificar:env -- --producao` | Confere a configuração antes de ligar (sai com 1 se houver erro) |
| `npm run whatsapp` | Sobe agente + ponte do WhatsApp |
| `npm run test:homologacao` | Suíte de homologação (fluxos, precisão, segurança, transferência) |
| `npm run evals -- --via-api --rodadas 3 --relatorio <arq.json>` | Evals com o modelo real e critério de aprovação |
| `npm run relatorio:piloto -- --desde AAAA-MM-DD` | Números do piloto a partir dos logs |
| `npm run limpar:dados [-- --dias N] [--executar]` | Retenção de dados (só lista sem `--executar`) |

As seções abaixo são o histórico das Fases 1 a 3.

---

## Fase 1 — protótipo

Protótipo de agente IA de atendimento para loja de brindes personalizados. Esta fase valida o comportamento (intenções, ferramentas, transferências) com ferramentas simuladas e chat no terminal. Não há integração real com API, WhatsApp ou banco de dados.

## Como rodar

### Pré-requisitos

- Node.js 20+
- Chave da API da OpenAI (`OPENAI_API_KEY`) e o id do modelo (`LLM_MODEL`)

### Instalação

```bash
npm install
cp .env.example .env
# edite .env e preencha OPENAI_API_KEY e LLM_MODEL
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

Requer `OPENAI_API_KEY` e `LLM_MODEL` configurados (chamam o modelo pago):

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

O agente recebe uma mensagem do usuário em `runTurn`, que monta o prompt de sistema (identidade + regras + estado estruturado — a FAQ saiu do prompt e virou a ferramenta `consultar_conhecimento`), constrói o histórico de mensagens e entra em um loop com o LLM (OpenAI, via `src/llm/openai.ts`, que traduz o formato de blocos `tool_use`/`tool_result` para o da Chat Completions). Quando o modelo emite `tool_use`, o handler correspondente é executado usando o `BrindeMeClient` (mock nesta fase); o resultado volta ao LLM como `tool_result`, e o loop continua até `stop_reason = end_turn`. O estado da conversa (`ConversationState`) é atualizado diretamente pelos handlers e persiste em memória. Logs são gravados em JSONL por conversa em `logs/`, com CPF, e-mail e telefone mascarados. Ferramentas dependem apenas da interface `BrindeMeClient` — a Fase 2 só precisa adicionar `HttpBrindeMeClient`.

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
| 8 | `tags_ocasiao` nos mocks (não vem da API) | Na Fase 3 vira só "etiqueta embutida"; a fonte real é a tabela da loja (`etiquetas-ocasiao.json`, decisão 20) |
| 9 | Preços como `number` (reais) nos mocks | Unidade real (texto ou centavos) a confirmar na Fase 2 |
| 10 | `translateApiError` em `errors.ts`, fora do mock | As tools dependem do tradutor em produção também |
| 11 | Retry exponencial só em GET; `createBudget` sem retry | POST repetido duplicaria orçamento — melhor falhar e deixar o agente decidir |
| 12 | Esquema de auth e caminhos dos endpoints configuráveis | A spec da loja ainda não confirmou o formato; trocar é mudar `.env` ou a constante `ENDPOINTS` |
| 13 | Tabela de preços por subproduto, não por produto | 3 dos 8 produtos do mock têm preço diferente por cor; a busca anuncia o menor ("a partir de") e o detalhe devolve a tabela de cada cor |
| 14 | Teto de consultas de pedido por conversa | O caminho "telefone não bate → pede e-mail" era gratuito e permitia varrer códigos: a resposta distinguia código real de inexistente |
| 15 | Base de conhecimento em `base/<categoria>.json`, com `status` aprovado/rascunho, dono e `revisar_em` | Planejamento: item curto, com dono e data de revisão; só aprovado entra |
| 16 | Item com `[PLACEHOLDER]` nunca é servido, nem com `KB_INCLUIR_RASCUNHOS=true`; o esquema recusa item *aprovado* com placeholder | O risco real é o agente repetir "[X] dias" ou um valor fictício; falha fechada no código, não no prompt |
| 17 | Busca por BM25 em português (sem acento, radical leve, sinônimos) com **corte de cobertura** | Sem provedor de embeddings definido. A cobertura impede responder com um item que só casa uma palavra solta; abaixo do corte é lacuna e transfere |
| 18 | O estoque é conferido **por cor**: uma cor precisa cobrir a quantidade inteira | A spec não diz como a plataforma faixa o preço de um pedido dividido em cores; não sugerir é mais seguro que sugerir um preço que o orçamento contradiz. *Confirmar com a loja* |
| 19 | O índice só escolhe candidatos; estoque e preço vão ao cliente depois de `GET /product/{id}` e das mesmas regras rodando sobre o dado fresco | Planejamento: "estoque e preço final sempre reconferidos". Produto não verificável não é sugerido |
| 20 | Etiquetas de ocasião em tabela separada (por produto, SKU ou categoria), lida a cada conversa | A API não tem o campo; a loja edita sem esperar a sincronização |
| 21 | Sincronização do catálogo: listagem falha → nada é gravado; produto some da listagem → sai só após 2 sincronizações completas; inativo sai na hora | Paginação sem ordenação fixa pode pular itens; um catálogo parcial nunca substitui um bom |
| 22 | Reconferência na API em lotes de 4, no máximo 12 por pergunta; falha em *todas* é falha de API, não "não temos" | Evita dizer ao cliente que não há produto quando é a API que caiu, e mantém a contagem de falhas da Fase 2 |

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
- **Não existe busca por texto em `/product`** — o índice de catálogo é a Fase 3 (`npm run sync:catalogo`), como o planejamento previu
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

## Estado do conhecimento e da recomendação — Fase 3

Guia para a equipe da loja: **[docs/base-de-conhecimento.md](docs/base-de-conhecimento.md)**

| Entregável da Fase 3 | Status |
|---|---|
| Base de conhecimento inicial preenchida **e aprovada** por categoria | ⚠️ Preenchida: 17 itens nas 7 categorias. **Nenhum aprovado** — aprovar é ato da loja (`npm run kb:validar` mostra o que falta e com quem) |
| Job de sincronização do catálogo e índice de busca | ✅ `npm run sync:catalogo` |
| Tabela de etiquetas de ocasião mantida pela loja | ⚠️ Mecanismo pronto; a tabela está **vazia** — a loja etiqueta |
| `buscar_produtos` com testes de recomendação | ✅ |
| *Pronto quando*: 30 pedidos da loja, sugestões dentro de mínimo/estoque/orçamento **e** adequadas | ⚠️ Verificação automática pronta (`npm run avaliar:recomendacao`) com 30 pedidos *de exemplo*; falta a loja trocar por pedidos reais e marcar a planilha |

### O que ficou pronto

- **Ferramenta `consultar_conhecimento`**: responde dúvidas gerais só com item aprovado; sem resposta na base, registra a **lacuna** (`data/lacunas.jsonl`, mascarada) e devolve `instrucao: "transferir"` com `motivo_sugerido: "lacuna_conhecimento"`. O log do turno guarda os `id`s usados (`kb_consulta`, `kb_itens` em `response_sent`).
- **Índice do catálogo** (`data/produtos-index.json`): nome, descrição, categorias, cores com estoque, faixas de preço, mínimo, imagem principal e personalizações. Incremental por `updated_at`; ver decisão 21 para as regras de segurança.
- **Recomendação em 5 passos** (`src/catalogo/recomendar.ts`): filtros rígidos → ordem por similaridade, ocasião e destaque → até 3 opções com preço da faixa e total → reconferência na API → sem resultado: explica e propõe o ajuste mais próximo (aumentar quantidade, reduzir quantidade ou subir o valor), **verificado pelas mesmas regras**.
- `buscar_produtos` ganhou `orcamento_total` (exige `quantidade`) e passa a devolver `total_estimado`. Sem quantidade, devolve `preco_a_partir_de` na quantidade mínima, com aviso.
- Prompt: FAQ removida; regras de coleta (uma pergunta por vez, quantidade antes de preço), apresentação (máx. 3, só dados da ferramenta) e a regra de chamar `transferir_humano` quando o retorno trouxer `instrucao: "transferir"` (o ajuste sugerido para o cenário 11 abaixo).

### Comandos

```bash
npm run sync:catalogo                  # catálogo → índice (rodar de hora em hora)
npm run sync:catalogo -- --forcar      # relê o detalhe de todos os produtos ativos
npm run kb:validar                     # estado da base por categoria e responsável
npm run kb:validar -- --exigir-aprovacao   # falha se houver item não aprovado (gate de release)
npm run kb:lacunas                     # perguntas que a base não soube responder
npm run avaliar:recomendacao           # confere os pedidos na API e gera a planilha da equipe
```

No modo `mock` o chat monta o índice sozinho. Com `BRINDEME_MODE=http` ele **não** sincroniza sozinho (são milhares de produtos): rode `npm run sync:catalogo` antes; sem índice, `buscar_produtos` falha de forma explícita e o agente transfere.

### Como foi verificado — e o que não foi

- 347 testes (142 antes da fase), incluindo: regras de mínimo/estoque/faixa/orçamento; sincronização (paginação, incremental, falha de listagem, falha de detalhe, remoção); revalidação (estoque que acabou, preço que mudou, 404, API fora); ajustes propostos *reaplicados ao pedido* para provar que fecham; e os 30 pedidos contra um catálogo sintético de 400 produtos, com um **verificador independente** (`src/catalogo/verificacao.ts`) que recalcula tudo do produto cru, sem reusar a lógica sob teste.
- Verificação por mutação: 10 quebras deliberadas das regras de segurança (ignorar mínimo, estoque por cor, revalidação, falha de listagem, servir rascunho/placeholder, corte de cobertura...) — todas derrubaram testes.
- Desempenho medido em 6.535 produtos sintéticos: ~15–40 ms por busca (a primeira de cada carga do índice, ~350 ms, monta o BM25).
- **Não foi rodado contra a API real nem com o modelo**: não há `BRINDEME_TOKEN` nem chave do modelo neste ambiente. O formato real do catálogo é coberto pelas fixtures gravadas na Fase 2 (`tests/contrato.test.ts`); os 3 cenários de eval novos (16–18) e o comportamento do prompt **ainda não foram executados**.

### Correção feita no caminho

O mascaramento de telefone nos logs (Fase 2) só cobria números de 13–15 dígitos (com `55`). `83999990000` e `(83) 99999-0000`, do jeito que o cliente digita, passavam em claro — e agora a fala do cliente também vai para o registro de lacunas. Corrigido em `src/logging/logger.ts`; o teste antigo copiava as funções inline em vez de importar o módulo real, então não protegia nada — agora importa `mascararTexto`.

### Limitações conhecidas

- **Sem embeddings.** O plano prevê busca por significado; não há provedor de embeddings escolhido (com a troca para a OpenAI em 15/10, a própria OpenAI passa a ser candidata). A busca usa sinônimos (`src/busca/sinonimos.ts`) e as etiquetas de ocasião. "Algo para professores" funciona *se* a loja etiquetar. Para embeddings (Supabase `pgvector`, na Fase 5), basta somar um termo de similaridade ao `relevancia()` de `recomendar.ts`.
- **A data em que o cliente precisa não filtra produto** (depende do prazo de produção, ainda não aprovado). Fica no estado da conversa e a resposta de prazo vem da base.
- **Cor única**: ver decisão 18. Quem pede 400 unidades e tem duas cores com 300 e 200 em estoque recebe "sem estoque suficiente" e o ajuste "reduzir para 300", não uma sugestão misturada.
- O índice é um arquivo JSON (padrão da Fase 2). Com 6.535 produtos tem alguns MB e é lido inteiro na memória; a troca por Supabase está prevista para a Fase 5 pela interface `ProductIndexStore`.

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
- [ ] **Base de conhecimento** — preencher os `[PLACEHOLDER]` e aprovar os itens em `src/knowledge/base/` (cada categoria com o seu aprovador; ver `npm run kb:validar`)
- [ ] **Etiquetas de ocasião** — preencher `src/knowledge/etiquetas-ocasiao.json` (por categoria, SKU ou produto)
- [ ] **Estoque por cor** — confirmar com a loja: o pedido dividido em várias cores pode ser faixado pelo total ou por linha? (decisão 18)
- [ ] **30 pedidos reais de recomendação** — substituir `evals/recomendacao/pedidos.json` e marcar a planilha de `npm run avaliar:recomendacao`
- [ ] **Matriz de intenções** — confirmar fluxos de reclamação, devolução e garantia
- [ ] **Responsáveis** — definir regra de atribuição de admin além do "primeiro da lista"
- [ ] **Horário de atendimento humano** — para o agente informar corretamente quando não há atendente disponível

---

## Resultado dos evals

Os evals requerem `OPENAI_API_KEY` e `LLM_MODEL`. Execute `npm run evals` para ver o relatório completo. Resultados esperados e ajustes sugeridos no prompt:

### Cenários que tendem a falhar e ajustes sugeridos

**Cenário 11 (API em 500 duas vezes → transferir):** O comportamento depende de o modelo interpretar `instrucao: "transferir"` no retorno da ferramenta e chamar `transferir_humano` voluntariamente. Ajuste aplicado na Fase 3 (o prompt agora manda chamar `transferir_humano` imediatamente quando o retorno trouxer `instrucao: "transferir"`, com o `motivo_sugerido`).

**Cenário 14 (Prazo não aprovado):** resolvido na Fase 3 por construção — o prazo só chega ao modelo se existir item *aprovado* na base (hoje não existe: vira lacuna e transfere). O prompt não carrega mais texto de FAQ.

**Cenário 4 (Preço sem quantidade):** Em contextos onde o produto já está definido pelo histórico, o modelo pode responder com a faixa de preço sem pedir a quantidade. Ajuste aplicado na Fase 3 (seção "Como recomendar produtos" do prompt: quantidade antes de preço). Cenário 17 cobre.
