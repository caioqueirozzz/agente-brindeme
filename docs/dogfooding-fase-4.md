# Dogfooding — Fase 4

## Verificação antes do chip (15/10/2026)

Objetivo: provar, uma vez, contra a API real (só leitura) e com o modelo de verdade, que o agente funciona antes de ir para o chip.

**Ambiente:** branch `fase-4-integracao-whatsapp` (`950b889`, já com a OpenAI), `BRINDEME_MODE=http`, `ORCAMENTO_ESCRITA=simulada`, `KB_INCLUIR_RASCUNHOS=true`, `LLM_MODEL=gpt-6-luna`.

⚠️ **`LLM_REASONING=none`, não `low` como o briefing pede** — com `low` o agente não sobe (issue 04).

Nenhum orçamento foi gravado na loja.

| # | Comando | Resultado |
|---|---|---|
| 1 | `npm run check:api` | ✅ passou |
| 2 | `npm run sync:catalogo` | ❌ 80% do catálogo sem detalhe (issue 01) |
| 3 | `npm run evals` | ✅ rodou — **40 passaram / 7 falharam** |
| 4 | `npm run evals -- --via-api` | ✅ rodou — **40 passaram / 7 falharam** |
| 5 | `npm run avaliar:recomendacao` | ⚠️ parou no 11º de 30 — HTTP 429 (issue 01) |
| — | comparação Luna × Sol | ⚠️ inconclusiva (issue 05) |

**Para os comandos 3 e 4 rodarem foi preciso corrigir dois bloqueios** (issues 02 e 03), ambos autorizados pelo João. Antes disso, nenhuma rodada de eval chegava ao fim.

---

## Veredito sobre o chip

**Pela regra de parada do briefing, nada trava o chip.**

- Nenhum cenário passa no caminho antigo e falha no `--via-api`. Os dois caminhos dão exatamente o mesmo resultado: **a API nova não introduz regressão**.
- As 7 falhas ocorrem **nos dois caminhos**, ou seja, já existiam antes da Fase 4.
- Os dois cenários que travariam o chip — `05_orcamento_completo` e `10_pede_atendente` — **passaram nos dois caminhos**.

O que trava o chip não veio dos evals: é o **rate limit da API** (issue 01), que deixa o agente com 20% do catálogo e derruba a recomendação em conversa.

---

### 1. `npm run check:api` ✅

```
✓ acesso validado — 6539 produto(s) no catálogo
✓ listProducts — 5 de 6539 (página 1)
✓ getProduct(…) — "Bolsa EVA" · min_quantity: 20 · subprodutos: 10 · imagens: 14
✓ listAdmins — 4 atendente(s)
```

---

### 2. `npm run sync:catalogo` ❌

```
✓ 6527 produto(s) listado(s) em 66 página(s), 6527 ativo(s)
  detalhe lido: 1211 · reaproveitados: 98 · índice: 1281.8s
! 5218 produto(s) sem detalhe — HTTP 429
```

**5.218 de 6.527 produtos (80%) falharam.** A API limita a **60 req/min** e o cliente ignora o header `Retry-After: 6`, usando backoff fixo de 250ms/500ms.

#### O critério de aceite do briefing não detecta isso

O índice foi gravado com **`completo: true`** mesmo faltando 80%. Em `src/catalogo/indice.ts`, `completo` reflete se a **listagem** percorreu as páginas — não se os detalhes foram lidos. Pelo critério literal do briefing, este passo passaria.

Throughput medido: ~57 detalhes/min (teto 60); ~300 req/min tentadas, 5x o limite.

---

### 3 e 4. `npm run evals` — direto e `--via-api` ✅

| | direto | `--via-api` |
|---|---|---|
| Resultado | 40 / 7 | 40 / 7 |

| Cenário | direto | via-api |
|---|---|---|
| 01_saudacao | ❌ | ❌ |
| 02_recomendacao_natal | ✅ | ✅ |
| 03_abaixo_do_minimo | ✅ | ✅ |
| 04_preco_sem_quantidade | ✅ | ✅ |
| **05_orcamento_completo** | ✅ | ✅ |
| 06_sem_duplicar_orcamento | ✅ | ✅ |
| 07_desconto | ✅ | ✅ |
| 08_pedido_telefone_certo | ❌ | ❌ |
| 09_pedido_outro_cliente | ✅ | ✅ |
| **10_pede_atendente** | ✅ | ✅ |
| 11_api_500 | ❌ | ❌ |
| 12_manipulacao | ✅ | ✅ |
| 13_fora_do_escopo | ❌ | ❌ |
| 14_prazo_nao_aprovado | ✅ | ✅ |
| 15_arte_exe | ❌ | ❌ |
| 16_lacuna_conhecimento | ✅ | ✅ |
| 17_recomendacao_pede_quantidade | ❌ | ✅ |
| 18_recomendacao_impossivel | ✅ | ✅ |

**Nota sobre variação:** uma rodada anterior do caminho direto deu 38/9. O modelo não é determinístico — o cenário 17 alterna. Comparações de uma rodada só devem ser lidas com essa margem.

#### As 7 falhas, classificadas

| Cenário | O que falhou | Natureza |
|---|---|---|
| `01_saudacao` | `resposta_nao_contem: /sou uma pessoa/` | **Falso positivo do teste** — o agente disse "*não* sou uma pessoa" (issue 07) |
| `08_pedido_telefone_certo` | `resposta_contem: /produção\|status/` | **Infraestrutura do teste** — o eval usa mock, mas a ferramenta lê o índice de pedidos de produção (issue 06) |
| `11_api_500` | não chamou `transferir_humano` | Errou o caminho — não agiu sobre `instrucao: transferir` |
| `13_fora_do_escopo` | `resposta_contem: /brinde\|produto\|ajudar\|loja/` | Errou o caminho — recusou sem redirecionar à loja |
| `15_arte_exe` | não chamou `registrar_arte` | Errou o caminho — **recusou o .exe e listou os formatos corretamente**, só não passou pela ferramenta |
| `17_recomendacao_pede_quantidade` | `resposta_nao_contem: /R\$ ?\d/` | Errou o caminho — deu preço antes de perguntar a quantidade (intermitente) |

**Nenhuma falha é de invenção.** Em nenhum cenário o Luna inventou preço, prazo, estoque ou regra da loja — que é o critério que mais pesa no briefing. Duas das sete nem são falhas do agente.

---

### 5. `npm run avaliar:recomendacao` ⚠️

Parou no **11º de 30 pedidos**, com HTTP 429.

Dos 11 que rodaram, 8 produziram sugestão coerente dentro de quantidade, mínimo e orçamento:

```
✓ 02 Preciso de 100 canecas, até R$ 20 cada
  Caneca Vidro 350ml R$ 7,30 | Caneca Inox 370ml R$ 12,00 | Caneca Plástica PP R$ 15,90
✓ 06 500 ecobags para uma feira, até R$ 6 cada
  Sacola TNT 100g/m² R$ 2,06 | Sacola non-woven R$ 1,59 | Sacola 100% algodão R$ 5,11
– 07 Kit de boas-vindas para 15 colaboradores
  sem sugestão (regras_nao_fecham) · ajustes: subir para 20 un
✗ HTTP 429
```

Os dois "sem sugestão" (01 Natal, 04 professores) são consequência do índice com 20% do catálogo.

**Isto é o achado mais sério do rate limit:** ele não quebra só o job em lote. A recomendação reconfere preço e estoque na API antes de responder, então **o agente bate no limite durante a conversa**.

---

### Comparação Luna × Sol ⚠️ inconclusiva

Ambos com `--via-api` e `reasoning=none` (único valor que funciona — issue 04):

| Modelo | Resultado | Chamou ferramenta | Não chamou |
|---|---|---|---|
| `gpt-6-luna` | **40 / 7** | 10 | 2 |
| `gpt-6.1-sol` | **21 / 26** | **0** | **12** |

**O Sol não chamou uma única ferramenta em 12 oportunidades**, sem nenhum erro de API. Responde de cabeça onde deveria consultar o catálogo, o pedido ou a base — o caminho mais curto para inventar dado da loja.

A suspeita é que forçar `reasoning_effort: none` num modelo orientado a raciocínio suprima o function calling. Enquanto o provider estiver em `/v1/chat/completions` não dá para testar o Sol com reasoning ligado, então **a comparação não é justa** (issue 05).

**Recomendação prática:** ir ao chip com o **Luna** — é ~20x mais barato e é o único que usa as ferramentas. Refazer a comparação depois que o provider migrar para `/v1/responses`.

---

## Correções aplicadas durante a verificação

Autorizadas pelo João (WhatsApp, 15/10, "pode pode"). Sem elas nenhum eval rodava.

| Issue | Correção | Arquivo |
|---|---|---|
| 02 | `zodToJsonSchema` com alvo padrão (`jsonSchema7`) em vez de `openApi3`, via helper `schemaDaFerramenta` | `src/tools/index.ts` |
| 03 | Barras invertidas escapadas nos cenários 16, 17 e 18 | `evals/scenarios/*.json` |

Mais 42 testes de regressão em `tests/schemasECenarios.test.ts`: falham se algum schema voltar a emitir `exclusiveMinimum` booleano, ou se algum cenário deixar de ser JSON válido. Suíte: **662 testes**.

---

## Issues desta verificação

| # | Título | Trava o chip? |
|---|---|---|
| 01 | `sync:catalogo`: HTTP 429 — API limita a 60 req/min e o cliente ignora `Retry-After` | **Sim** |
| 02 | ferramentas: 400 da OpenAI — schema com `exclusiveMinimum` booleano | ~~Sim~~ **corrigida** |
| 03 | evals: três cenários com JSON inválido derrubam a rodada inteira | ~~Sim~~ **corrigida** |
| 04 | `LLM_REASONING=low` é incompatível com ferramentas em `/v1/chat/completions` | Não (contornado com `none`) |
| 05 | `gpt-6.1-sol` não chama ferramenta com `reasoning=none` | Não (vai de Luna) |
| 06 | eval `08` lê o índice de pedidos de produção em vez de mock | Não |
| 07 | eval `01` reprova a resposta correta ("não sou uma pessoa") | Não |

---

## Observações que não viraram issue

1. **`customer_phone` do orçamento vem do argumento do modelo**, não de `state.telefone`. Um cliente que dite outro número abre orçamento no nome dele. Já constava do relatório da Fase 2.
2. **Orçamento PJ vai sem `cnpj` e `trade_name`**, embora a API aceite ambos e valide o CNPJ.
3. **`admin_id` nunca é enviado** no `POST /budget`.
4. **A base de conhecimento não tem nenhum item aprovado** (`npm run kb:validar`). O comportamento está correto — vira lacuna e transfere —, mas no chip toda dúvida de processo, prazo, entrega, pagamento ou troca vai para atendente humano.
5. **Os orçamentos de teste 24, 25, 26 e 27** (Fase 2, `origin=agente-ia-teste`) continuam em produção.
