# Manual de operação do piloto

Para quem liga, acompanha e atende junto com o agente. Cada seção responde a uma pergunta do dia a dia.

---

## 1. Como o agente funciona (em uma figura)

```
Cliente no WhatsApp ──► chip da loja ──► PONTE (whatsapp-web.js) ──HTTP 127.0.0.1──► AGENTE ──► OpenAI
                                            │                                          │
                         "Mensagem para mim" (avisos e comandos)          API da loja (catálogo, pedidos, orçamentos)
```

- **Agente** (`src/api`): decide a resposta, chama as ferramentas e guarda a conversa em `data/conversas/<telefone>.json`.
- **Ponte** (`src/whatsapp`): recebe e envia no WhatsApp, junta mensagens seguidas num lote só e lê os comandos `#…`.
- **"Mensagem para mim"** (a conversa do chip consigo mesmo) é o **painel do supervisor**: lá chegam as transferências e os avisos, e de lá saem os comandos.
- O que o agente **nunca** faz sozinho: dar desconto, confirmar pagamento, prometer prazo fora da base aprovada, mostrar pedido sem validar o telefone ou o e-mail, criar orçamento sem o "pode criar" do cliente.

---

## 2. Antes de ligar (uma vez, e a cada mudança de configuração)

```bash
npm ci
```
```bash
npm run verificar:env -- --producao
```
O piloto **não liga** com `ERRO`. Leia cada `AVISO` e decida conscientemente.

```bash
npm run check:api
```
```bash
npm run sync:catalogo
```
A primeira carga leva cerca de 3,6 h (6.527 produtos a 30 req/min). Depois disso, o próprio agente ressincroniza a cada 6 h.

```bash
npm run kb:validar
```
Mostra quantos itens da base estão aprovados. Com zero, toda dúvida geral vai para uma pessoa (issue #13).

Configuração de referência: [relatorio-homologacao.md §8](relatorio-homologacao.md#8-configuração-de-referência-do-piloto).

---

## 3. Ligar e desligar

**Ligar** (agente e ponte juntos; o agente é religado sozinho se cair):
```bash
npm run whatsapp
```
Na primeira vez aparece o QR code (ou o código de 8 dígitos, se `WHATSAPP_PAREAR_TELEFONE` estiver preenchido). Pareie com o chip em *Aparelhos conectados*. A sessão fica em `data/whatsapp-sessao/`.

**Desligar:** `Ctrl+C` no terminal. As conversas, a fila e os avisos pendentes ficam em disco e continuam de onde pararam.

**Pausar sem desligar** (por exemplo, para manutenção da loja): `#suspender motivo` no chip. Ver §5.

---

## 4. Rotina do supervisor

| Quando | O quê |
|---|---|
| Ao abrir | `#status` em "Mensagem para mim": o agente está ativo? Alguma ferramenta desligada? |
| Durante o dia | Acompanhar "Mensagem para mim": cada 🔔 **Transferência** é um cliente esperando uma pessoa. |
| Ao fechar | `npm run relatorio:piloto -- --desde <data de hoje>` e anotar os números (§8). |
| Semanal | `npm run kb:lacunas`: perguntas sem resposta na base, para a loja aprovar. |
| Mensal (após a decisão da issue #4) | `npm run limpar:dados` (simulação) → conferir → `npm run limpar:dados -- --executar` com o agente parado. |

---

## 5. Comandos do chip

Digite em **"Mensagem para mim"** (a conversa do chip consigo mesmo). Só valem mensagens enviadas pelo próprio chip.

| Comando | O que faz |
|---|---|
| `#devolver 5583999990000 [nota]` | Devolve a conversa à IA. A nota entra no contexto (ex.: "cliente já pagou o boleto"). Telefone só com dígitos e DDI. |
| `#suspender [motivo]` | Pausa a IA para **todos** os clientes em até 30 s. Quem escrever recebe uma vez o aviso "fora do ar", e você recebe um aviso com a mensagem dele. |
| `#retomar` | Religa a IA. |
| `#desligar <ferramenta>` | Desliga uma ferramenta sem reiniciar. Quando o cliente precisar dela, vai para uma pessoa. Nome errado é recusado. |
| `#religar <ferramenta>` | Religa a ferramenta. |
| `#status` | Mostra se a IA está suspensa e quais ferramentas estão desligadas pelo chip. |
| `#ajuda` (ou qualquer `#` desconhecido) | Lista os comandos. |

Ferramentas: `consultar_conhecimento`, `buscar_produtos`, `detalhar_produto`, `preparar_orcamento`, `consultar_pedido`, `registrar_arte`, `transferir_humano`.

> `FERRAMENTAS_DESLIGADAS` no `.env` também desliga, mas só muda com o restart do agente, e o `#status` não a mostra.

---

## 6. Atendendo uma transferência

1. Chega em "Mensagem para mim":
   ```
   🔔 Transferência — prioridade ALTA
   Cliente: Empresa X · PJ · 5583999990000
   Motivo: reclamacao — caneca chegou quebrada
   Produtos: prod-001
   Últimas mensagens: …
   Para devolver: #devolver 5583999990000 [nota]
   ```
2. Abra a conversa do cliente no chip e **responda normalmente**. A partir da sua primeira mensagem a IA fica calada nessa conversa. Se a IA estava no meio de uma resposta, ela é descartada.
3. Terminou e o cliente pode voltar a falar com a IA? Mande `#devolver <telefone> <nota curta>` em "Mensagem para mim". Chega a confirmação ✅.
4. Se você escreveu `#devolver` **dentro da conversa do cliente**, ele também recebeu esse texto. Funciona, mas evite.

**Motivos e o que fazer:**

| Motivo | Normalmente é |
|---|---|
| `pedido_cliente` | O cliente pediu uma pessoa |
| `reclamacao` | Prioridade ALTA: responder primeiro |
| `desconto`, `pagamento`, `frete_prazo` | Assunto que a IA não decide por regra |
| `ajuste_mockup`, `arte_problematica` | Produção |
| `lacuna_conhecimento` | A base não cobre a pergunta (vem com "Pergunta sem resposta: …"). Responda e leve a pergunta para aprovação. |
| `falha_sistema` | A API da loja ou o modelo falhou. Ver §7. |
| `nao_entendido`, `outro` | Ler as últimas mensagens |

---

## 7. Incidentes

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| ⚠️ "O agente não responde há N min" | Agente caído ou travado | Ver o terminal. O lançador religa sozinho; se não religar, `Ctrl+C` e `npm run whatsapp`. Os clientes recebem o aviso de instabilidade. |
| Muitas transferências `falha_sistema` | API da loja lenta, 429 (cota compartilhada) ou fora | `npm run check:api`. Se persistir: `#suspender API da loja instável` e atender pelo chip. |
| Transferência logo na 1ª falha, com alerta no log `acesso_negado` | Chave da loja inválida ou revogada (401/403) | Trocar `BRINDEME_TOKEN`, rodar `verificar:env` e reiniciar. Até lá: `#suspender`. |
| A IA errou um preço ou uma informação | Modelo citou algo que não veio da ferramenta (os testes não pegaram) | Corrigir com o cliente, **guardar o print**, `#desligar` a ferramenta envolvida se o erro se repetir, e abrir issue com o `conversaId` (está no log). |
| Chegou uma ficha de orçamento (motivo `orcamento_para_emitir`) | O cliente confirmou a estimativa | Conferir a ficha no aviso (itens, total estimado, prazo, personalização, e-mail), emitir o orçamento no painel da loja e responder o cliente pelo chip. A IA não cria orçamento: quem emite é a equipe (R5). |
| Cliente abusivo / spam | — | O limite `RESPOSTAS_POR_HORA` transfere sozinho. Se quiser, bloqueie o número no WhatsApp. |
| QR code de novo / "sessão desconectada" | WhatsApp derrubou o aparelho conectado | Parear de novo. As conversas não se perdem. |
| Custo de tokens alto | Volume ou conversas longas | `relatorio:piloto` (linha Tokens). Reduzir `RESPOSTAS_POR_HORA` ou `WHATSAPP_LIBERADOS`. |
| Qualquer coisa grave e sem diagnóstico | — | **`#suspender`** primeiro, diagnosticar depois. Retomar com `#retomar`. |

**Rollback de versão:** `Ctrl+C`, `git checkout <commit anterior>`, `npm ci`, `npm run verificar:env -- --producao`, `npm run whatsapp`. O formato de `data/` é compatível para trás desde a Fase 4.

---

## 8. Números do piloto

```bash
npm run relatorio:piloto -- --desde 2026-10-20 --saida docs/fase-6/piloto-semana-1.md
```

| Indicador | Por que olhar | Sinal de atenção |
|---|---|---|
| Conversas transferidas (%) | Quanto a IA resolve sozinha | Subindo sem motivo claro; muito alto com a base vazia é esperado (#13) |
| Transferências por motivo | Onde a IA não dá conta | `falha_sistema` alto = API ou modelo instável |
| Orçamentos criados | Resultado comercial | Comparar com os orçamentos abertos à mão |
| Erros de ferramenta | Saúde da integração | `parametros_invalidos` frequente = o modelo está errando parâmetros |
| Alertas | Problemas que exigem ação | Qualquer `acesso_negado` ou `teto_do_turno` |
| Perguntas sem resposta | O que a loja precisa aprovar na base | Levar para o responsável de cada categoria |

> Os logs ficam em `logs/` e já saem mascarados (CPF, e-mail, telefone). `npm test` também grava logs ali: não rode testes na máquina do piloto, ou use sempre `--desde`.

---

## 9. Dados e LGPD

| Onde | O quê |
|---|---|
| `data/conversas/<telefone>.json` | Histórico, dados do cliente, orçamentos da conversa |
| `data/artes/<telefone>/` | Artes enviadas |
| `logs/<conversaId>.jsonl` | Log de cada turno (mascarado) |
| `data/lacunas.jsonl` | Perguntas sem resposta (mascaradas) |
| `data/ponte-estado.json` | Modo (IA/humano) de cada telefone e partes de resposta pendentes |
| `data/orcamentos-teste.json` | Orçamentos TESTE da escrita simulada, que saiu em 25/10 (R5). Só existe em máquina que rodou antes disso; `limpar:dados` ainda o limpa |
| `data/estado-sistema.json` | Suspensão e ferramentas desligadas |

- **Nunca** versionar `.env` nem `data/` (já estão no `.gitignore`).
- Retenção (issue #4): `npm run limpar:dados -- --dias <prazo>` lista o que passou do prazo: conversas, artes, logs e, dentro de `orcamentos-teste.json`, `lacunas.jsonl` e `ponte-estado.json`, os registros desses clientes. Com `--executar`, apaga **de vez**. Rode com o agente e a ponte parados. **O prazo é decisão da loja**: registre aqui quando for decidido: `RETENCAO_DIAS = ____ (decidido por ____ em __/__/____)`.
- O cliente pediu para apagar os dados dele? Pare o agente e a ponte, rode `npm run limpar:dados -- --telefone <telefone>` para conferir o que sai e repita com `--executar`. Sai tudo dele: conversa, artes, logs, orçamentos TESTE, lacunas e o estado na ponte.

---

## 10. Responsáveis

| Papel | Quem | Faz |
|---|---|---|
| Dono do piloto | Luis | Decide #13 (base) e #4 (retenção), aprova a entrada e a saída do piloto |
| Dev de plantão | ____ | Liga/desliga, incidentes, `verificar:env`, relatório |
| Supervisor do chip | ____ | "Mensagem para mim", transferências, comandos `#` |
| Aprovadores da base | Comercial, Produção, Logística, Financeiro, Gerência | Aprovam itens em `src/knowledge/base/*.json` (ver `docs/base-de-conhecimento.md`) |
