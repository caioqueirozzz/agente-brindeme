# Teste ao vivo no chip

Passo a passo para subir o agente num chip com WhatsApp Business e rodar os cenários do piloto. Operação do dia a dia (comandos, transferências, incidentes): [manual-operacao.md](manual-operacao.md). Aceite completo: [roteiro-homologacao.md](roteiro-homologacao.md).

---

## 1. Preparar a máquina

```bash
npm ci
cp .env.example .env
```

No `.env`, além do que já vem preenchido:

| Variável | Valor |
|---|---|
| `OPENAI_API_KEY` | chave da OpenAI do projeto |
| `LLM_MODEL` | `gpt-4o-mini` |
| `LLM_REASONING` | **vazio**. O 4o-mini não aceita `reasoning_effort`: com valor, todo turno dá 400 |
| `BRINDEME_MODE` | `http` |
| `BRINDEME_BASE_URL` / `BRINDEME_TOKEN` | da task "Integrar o agente à API da loja" no ClickUp. Nunca no git |
| `WHATSAPP_LIBERADOS` | os números de quem vai testar, só dígitos com DDI, separados por vírgula (ex.: `5583999990000,5583988880000`). **Vazio, o agente responde qualquer pessoa que escrever no chip** |
| `WHATSAPP_PAREAR_TELEFONE` | opcional: o número do chip, só dígitos com DDI, para parear por código de 8 dígitos em vez de QR |

**Catálogo:** copie o `produtos-index.json` recebido para `data/produtos-index.json`. Sem ele, a busca de produtos volta vazia. Se não tiver o arquivo, gere com o agente desligado: `npm run sync:catalogo -- --ritmo 55` (cerca de 2 h; no fim, ele não pode listar produto sem detalhe, senão rode de novo).

Conferir:

```bash
npm run verificar:env -- --producao
npm run check:api
```

`verificar:env` precisa terminar com 0 erros e mostrar o catálogo com 6.527 produtos. O aviso da base de conhecimento (nenhum item aprovado, issue #13) é esperado: toda dúvida de processo, prazo, entrega ou pagamento vai para uma pessoa.

---

## 2. Ligar

```bash
npm run whatsapp
```

No celular do chip: WhatsApp Business → **Aparelhos conectados** → **Conectar um aparelho** → ler o QR do terminal (ou digitar o código de 8 dígitos). A sessão fica em `data/whatsapp-sessao/`; nas próximas vezes não pede de novo.

Mande `#status` em **"Mensagem para mim"** (a conversa do chip consigo mesmo). A resposta mostra se a IA está ativa e se há ferramenta desligada. É ali que chegam as transferências e onde valem os comandos do chip (§5 do manual).

**Desligar:** `Ctrl+C`. Conversas, fila e avisos pendentes ficam em disco.

---

## 3. Cenários

Escreva para o chip de um número que esteja em `WHATSAPP_LIBERADOS`. Para cada cenário, anote **Esperado · Observado · Print · turnoId** (o `turnoId` está em `logs/ponte.jsonl` e em `logs/<conversaId>.jsonl`).

| # | Cenário | Esperado |
|---|---|---|
| 1 | "oi" até o orçamento | estimativa com o aviso de valor de tabela → "pode enviar" → transferência `orcamento_para_emitir`; "Mensagem para mim" recebe a **ficha** (itens, total estimado, prazo, personalização, e-mail); nenhum código de orçamento e nada no painel da loja |
| 2 | três mensagens picadas em menos de 5 s | uma resposta só |
| 3 | arte em imagem, arte em PDF e um vídeo | as duas artes registradas; o vídeo recusado com explicação |
| 4 | áudio | resposta fixa pedindo texto |
| 5 | "qual o horário de vocês?" | transferência; em "Mensagem para mim" aparece "Pergunta sem resposta" |
| 6 | o atendente responde pelo celular → o cliente escreve → `#devolver <número> nota` | a IA fica quieta até o `#devolver`, chega o "✅ devolvido" e a IA volta na mensagem seguinte |
| 7 | `Ctrl+C` no meio de um turno e subir de novo (melhor entre a 1ª e a 2ª parte de uma resposta longa) | nenhuma mensagem perdida, o resumo não se repete e as partes já entregues não chegam de novo |
| 8 | derrubar só o agente por mais de 10 min (`npm run whatsapp:ponte` sozinho; depois `npm run agente`) | o cliente recebe o aviso de instabilidade uma vez e "Mensagem para mim" recebe um alerta; ao religar, a varredura responde o que ficou |
| 9 | API da loja fora (URL inválida no `.env` e reiniciar) | duas falhas → transferência `falha_sistema` com resumo |
| 10 | o atendente responde pelo celular **enquanto** o agente ainda está "digitando" um orçamento | a resposta da IA não chega ao cliente; se a ficha já tinha sido transferida, "Mensagem para mim" recebe o aviso com a ficha |
| 11 | `#devolver` com um número que nunca conversou com o chip | "Mensagem para mim" responde que o agente não tem conversa com esse número |
| 12 | "fechado! me manda a chave Pix que eu já pago o sinal" | transferência `pagamento`; **nenhum** dado bancário, chave Pix ou CNPJ na resposta |

**Entre um cenário e outro, reinicie** (`Ctrl+C` e `npm run whatsapp`) ou use outro número. O agente guarda cada conversa em memória por 30 min: apagar `data/conversas/<telefone>.json` com ele no ar não limpa nada, e o cenário seguinte começa contaminado.

**Riscos conhecidos** (anote se aparecerem, mas não são falha nova; ver §14 da [spec](../spec-agente.md)):
- Pergunta de prazo na 1ª mensagem: ~1 em 18 vezes o agente diz "vou verificar" e pergunta algo, sem consultar a base nem transferir. Não inventa prazo.
- O agente às vezes preenche prazo ou personalização que o cliente não disse ("sem prazo específico"). Aparece no resumo antes da confirmação; confira na ficha.
- "Na cor que tiver": às vezes pergunta a cor em vez de escolher uma com estoque.
- Status de pedido real só foi testado aqui: não há índice de pedidos local.

---

## 4. Falhas

Uma issue por falha, incluindo erro visto fora da tabela:

```bash
gh issue create --repo caioqueirozzz/agente-brindeme \
  --title "[Piloto] <cenário>: <sintoma>" --label dogfooding \
  --body-file <arquivo>.md
```

Corpo: cenário, passos, esperado, observado, `turnoId` e print. **Sem telefone completo, sem credencial e sem dado de cliente real.**

**Pronto:** os 12 cenários passam ou cada falha tem a sua issue.
