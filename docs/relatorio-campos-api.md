# Mapa de campos — API Presentes Especiais ↔ agente

**Pedido do Luis na reunião de 13/10.** Complementa `docs/relatorio-validacao-api.md` (Fase 2), que cobre endpoints, formatos de resposta, centavos, erro 412 e idempotência, mas não desce ao nível de campo.

A pergunta que este documento responde: **de cada campo que a API devolve, até onde ele vai?** Três paradas possíveis:

| Parada | O que significa |
|---|---|
| **Fica no código** | É lido, usado numa decisão ou guardado, mas nunca entra no prompt do modelo |
| **Chega ao modelo** | Entra no `tool_result` que o LLM lê — e portanto pode ser repetido ao cliente |
| **Chega ao cliente** | O agente tende a dizer no WhatsApp (o modelo decide o texto; aqui vale o que é dado a ele) |

Regra geral: **nada chega ao cliente sem passar pelo modelo**, e o modelo só vê o que a ferramenta devolve. As ferramentas filtram na saída — não é o prompt que segura.

Fontes: `src/integrations/brindeme/{types,mappers,httpClient}.ts`, `src/tools/*.ts`, `src/catalogo/*.ts`, `src/logging/logger.ts`. Conferido contra respostas reais (somente GET) em 15/10/2026.

---

## 1. `GET /product` — listagem do catálogo

Usado só pelo job `sync:catalogo`. **O agente nunca chama este endpoint em conversa.**

| Campo da API | Lido/enviado | Campo nosso | Chega ao modelo? | Chega ao cliente? | Observação |
|---|---|---|---|---|---|
| `id` | lido | `Product.id` | sim | não | chave para `GET /product/{id}` |
| `slug` | lido | `Product.slug` | não | não | |
| `code` (int) | lido | `Product.code` (string) | não | não | convertido para string |
| `name` | lido | `Product.name` | sim | **sim** | |
| `description` | lido | `Product.description` | parcial | não | usado na busca textual |
| `tech_description` | lido | `Product.tech_description` | não | não | HTML da plataforma |
| `status` | lido | `Product.status` | não | não | inativo é descartado |
| `sku` | lido | `Product.sku` | sim | **sim** | |
| `tag` | **ignorado** | — | não | não | |
| `image` | lido | `images[0].url` | sim | **sim** | `image_url.original` |
| `featured` | lido | `Product.featured` | não | não | peso na ordenação |
| `recent` | **ignorado** | — | não | não | |
| `stock` | lido | `Product.stock` | não | não | total; o que vale é por subproduto |
| `price` (centavos) | lido | `Product.price` (reais) | não | não | preço de referência |
| `created_at` | **ignorado** | — | não | não | |
| `updated_at` | lido | índice | não | não | decide releitura no sync |

⚠️ A listagem **não traz** `subproducts`, `min_quantity`, `images`, `categories` nem `customizations`. Só `GET /product/{id}`.

---

## 2. `GET /product/{id}` — detalhe

Fonte de preço, estoque, cor e imagem. Usado por `detalhar_produto` e pela reconferência antes de cotar.

| Campo da API | Lido/enviado | Campo nosso | Chega ao modelo? | Chega ao cliente? | Observação |
|---|---|---|---|---|---|
| `id` | lido | `Product.id` | sim | não | |
| `name` | lido | `Product.name` | sim | **sim** | |
| `description` | lido | `Product.description` | sim | **sim** | |
| `sku` | lido | `Product.sku` | sim | **sim** | |
| `min_quantity` | lido | `Product.min_quantity` | sim | **sim** | regra rígida de cotação |
| `price` (centavos) | lido | `Product.price` (reais) | fallback | **sim** | só se não houver faixa |
| `images[].image_url.original` | lido | `images[].url` | sim | **sim** | demais tamanhos descartados |
| `categories[].{id,name}` | lido | `Category` | `name` sim | não | peso na busca |
| `customizations[]` | lido | `"tipo: descrição"` | sim | **sim** | |
| `subproducts[].id` | lido | `Subproduct.id` | sim | não | vira `subproduct_id` no orçamento |
| `subproducts[].sku` | lido | `Subproduct.sku` | sim | **sim** | |
| `subproducts[].color` (objeto) | lido | `Subproduct.color` (string) | sim | **sim** | só `color.name` |
| `subproducts[].color_id` | **ignorado** | — | não | não | |
| `subproducts[].product_image_id` | **ignorado** | — | não | não | |
| `subproducts[].status` | lido | `Subproduct.status` | não | não | inativo descartado |
| `subproducts[].stock` | lido | `Subproduct.stock` | sim | **sim** | |
| `subproducts[].prices[]` | lido | `PriceRange{min,max,price}` | sim | **sim** | `init_quantity`/`final_quantity` → `min`/`max`; centavos → reais |
| `subproducts[].image` | **ignorado** | — | não | não | usa a do produto |

---

## 3. `POST /budget` — o corpo que montamos

Único **envio** de dados do agente para a loja. Montado em `preparar_orcamento`, enviado por `criar_orcamento` só após confirmação explícita do cliente.

| Campo enviado | Origem | Observação |
|---|---|---|
| `type` | coletado na conversa | `PF` ou `PJ` |
| `customer_name` | coletado na conversa | |
| `customer_phone` | coletado na conversa | ⚠️ vem do argumento do modelo, não de `state.telefone` |
| `customer_email` | coletado na conversa | validado como e-mail |
| `items[].subproduct_id` | de `detalhar_produto` | |
| `items[].quantity` | coletado na conversa | ≥ `min_quantity` |
| `comments` | observações + refs de arte | **máx. 500 caracteres** |
| `origin` | fixo `"whatsapp-agente-ia"` | identifica o que veio do agente |
| `admin_id` | **não enviado hoje** | sem regra de atribuição definida |
| `utm_*` | **não enviados** | |
| `cnpj`, `trade_name` | **não enviados** | aceitos pela API e validados (CNPJ inválido → 422); PJ hoje vai sem eles |

**Nada de CPF.** O agente nunca coleta nem envia CPF.

Com `ORCAMENTO_ESCRITA=simulada` (padrão) nenhum POST sai: `EscritaSimuladaClient` devolve um orçamento `TESTE-…`.

---

## 4. `GET /budget/{id}` — consulta de orçamento

Só orçamentos criados na própria conversa, e **só pelo UUID** guardado na criação — o código dá 404.

| Campo da API | Lido/enviado | Campo nosso | Chega ao modelo? | Chega ao cliente? | Observação |
|---|---|---|---|---|---|
| `code` | lido | `Budget.code` | sim | **sim** | |
| `status.{id,name}` | lido | `status_id` / `status_name` | sim | via frase | traduzido em `statusMap.ts` |
| `type` | lido | `Budget.type` | não | não | |
| `customer.name` | lido | `customer_name` | não | não | **não é devolvido pela tool** |
| `customer.email` | lido | `customer_email` | **não** | **não** | bloqueado na saída |
| `customer.phone` | lido | `customer_phone` | **não** | **não** | bloqueado na saída |
| `billing_company.*` | lido | `customer_name` (fallback) | não | não | |
| `admin.id` | lido | `admin_id` | não | não | |
| `items[].subproduct.product_name` | lido | `produto` | sim | **sim** | |
| `items[].subproduct.color.name` | lido | `cor` | sim | **sim** | |
| `items[].quantity` | lido | `quantidade` | sim | **sim** | |
| `items[].price` | lido | `unit_price` | sim | **sim** | centavos → reais |
| `items[].total` | lido | `subtotal` | sim | **sim** | |
| **`items[].cost`** | **nunca mapeado** | — | **não** | **não** | 🔒 **custo interno da loja** — teste garante que não vaza |
| `items[].product_mock_image_url` | lido | `mockup_url` | sim | **sim** | imagem do mockup |
| `subtotal` / `total` | lido | `Budget` | não | não | a tool devolve subtotal por item |
| `admin_comments` | **ignorado** | — | não | não | comentário interno |
| `payment_term`, `payment_form` | **ignorados** | — | não | não | |
| `shipping_*` | **ignorados** | — | não | não | |

---

## 5. Busca de pedido — índice local + `GET /order/{id}`

Dois passos, e **a ordem é a proteção**: a API só é chamada depois de validar o cliente.

### 5.1 Índice local (`sync:pedidos`) — o que é guardado em disco

`GET /order` traz o pedido inteiro; o índice guarda **só sete campos**:

| Campo guardado | Origem | Para quê |
|---|---|---|
| `id` | `order.id` | buscar o detalhe depois |
| `codigo` | `order.code` | o que o cliente informa |
| `telefone` | `customer_phone`, só dígitos | validação |
| `email` | `customer_email`, minúsculas | validação |
| `status` | `status_name` | diagnóstico |
| `criado_em` | `created_at` | janela |
| `sincronizado_em` | gerado | idade do registro |

🔒 **Não entram no índice:** CPF, endereço, boletos, notas fiscais, itens, valores, dados da empresa. `data/` está no `.gitignore`.

`localizarPedido` devolve **só** `{ encontrado, id, validado }` — nenhum dado do pedido antes da validação passar.

### 5.2 `GET /order/{id}` — depois de validado

| Campo da API | Chega ao modelo? | Chega ao cliente? | Observação |
|---|---|---|---|
| `code` | sim | **sim** | |
| `status_name` | sim | via frase | traduzido; desconhecido vira frase neutra + atendente |
| `shipping_type` | sim | **sim** | |
| `shipping_time` | sim | **sim** | pode vir `null` |
| **`customer_cpf`** | **não** | **não** | 🔒 bloqueado |
| **`customer_email`** | **não** | **não** | 🔒 bloqueado |
| **`customer_phone`** | **não** | **não** | 🔒 usado só na validação |
| **`customer_name`** | **não** | **não** | 🔒 |
| **`nfs[]`** | **não** | **não** | 🔒 notas fiscais |
| **`bankslips[]`** | **não** | **não** | 🔒 boletos |
| **`file_url`** | **não** | **não** | 🔒 arquivo de arte |
| `subtotal`, `total` | **não** | **não** | valor não é devolvido na consulta de pedido |
| `items[]` | **não** | **não** | |
| `billing_company_*`, `customer_company_*` | **não** | **não** | 🔒 CNPJ e razão social |
| `admin_*` | **não** | **não** | |
| `payment_term`, `payment_form` | **não** | **não** | pagamento sempre vai para atendente |

A tool devolve exatamente cinco campos: `resultado`, `codigo`, `status`, `status_frase`, `status_conhecido`, `tipo_entrega`, `prazo_entrega`. Há teste que falha se qualquer campo sensível aparecer na saída.

**Limites de segurança:** telefone → e-mail → bloqueio na 2ª falha (com transferência forçada em código), e teto de 5 consultas por conversa contra varredura de códigos.

---

## 6. `GET /admin` — responsáveis

| Campo da API | Campo nosso | Chega ao modelo? | Chega ao cliente? | Observação |
|---|---|---|---|---|
| `id` | `Admin.id` | sim | não | vai no resumo da transferência |
| `name` | `Admin.name` | sim | **sim** | "vou te passar para a Fulana" |
| `email` | `Admin.email` | **não** | **não** | 🔒 lido mas não devolvido |
| `phone` | `Admin.phone` | **não** | **não** | 🔒 lido mas não devolvido |

O resumo da transferência leva só `{ id, nome }`.

---

## 7. Onde os dados sensíveis param — resumo

| Dado | Para onde | Como |
|---|---|---|
| **CPF** | nunca sai de `GET /order/{id}` | não mapeado na tool; mascarado no log (`***.***.***-XX`) |
| **Boleto / NF** | nunca sai de `GET /order/{id}` | não mapeado |
| **Custo da loja (`cost`)** | nunca sai de `GET /budget/{id}` | não mapeado; teste dedicado |
| **E-mail do cliente** | só na validação de pedido | mascarado no log (`j***@dominio`) |
| **Telefone** | usado na validação e no envio | mascarado no log e no resumo da transferência |
| **CNPJ / razão social** | nunca sai da consulta de pedido | não mapeado |
| **Chave da API** | só no `.env` e no header | nunca em log: a URL vai sem valores de query e nenhum header é gravado |

Log de conversa (`logs/<id>.jsonl`): CPF, e-mail e telefone mascarados por `maskSensitive`.
Log de API (`logs/api.jsonl`): método, caminho sem valores, status, duração, tentativa. **Sem corpo e sem header.**

---

## 8. Contrato ponte ↔ agente

De `src/contrato/esquemas.ts`. Tudo em `127.0.0.1`; não sai da máquina.

### `POST /api/mensagens`

| Campo | Tipo | Observação |
|---|---|---|
| `turnoId` | 16 hex | derivado do lote; repetir o mesmo id devolve a resposta guardada |
| `telefone` | 10–15 dígitos, com DDI | só dígitos |
| `mensagens[].id` | string | id do WhatsApp, para deduplicar |
| `mensagens[].timestamp` | ISO | |
| `mensagens[].texto` | máx. 4.000 | |
| `mensagens[].arquivo` | `{caminho, mime, bytes, nome}` | arquivo já gravado em disco pela ponte |

**Resposta:** `{ respostas: string[], avisoAtendente?: string, modo: "ia" \| "humano" }`

Até 10 mensagens por lote. O conteúdo do arquivo **não** trafega — só o caminho local.

### `POST /api/eventos`

| Evento | Campos |
|---|---|
| `mensagem_atendente` | `telefone`, `id`, `texto`, `timestamp` |
| `devolver` | `telefone`, `nota?` (máx. 500) |

**Resposta:** `{ modo }`.

---

## 9. Pontos de atenção

1. **`customer_phone` do orçamento vem do modelo**, não de `state.telefone`. Um cliente que dite outro número consegue abrir orçamento com ele. Vale amarrar ao telefone da conversa.
2. **PJ vai sem `cnpj` e `trade_name`**, embora a API aceite e valide. Hoje um orçamento PJ fica sem identificação da empresa.
3. **`admin_id` nunca é enviado** — sem regra de atribuição, o orçamento cai no responsável padrão da loja.
4. **`comments` tem teto de 500 caracteres** e é por onde vão as referências de arte. Com muitas artes, pode truncar.
5. **A lista de status está incompleta** — 4 mapeados; o resto cai em frase neutra que sugere atendente.
