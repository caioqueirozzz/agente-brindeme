# Relatório de validação da API Brinde.me

**Data:** 12/10/2026 · **Entregável da Fase 2** · Validado com a chave real de produção

- **Base URL:** `https://api.brinde.me` (servidor único — não há ambiente de testes)
- **Autenticação:** header `X-Api-Key`. Sem a chave ou com chave inválida → **401**
- **Spec OpenAPI:** `https://api.brinde.me/docs.json` (a página `/docs` é SPA e não renderiza por fetch)

---

## 1. Endpoints exercitados

| Endpoint | Status | Observação |
|---|---|---|
| `GET /product` | ✅ | 6.535 produtos |
| `GET /product/{id}` | ✅ | subprodutos, SKU, cores, estoque, faixas de preço, imagens |
| `GET /budget` | ✅ | 12 orçamentos na janela |
| `GET /budget/{id}` | ✅ | via fixture de contrato |
| `POST /budget` | ✅ | PF (24), PJ com CNPJ (25), teste de idempotência (26, 27) |
| `PUT /budget/{id}` | ⬜ | fora do escopo do agente por decisão da Fase 1 |
| `GET /order` | ✅ | 2 pedidos |
| `GET /order/{id}` | ✅ | **só aceita UUID** — ver §4 |
| `GET /admin` | ✅ | 4 responsáveis |

**8 de 9 exercitados.** O `PUT /budget/{id}` não foi chamado de propósito: a Fase 1 decidiu que alterar status de orçamento não é ferramenta do agente.

---

## 2. Formato das respostas: quatro envelopes diferentes

Esta é a divergência mais cara da integração. A API não tem um envelope único:

| Endpoint | Envelope |
|---|---|
| `GET /product` | `{ data: [...], pagination: {...} }` |
| `GET /product/{id}` | `{ data: {...} }` |
| `GET /order` | `{ data: { items: [...], pagination: {...} } }` |
| `POST /budget` | `{ resource: {...} }` |

Normalizado em `src/integrations/brindeme/mappers.ts` (`unwrapCollection` / `unwrapResource`).

### Divergências de tipo

| Campo | Spec / mock Fase 1 | API real |
|---|---|---|
| `prices[]` | `min` / `max` | `init_quantity` / `final_quantity` |
| `subproduct.color` | string | objeto `{ id, name }` |
| `images[]` | `url` | `image_url.original` (aninhado) |
| `code` | string | inteiro |
| `status_id` | número | UUID |
| Status do orçamento | `status_id` + `status_name` planos | objeto `status: { id, name }` |
| Cliente do orçamento | campos planos | objeto `customer: { ... }` |
| Paginação | topo da resposta | dentro de `pagination` |

**O orçamento e o pedido têm shapes diferentes entre si** — o pedido é plano, o orçamento é aninhado.

---

## 3. Unidade monetária: **centavos** (confirmado)

Valores inteiros representam centavos:

- `price: 377` na Caneta Ecológica Kraft → **R$ 3,77**
- `subtotal: 112650` em pedido corporativo → **R$ 1.126,50**
- `POST /budget` de 20 unidades retornou itens somando **R$ 78,60**

Convertido em `money()`; desligável por `BRINDEME_PRECO_EM_CENTAVOS=false` caso a loja contradiga.

⚠️ Os itens de orçamento também trazem **`cost`** — o custo interno da loja. **Nunca é mapeado** e há teste garantindo que não vaza.

---

## 4. Busca de pedido: só por UUID

`GET /order/{id}` aceita **apenas o UUID interno**. Testado com o código (`2`): **404**.

`GET /order` filtra só por `admin_id`, `admin_email`, `start_date`, `end_date` — não há busca por código, telefone ou e-mail.

**Resolvido** com o job de sincronização (`npm run sync:pedidos`), que grava um índice local com id, código, telefone, e-mail, status e data — nada mais. Validado ponta a ponta: o cliente informa o código `2`, o sistema localiza, confere o telefone e só então busca o pedido completo.

**Vale perguntar à Brinde.me se dá para criar filtro por código ou telefone** — eliminaria o job inteiro.

---

## 5. Erro 412: **validação de parâmetro de query**

A spec não descreve o 412 e ele aparece em todos os endpoints. Sondagem resolveu:

| Requisição | Resposta |
|---|---|
| `?per_page=abc` | 412 — `{"message":"O campo per page deve ser um número inteiro."}` |
| `?per_page=-1` | 412 |
| `?order_param=inexistente` | 412 — `{"message":"O campo order param selecionado é inválido."}` |
| `?order_sort=xyz` | 412 |
| `If-Match` / `If-None-Match` / `If-Unmodified-Since` | 200 — **não é precondição HTTP** |
| `/product/nao-e-uuid` | 404 (não 412) |

**412 é bug do nosso lado**, não instabilidade da loja. A mensagem já vem em português. Tratado como `parametro_invalido`: alerta + transferência, nunca retry.

---

## 6. Status observados

A spec não lista os valores. Estes vieram dos dados reais e estão em `src/knowledge/statusMap.ts`:

**Orçamento:** `Aguardando orçamento`, `Pendente de aprovação`, `Orçamento aprovado`
**Pedido:** `Aprovado`

⚠️ **Esta lista está incompleta** — é só o que existia nos dados da janela consultada. Status desconhecido cai num fallback neutro que sugere atendente, em vez de o modelo inventar o significado. **A loja precisa fornecer a lista completa com a frase aprovada de cada um.**

---

## 7. Limites observados

- `per_page` máximo: **100** (`per_page=500` devolve lista vazia)
- Paginação por `?page=N` (não documentado na spec; visto em `pagination.next_page_url`)
- **Não existe busca por texto em `/product`** — testados `search`, `q`, `name`, `filter`, `term`: o total continua 6535
- `GET /product` **não traz** `subproducts`, `min_quantity`, `images`, `categories` nem `customizations` — só `GET /product/{id}`
- Nenhum limite de requisições (rate limit) observado; não testado sob carga

---

## 8. Lacunas da spec encontradas

| Lacuna | Situação |
|---|---|
| Schemas de cliente e empresa vazios | Resolvido por observação; ver fixtures em `tests/fixtures/` |
| `prices` tipado como `string` | É array de objetos |
| `images`, `categories`, `customizations`, `nfs`, `bankslips` tipados como `string` | São arrays |
| Paginação tipada como `string` | Vem como número (o mapper aceita os dois) |
| `?page` não documentado | Existe e funciona |
| `utm_content` existe no request de orçamento | Não estava em `CreateBudgetBody` |

---

## 9. Idempotência: **não existe** (testado)

Duas chamadas a `POST /budget` com o **mesmo** `Idempotency-Key` criaram os orçamentos **26 e 27**. A API ignora o header.

Consequências:
- `createBudget` **nunca** faz retry — um retry duplicaria de fato
- A guarda `state.orcamentoTokens` (token → código) é a **única** proteção contra duplicata
- Essa guarda vive na memória da conversa: se o processo reiniciar entre o POST e a resposta, a duplicata volta a ser possível. **Persistir o estado é requisito da Fase 4/5.**

## 10. Orçamento PJ: `cnpj` e `trade_name` são aceitos

A spec não lista esses campos, mas a API os recebe — e **valida o CNPJ**:

| Envio | Resposta |
|---|---|
| `cnpj: "00.000.000/0001-00"` | **422** — `{"message":"CNPJ inválido","errors":{"cnpj":["CNPJ inválido"]}}` |
| `cnpj: "11.222.333/0001-81"` (DV válido) | **201** — orçamento 25 criado |

`trade_name` é aceito sem erro.

## 11. Pendente — depende da loja ou da Brinde.me

- [ ] **Excluir os orçamentos de teste: códigos 24, 25, 26 e 27** (`origin=agente-ia-teste`)
- [ ] Existe tenant de testes? Hoje todo `POST /budget` cria registro real.
- [ ] Lista completa de status, com a frase aprovada de cada um
- [ ] Pedir à Brinde.me **suporte a `Idempotency-Key`** — hoje duplicata só é evitada do nosso lado
- [ ] Filtro de pedido por código ou telefone: existe ou pode ser criado?
- [ ] Webhooks de mudança de status: existem? (hoje seria polling)
- [ ] Rate limit da API
