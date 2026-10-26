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

### Tipos

**Tipo na API** é o que veio no JSON das respostas reais (`tests/fixtures/*.json`). **Tipo nosso** é o do TypeScript depois do mapper (`src/integrations/brindeme/types.ts`).

| Tipo | Significado |
|---|---|
| `string` | texto |
| `string (UUID)` | identificador, ex.: `dfa3d674-9202-…` |
| `string (ISO 8601)` | data e hora, ex.: `2026-10-10T04:17:16.000000Z` |
| `string (URL)` | endereço de imagem ou arquivo |
| `int` | número inteiro |
| `int (centavos)` | dinheiro na API: `377` = R$ 3,77 |
| `double (reais)` | dinheiro do nosso lado, depois de `money()`: `3.77` |
| `boolean` | `true` / `false` |
| `objeto {…}` | JSON aninhado; entre chaves, os campos que importam |
| `array<…>` | lista, com o tipo do item |
| `… \| null` | pode vir `null` |
| `null (sem amostra)` | só veio `null` nas respostas reais; o tipo de verdade não foi visto |

Do nosso lado, `int` e `double` são `number` no TypeScript. A diferença está no valor: quantidade e estoque são inteiros, e dinheiro tem centavos. A API às vezes manda número como string, e `num()` (`mappers.ts:43`) aceita os dois.

---

## 1. `GET /product` — listagem do catálogo

Usado só pelo job `sync:catalogo`. **O agente nunca chama este endpoint em conversa.**

| Campo da API | Tipo na API | Lido/enviado | Campo nosso | Tipo nosso | Chega ao modelo? | Chega ao cliente? | Observação |
|---|---|---|---|---|---|---|---|
| `id` | `string (UUID)` | lido | `Product.id` | `string (UUID)` | sim | não | chave para `GET /product/{id}` |
| `slug` | `string` | lido | `Product.slug` | `string` | não | não | |
| `code` | `int` | lido | `Product.code` | `string` | não | não | convertido para string |
| `name` | `string` | lido | `Product.name` | `string` | sim | **sim** | |
| `description` | `string` | lido | `Product.description` | `string` | parcial | não | usado na busca textual |
| `tech_description` | `string` (HTML) | lido | `Product.tech_description` | `string` | não | não | HTML da plataforma |
| `status` | `boolean` | lido | `Product.status` | `boolean` | não | não | inativo é descartado |
| `sku` | `string` | lido | `Product.sku` | `string` | sim | **sim** | |
| `tag` | `null (sem amostra)` | **ignorado** | — | — | não | não | |
| `image` | `objeto {image_url: {original, small, thumbnail, medium, large: string (URL)}}` | lido | `images[0].url` | `string (URL)` | sim | **sim** | `image_url.original` |
| `featured` | `boolean` | lido | `Product.featured` | `boolean` | não | não | peso na ordenação |
| `recent` | `boolean` | **ignorado** | — | — | não | não | |
| `stock` | `int` | lido | `Product.stock` | `int` | não | não | total; o que vale é por subproduto |
| `price` | `int (centavos)` | lido | `Product.price` | `double (reais)` | não | não | preço de referência |
| `created_at` | `string (ISO 8601)` | **ignorado** | — | — | não | não | |
| `updated_at` | `string (ISO 8601)` | lido | índice | `string (ISO 8601)` | não | não | decide releitura no sync |

⚠️ A listagem **não traz** `subproducts`, `min_quantity`, `images`, `categories` nem `customizations`. Só `GET /product/{id}`.

---

## 2. `GET /product/{id}` — detalhe

Fonte de preço, estoque, cor e imagem. Usado por `detalhar_produto` e pela reconferência antes de cotar.

| Campo da API | Tipo na API | Lido/enviado | Campo nosso | Tipo nosso | Chega ao modelo? | Chega ao cliente? | Observação |
|---|---|---|---|---|---|---|---|
| `id` | `string (UUID)` | lido | `Product.id` | `string (UUID)` | sim | não | |
| `name` | `string` | lido | `Product.name` | `string` | sim | **sim** | |
| `description` | `string` | lido | `Product.description` | `string` | sim | **sim** | |
| `sku` | `string` | lido | `Product.sku` | `string` | sim | **sim** | |
| `min_quantity` | `int` | lido | `Product.min_quantity` | `int` | sim | **sim** | regra rígida de cotação |
| `price` | `int (centavos)` | lido | `Product.price` | `double (reais)` | fallback | **sim** | só se não houver faixa |
| `images[].image_url.original` | `string (URL)` | lido | `images[].url` | `string (URL)` | sim | **sim** | demais tamanhos descartados |
| `categories[].{id,name}` | `array<objeto {id: string (UUID), name: string, description: string}>` | lido | `Category` | `objeto {id: string, name: string, description?: string}` | `name` sim | não | peso na busca |
| `customizations[]` | `array` (vazio na amostra) | lido | `"tipo: descrição"` | `string` | sim | **sim** | |
| `subproducts[].id` | `string (UUID)` | lido | `Subproduct.id` | `string (UUID)` | sim | não | vira `subproduct_id` no orçamento |
| `subproducts[].sku` | `string` | lido | `Subproduct.sku` | `string` | sim | **sim** | |
| `subproducts[].color` | `objeto {id: string (UUID), name: string, type: string, sku: string, hexadecimal: null, image_url: objeto}` | lido | `Subproduct.color` | `string` | sim | **sim** | só `color.name` |
| `subproducts[].color_id` | `string (UUID)` | **ignorado** | — | — | não | não | |
| `subproducts[].product_image_id` | `string (UUID)` | **ignorado** | — | — | não | não | |
| `subproducts[].status` | `boolean` | lido | `Subproduct.status` | `boolean` | não | não | inativo descartado |
| `subproducts[].stock` | `int` | lido | `Subproduct.stock` | `int` | sim | **sim** | |
| `subproducts[].prices[]` | `array<objeto {init_quantity: int, final_quantity: int, price: int (centavos)}>` | lido | `PriceRange{min,max,price}` | `objeto {min: int, max: int, price: double (reais)}` | sim | **sim** | `init_quantity`/`final_quantity` → `min`/`max`; centavos → reais |
| `subproducts[].image` | `objeto {image_url: objeto}` | **ignorado** | — | — | não | não | usa a do produto |

**Campos que o `detalhar_produto` calcula** (não vêm da API). Só existem quando o modelo passa `quantidade`; sem ela, ficam `null`:

| Campo calculado | Tipo | De onde vem | Chega ao modelo? | Para quê |
|---|---|---|---|---|
| `subprodutos_ativos[].atende_quantidade` | `boolean \| null` | `subproducts[].stock` ≥ `quantidade` | sim | o modelo não compara estoque de cabeça (conversa de 20/10: leu 112 e disse que não cobria 100) |
| `cores_que_atendem_quantidade` | `array<string> \| null` | cores com `atende_quantidade` | sim | o que o agente diz ao cliente sobre quais cores cobrem o pedido |

---

## 3. `POST /budget` — o corpo que montamos

> **Desde 25/10 (R5) o agente não envia este corpo:** ele estima e transfere a ficha, e quem emite o orçamento é uma pessoa. A seção fica como referência do contrato da API (o método continua no cliente HTTP).

Era o único **envio** de dados do agente para a loja. Montado em `preparar_orcamento`, enviado por `criar_orcamento` só após confirmação explícita do cliente.

| Campo enviado | Tipo enviado | Origem | Observação |
|---|---|---|---|
| `type` | `string` (`"PF"` \| `"PJ"`) | coletado na conversa | |
| `customer_name` | `string` | coletado na conversa | |
| `customer_phone` | `string` | coletado na conversa | ⚠️ vem do argumento do modelo, não de `state.telefone` |
| `customer_email` | `string` | coletado na conversa | validado como e-mail |
| `items[].subproduct_id` | `string (UUID)` | de `detalhar_produto` | |
| `items[].quantity` | `int` | coletado na conversa | ≥ `min_quantity` |
| `comments` | `string` | observações + refs de arte | **máx. 500 caracteres** |
| `origin` | `string` | fixo `"whatsapp-agente-ia"` | identifica o que veio do agente |
| `admin_id` | `string (UUID)` | **não enviado hoje** | sem regra de atribuição definida |
| `utm_*` | `string` | **não enviados** | |
| `cnpj`, `trade_name` | `string` | **não enviados** | aceitos pela API e validados (CNPJ inválido → 422); PJ hoje vai sem eles |

**Nada de CPF.** O agente nunca coleta nem envia CPF.

Com `ORCAMENTO_ESCRITA=simulada` (padrão) nenhum POST sai: `EscritaSimuladaClient` devolve um orçamento `TESTE-…`.

---

## 4. `GET /budget/{id}` — consulta de orçamento

Só orçamentos criados na própria conversa, e **só pelo UUID** guardado na criação — o código dá 404.

| Campo da API | Tipo na API | Lido/enviado | Campo nosso | Tipo nosso | Chega ao modelo? | Chega ao cliente? | Observação |
|---|---|---|---|---|---|---|---|
| `code` | `int` | lido | `Budget.code` | `string` | sim | **sim** | |
| `status.{id,name}` | `objeto {id: string (UUID), name: string, color: string}` | lido | `status_id` / `status_name` | `string (UUID)` / `string` | sim | via frase | traduzido em `statusMap.ts` |
| `type` | `string` (`"PF"` \| `"PJ"`) | lido | `Budget.type` | `"PF" \| "PJ"` | não | não | |
| `customer.name` | `string` | lido | `customer_name` | `string` | não | não | **não é devolvido pela tool** |
| `customer.email` | `string` | lido | `customer_email` | `string` | **não** | **não** | bloqueado na saída |
| `customer.phone` | `string` (com máscara: DDD entre parênteses e hífen) | lido | `customer_phone` | `string` | **não** | **não** | bloqueado na saída |
| `billing_company.*` | `objeto {id: string (UUID), company_name, trade_name, cnpj: string}` | lido | `customer_name` (fallback) | `string` | não | não | |
| `admin.id` | `null (sem amostra)` | lido | `admin_id` | `string \| undefined` | não | não | `admin` veio `null` nas amostras |
| `items[].subproduct.product_name` | `string` | lido | `produto` | `string` | sim | **sim** | nas amostras o nome veio em `subproduct.name`, que é o fallback do mapper |
| `items[].subproduct.color.name` | `string` | lido | `cor` | `string` | sim | **sim** | |
| `items[].quantity` | `int` | lido | `quantidade` | `int` | sim | **sim** | |
| `items[].price` | `int (centavos)` | lido | `unit_price` | `double (reais)` | sim | **sim** | centavos → reais |
| `items[].total` | não veio na amostra | lido se vier | `subtotal` | `double (reais)` | sim | **sim** | sem ele, o mapper calcula `preço × quantidade` |
| **`items[].cost`** | `int (centavos)` | **nunca mapeado** | — | — | **não** | **não** | 🔒 **custo interno da loja** — teste garante que não vaza |
| `items[].product_mock_image_url` | `null (sem amostra)` | lido | `mockup_url` | `string (URL) \| undefined` | sim | **sim** | imagem do mockup |
| `subtotal` / `total` | `int (centavos)` | lido | `Budget` | `double (reais)` | não | não | a tool devolve subtotal por item |
| `admin_comments` | `string` | **ignorado** | — | — | não | não | comentário interno |
| `payment_term`, `payment_form` | `null (sem amostra)` | **ignorados** | — | — | não | não | |
| `shipping_*` | `shipping_fee`: `int (centavos)`; `shipping_consult`: `boolean`; os demais `null (sem amostra)` | **ignorados** | — | — | não | não | |

---

## 5. Busca de pedido — índice local + `GET /order/{id}`

Dois passos, e **a ordem é a proteção**: a API só é chamada depois de validar o cliente.

### 5.1 Índice local (`sync:pedidos`) — o que é guardado em disco

`GET /order` traz o pedido inteiro; o índice guarda **só sete campos**:

| Campo guardado | Tipo guardado | Origem | Para quê |
|---|---|---|---|
| `id` | `string (UUID)` | `order.id` | buscar o detalhe depois |
| `codigo` | `string` | `order.code` (`int` na API) | o que o cliente informa |
| `telefone` | `string` (só dígitos) | `customer_phone`, só dígitos | validação |
| `email` | `string` (minúsculas) | `customer_email`, minúsculas | validação |
| `status` | `string` | `status_name` | diagnóstico |
| `criado_em` | `string (ISO 8601)` | `created_at` | janela |
| `sincronizado_em` | `string (ISO 8601)` | gerado | idade do registro |

🔒 **Não entram no índice:** CPF, endereço, boletos, notas fiscais, itens, valores, dados da empresa. `data/` está no `.gitignore`.

`localizarPedido` devolve **só** `{ encontrado, id, validado }` — nenhum dado do pedido antes da validação passar.

### 5.2 `GET /order/{id}` — depois de validado

| Campo da API | Tipo na API | Tipo nosso (`Order`) | Chega ao modelo? | Chega ao cliente? | Observação |
|---|---|---|---|---|---|
| `code` | `int` | `string` | sim | **sim** | |
| `status_name` | `string` | `string` | sim | via frase | traduzido; desconhecido vira frase neutra + atendente |
| `shipping_type` | `null (sem amostra)` | `string` | sim | **sim** | |
| `shipping_time` | `null (sem amostra)` | `int \| null` | sim | **sim** | pode vir `null` |
| **`customer_cpf`** | `null (sem amostra)` | `string` | **não** | **não** | 🔒 bloqueado |
| **`customer_email`** | `string` | `string` | **não** | **não** | 🔒 bloqueado |
| **`customer_phone`** | `string` | `string` | **não** | **não** | 🔒 usado só na validação |
| **`customer_name`** | `string` | `string` | **não** | **não** | 🔒 |
| **`nfs[]`** | `array` (vazio na amostra) | `array<string>` | **não** | **não** | 🔒 notas fiscais |
| **`bankslips[]`** | `array` (vazio na amostra) | `array<string>` | **não** | **não** | 🔒 boletos |
| **`file_url`** | `string (URL)` | `string (URL) \| undefined` | **não** | **não** | 🔒 arquivo de arte |
| `subtotal`, `total` | `int (centavos)` | `double (reais)` | **não** | **não** | valor não é devolvido na consulta de pedido |
| `items[]` | `array<objeto {product_name, color_name: string, quantity: int, price, total: int (centavos), …}>` | `array<OrderItem>` | **não** | **não** | |
| `billing_company_*`, `customer_company_*` | `string` | — | **não** | **não** | 🔒 CNPJ e razão social |
| `admin_*` | `null (sem amostra)` | — | **não** | **não** | |
| `payment_term`, `payment_form` | `string` | — | **não** | **não** | pagamento sempre vai para atendente |

A tool devolve exatamente cinco campos: `resultado`, `codigo`, `status`, `status_frase`, `status_conhecido`, `tipo_entrega`, `prazo_entrega`. Há teste que falha se qualquer campo sensível aparecer na saída.

**Limites de segurança:** telefone → e-mail → bloqueio na 2ª falha (com transferência forçada em código), e teto de 5 consultas por conversa contra varredura de códigos.

---

## 6. `GET /admin` — responsáveis

| Campo da API | Tipo na API | Campo nosso | Tipo nosso | Chega ao modelo? | Chega ao cliente? | Observação |
|---|---|---|---|---|---|---|
| `id` | `string (UUID)` | `Admin.id` | `string (UUID)` | sim | não | vai no resumo da transferência |
| `name` | `string` | `Admin.name` | `string` | sim | **sim** | "vou te passar para a Fulana" |
| `email` | `string` | `Admin.email` | `string` | **não** | **não** | 🔒 lido mas não devolvido |
| `phone` | `string` | `Admin.phone` | `string` | **não** | **não** | 🔒 lido mas não devolvido |

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
