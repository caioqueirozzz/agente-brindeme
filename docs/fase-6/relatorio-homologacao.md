# Fase 6 — Relatório de homologação do piloto

**Data:** 19/10/2026 · **Branch:** `fase-6-homologacao` (sobre `fase-5-infraestrutura`, `7a81d45`)
**Escopo:** validar fluxos completos, recomendações, precisão das informações, segurança e transferência humana; corrigir as falhas; entregar o piloto com documentação e orientação operacional.

---

## 1. Parecer

**Apto para piloto controlado, com quatro condições.** O código passou na homologação automatizada, e as 9 falhas encontradas estão corrigidas e cobertas por teste. Três verificações dependem de recursos que este ambiente não tem: a chave da OpenAI, o chip de WhatsApp e a API real da loja. Elas ficam como **condição de entrada** do piloto (seção 6).

| Condição para ligar o piloto | Como verificar | Responsável |
|---|---|---|
| Evals com o modelo real aprovados no critério de homologação | `npm run evals -- --via-api --rodadas 3 --relatorio docs/fase-6/evals-<data>.json` → `APROVADO` | Dev |
| Roteiro do chip executado sem falha bloqueante | [roteiro-homologacao.md](roteiro-homologacao.md), seção B | Dev + atendente |
| Configuração de produção sem erro | `npm run verificar:env -- --producao` → `0 erro(s)` | Dev |
| Decisão sobre a base de conhecimento (issue #13) | `npm run kb:validar` com itens aprovados, **ou** aceite registrado de piloto com a base vazia | Luis |

---

## 2. O que foi analisado no GitHub

| Item | Situação encontrada |
|---|---|
| `main` | Ainda está na **Fase 1** (`5f99850`). As Fases 2 a 5 estão empilhadas em branches, sem merge. |
| PR #1 (Fase 2), PR #3 (Fase 3) | Abertos. |
| PR #14 (Fase 4, WhatsApp) | **Rascunho**: falta o teste no chip. |
| `fase-5-infraestrutura` | Entregou só **C1 + C2** (kill switch, ferramentas desligáveis). **C3** (alertas), **C4** (métricas ao vivo) e **C5** (verificação de segredos e retenção) **não foram feitos**. |
| Issue #13 | Aberta: a base de conhecimento não tem nenhum item aprovado, então toda dúvida de processo vai para um atendente. |
| Issue #4 | Aberta: nada é apagado (LGPD). O prazo de retenção não foi decidido. |
| Testes na entrada da Fase 6 | 707 passando, typecheck limpo. |

**O que a Fase 6 entregou das pendências da Fase 5:** a C5 (`verificar:env` e `limpar:dados`) e um `relatorio:piloto`, que cobre a C4 lendo os logs depois do expediente, não ao vivo. A C3 (alertas proativos no chip) continua pendente: ver seção 7.

---

## 3. Método

1. **Suíte de homologação automatizada** (`tests/homologacao/`, `npm run test:homologacao`). A conversa passa pelo `AgenteDefinitivo`, o mesmo objeto que atende em produção, com as ferramentas, o repositório em disco e a API de mock reais. **Só o modelo é roteirizado**, para que cada caminho seja exercitado de forma determinística, inclusive quando o modelo erra (ignora uma instrução, inventa parâmetro, tenta criar sem confirmação).
2. **Oráculo de precisão.** Foi escrito do zero a partir das regras de negócio e lê `mocks/products.json` direto. Ele confere preço, mínimo, estoque e cor de **todo o catálogo** em cada fronteira de faixa de quantidade: mínimo − 1, mínimo, início e fim de cada faixa.
3. **Revisão de código** dos caminhos de segurança: entrada das ferramentas, confirmação de orçamento, validação de pedido, kill switch e comandos do chip.
4. **Prova de que os testes pegam as falhas.** A suíte foi rodada contra o código da Fase 5, sem as correções: **8 testes falham**. Com as correções, todos passam.
5. **Evals com o modelo real:** foram ampliados (8 cenários novos, 15 marcados como críticos, rodadas repetidas), mas **não foram rodados aqui**, porque não há chave da OpenAI neste ambiente.

---

## 4. Resultado por critério

**Total: 791 testes passando** (eram 707; +84), typecheck limpo.

| Critério | Arquivo | Testes | Resultado |
|---|---|---:|---|
| H1 Fluxos completos | `tests/homologacao/fluxos.test.ts` | 6 | ✅ |
| H2 Recomendação e precisão | `tests/homologacao/recomendacao.test.ts` | 18 | ✅ |
| H3 Segurança | `tests/homologacao/seguranca.test.ts` | 17 | ✅ |
| H4 Transferência humana | `tests/homologacao/transferencia.test.ts` | 11 | ✅ |
| H5 Operação (go-live, retenção, relatório) | `tests/operacao.test.ts` | 11 | ✅ |

### H1 — Fluxos completos
- Jornada inteira: saudação → recomendação → detalhe → resumo → confirmação → orçamento criado. O total confere (50 × R$ 18,90 = R$ 945,00), o telefone vem da conversa e a pendência é consumida.
- A arte enviada pelo WhatsApp entra no orçamento como referência, com o preço da cor certa (preta ≠ branca).
- Pedido do próprio cliente: a resposta traz **só** status, prazo e tipo de entrega.
- Dúvida coberta pela base aprovada é respondida sem transferir.
- Se o agente reinicia entre o resumo e o "pode criar", o orçamento ainda é criado.
- Lote reenviado pela ponte (mesmo `turnoId`) não chama o modelo de novo.

### H2 — Recomendação e precisão
- `buscar_produtos` bate com o oráculo em **todos os produtos × todas as fronteiras de faixa**: menor preço entre as cores, total em centavos exatos, cores ofertadas. Produto inativo, abaixo do mínimo ou sem estoque não é sugerido.
- `detalhar_produto` dá o preço **por cor**.
- `preparar_orcamento` confere o subtotal de cada cor em cada fronteira de faixa e recusa abaixo do mínimo, estoque insuficiente e produto inativo.
- Sem quantidade, nenhum preço é passado. Valor total sem quantidade vira pergunta. Nada é sugerido acima do teto do cliente, e são no máximo 3 sugestões.

### H3 — Segurança
- Pedido de outro telefone: pede o e-mail; com o e-mail errado duas vezes, bloqueia e transfere, **mesmo que o modelo não transfira**. Nenhum dado do dono (e-mail, telefone, CPF, boleto, NF) chega ao modelo.
- Varredura de códigos: a 6ª consulta da conversa é bloqueada.
- Orçamento: não é criado no mesmo turno do resumo (nem na nova tentativa do mesmo lote), não aceita token inventado, a confirmação repetida não cria um segundo orçamento e um telefone inventado pelo modelo é descartado.
- Parâmetro inválido do modelo volta para ele corrigir, sem contar como falha de sistema.
- Rascunho da base nunca é servido: vira lacuna registrada, e a equipe recebe a pergunta.
- Pelo WhatsApp, só é registrada arte que chegou de fato; `.exe` é recusado.
- Logs sem CPF, e-mail ou telefone em claro.
- Kill switch: ferramenta desligada não executa e o cliente vai para uma pessoa; com o agente suspenso, o modelo não é chamado.
- `#desligar` com nome errado não confirma o desligamento. A lista de ferramentas da ponte bate com a do agente.
- O servidor do agente só escuta em `127.0.0.1` (a API interna não tem autenticação).

### H4 — Transferência humana
Todos os caminhos levam a uma pessoa, com o aviso completo em "Mensagem para mim":

| Gatilho | Testado |
|---|---|
| Cliente pede atendente | ✅ modo humano, IA calada, `#devolver` traz a IA de volta com a nota |
| Reclamação | ✅ prioridade ALTA |
| 2 falhas seguidas da API | ✅ transfere sozinho mesmo se o modelo não obedecer |
| Erro que exige ação imediata (412/401/403) | ✅ na 1ª falha |
| Modelo falha 2× no mesmo lote | ✅ aviso de problema técnico; a mensagem não se perde |
| Turno passa do teto de tempo | ✅ |
| Limite de respostas por hora | ✅ |
| Atendente escreve enquanto a IA pensa | ✅ a resposta da IA é descartada |
| API da loja fora do ar no momento da transferência | ✅ transfere mesmo assim |
| Telefone no resumo para a equipe | ✅ mascarado (`5583*****0000`) |

---

## 5. Falhas encontradas e corrigidas

| # | Gravidade | Falha | Correção | Teste |
|---|---|---|---|---|
| 1 | **Alta** | A entrada do modelo ia **sem validação** para as ferramentas (o schema só era enviado à OpenAI). Um parâmetro errado virava exceção, contava como **falha da API** e, na 2ª, **transferia o cliente**. Campo a mais chegava ao handler. | `runTurn` confere a entrada com o schema zod antes do handler. Inválida → `parametros_invalidos` com os detalhes, sem contar falha. Válida → só os campos do schema chegam ao handler. | H3.8 |
| 2 | **Alta** | `criar_orcamento` podia ser chamado **no mesmo turno do resumo**: a confirmação explícita dependia só do prompt. | O resumo guarda a última mensagem do cliente; criar exige uma mensagem **nova** depois dele (`aguardando_confirmacao`). A mensagem é identificada pelo texto, não pela hora: na revisão, o lote do resumo que falhava e era reenviado passava pela guarda. Pendências salvas antes continuam aceitas. | H3.4, H3.4b, `criarOrcamento.test.ts` |
| 3 | Média | "Pode criar" repetido depois de criado devolvia `sem_orcamento_pendente`: o modelo podia preparar e criar **um segundo orçamento**. | A idempotência é conferida antes: devolve `ja_criado` com o mesmo código. | H3.6 |
| 4 | Média | `preparar_orcamento` com quantidade **fora de todas as faixas** usava em silêncio o preço de referência do produto. A recomendação recusa o mesmo caso. | Erro `sem_faixa_de_preco`. O preço de referência só vale para cor sem tabela. | H2.6 |
| 5 | Média | Produto **desativado** na loja com a cor ainda ativa podia ser orçado. | Erro `produto_inativo`. | H2.7, `prepararOrcamento.test.ts` |
| 6 | Média | Com o agente **suspenso**, a mensagem do cliente era descartada, o aviso "fora do ar" saía **a cada mensagem**, e **ninguém da equipe era avisado**, embora o texto prometa que a equipe responde. | A mensagem fica no histórico; o aviso sai uma vez por suspensão; a equipe recebe o aviso com a mensagem. Em modo humano, nada de aviso automático. | H3.13, `killswitch.test.ts` |
| 7 | Média | `#desligar criar_orcamentos` (nome errado) **confirmava "desligada"** e nada era bloqueado. | Nome validado contra a lista de ferramentas. Novo comando `#status`. | H3.15 |
| 8 | Baixa | `ESTADO_SISTEMA_ARQUIVO`, documentada no `.env.example`, **era ignorada**. | Lida na chamada; agente e ponte usam o mesmo arquivo. | `estadoSistema.test.ts` |
| 9 | Baixa | Máscara do telefone no resumo de transferência: 6–7 dígitos lançavam `RangeError` (a transferência quebrava) e 8 dígitos saíam em claro. | Menos de 10 dígitos → `***`. | H4.11 |

**Prova:** contra o código da Fase 5, falham H2.5, H2.6, H2.7, H3.4, H3.6, H3.8, H3.13 e H3.15. Com as correções, todos passam.

### Entregas novas
- `npm run test:homologacao`: a suíte acima.
- `npm run verificar:env [-- --producao]`: confere a configuração antes de ligar e sai com 1 se houver erro. Nunca imprime segredo.
- `npm run limpar:dados [-- --dias N] [--executar]`: retenção LGPD. **Por padrão só lista.**
- `npm run relatorio:piloto [-- --desde AAAA-MM-DD] [--saida arq.md]`: números do piloto a partir dos logs.
- `npm run evals -- --rodadas N --relatorio arq.json`: rodadas repetidas, cenários críticos e critério de aprovação.
- 8 cenários de eval novos (19 a 26): injeção de prompt, falso atendente, dado de outro cliente, reclamação, boleto, recomendação com teto total, insistência em "ser humano" e orçamento sem resumo.

---

## 6. O que NÃO foi verificado aqui (e por quê)

| Verificação | Por que não | Como fazer |
|---|---|---|
| Comportamento do **modelo real** (evals) | Sem `OPENAI_API_KEY` neste ambiente | `npm run evals -- --via-api --rodadas 3 --relatorio docs/fase-6/evals-<data>.json` |
| **WhatsApp real** (sessão, mídia, reinício no meio, eco) | Sem o chip | [roteiro-homologacao.md](roteiro-homologacao.md), seção B |
| **API real** da loja (catálogo de 6.527 produtos, cota de 60 req/min) | Sem credencial | `npm run check:api` e `npm run sync:catalogo` (verificado na Fase 4: 6.527/6.527) |
| Orçamento gravado de verdade (`ORCAMENTO_ESCRITA=real`) | Escreve em produção | Um único orçamento de teste, combinado com a loja (roteiro B10) |

A suíte automatizada prova que **o código** faz a coisa certa em cada caminho, inclusive quando o modelo erra. Ela não prova **com que frequência** o modelo real escolhe o caminho certo. Esse é o papel dos evals. Na Fase 4 eles deram 44/3, 41/6 e 41/6, sem nenhum dado inventado.

---

## 7. Riscos e pendências do piloto

| Risco / pendência | Impacto | Mitigação no piloto |
|---|---|---|
| **#13: base sem item aprovado** | Toda dúvida de processo, prazo, entrega ou pagamento vai para uma pessoa | Aprovar ao menos `entrega`, `pagamento` e `prazos` antes, **ou** aceitar e dimensionar a equipe. `npm run kb:lacunas` mostra o que mais é perguntado. |
| **C3: alertas proativos não entregues** | Falha repetida ou 401 da API só aparecem no log e nas transferências | O supervisor acompanha "Mensagem para mim" (cada transferência chega lá), e `relatorio:piloto` roda todo dia (seção "Alertas") |
| **#4: prazo de retenção não decidido** | Dado pessoal guardado sem prazo (LGPD) | `limpar:dados` pronto; falta a loja decidir o prazo e quem roda |
| **Cota da API compartilhada** com outro consumidor | 429 em horário de pico → transferências por `falha_sistema` | Acompanhar no relatório; pedir chave própria para o agente |
| **Orçamentos de teste 24 a 27** (Fase 2) ainda em produção | Sujeira no painel da loja | Pedir à loja para apagar |
| `main` na Fase 1; Fases 2 a 6 em branches empilhadas | Deploy a partir da branch errada | Merge em ordem: #1 → #3 → #14 → Fase 5 → Fase 6 |
| Variância do modelo (cenário 05, orçamento completo, é o mais instável) | Cliente às vezes precisa repetir | O orçamento nunca sai sem confirmação; no pior caso vai para uma pessoa |
| `npm test` grava logs em `logs/` | O relatório mistura conversas de teste | Não rodar testes na máquina do piloto, ou usar `relatorio:piloto -- --desde <início do piloto>` |

---

## 8. Configuração de referência do piloto

Atualizada em 25/10: o agente não escreve orçamento (R5) e o modelo é o `gpt-4o-mini` (decisões 48–50 da [spec](../spec-agente.md#12-decisões)).

```ini
BRINDEME_MODE=http
KB_INCLUIR_RASCUNHOS=false
LLM_MODEL=gpt-4o-mini
LLM_REASONING=                    # vazio: gpt-4* não aceita reasoning_effort (todo turno daria 400)
LLM_API=chat
WHATSAPP_LIBERADOS=<números do piloto>   # piloto controlado: só quem foi convidado
RESPOSTAS_POR_HORA=30
TURNO_TETO_MS=90000
AGENTE_TIMEOUT_MS=120000
RETENCAO_DIAS=<decisão da loja, issue #4>
```

Operação do dia a dia: [manual-operacao.md](manual-operacao.md).
