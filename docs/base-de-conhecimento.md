# Base de conhecimento e etiquetas de ocasião — guia da equipe

O agente só afirma o que está aqui. Pergunta sem resposta na base vira **lacuna** e o cliente é passado para uma pessoa.

## Onde ficam os textos

`src/knowledge/base/<categoria>.json`, um arquivo por categoria. Quem aprova cada uma:

| Arquivo | Aprova |
|---|---|
| `processo-comercial.json` | Comercial |
| `arte.json` | Produção |
| `prazos.json` | Produção |
| `entrega.json` | Logística |
| `pagamento.json` | Financeiro |
| `trocas-defeitos.json` | Gerência |
| `institucional.json` | Gerência |

## Como é um item

```json
{
  "id": "regioes-e-modalidades-de-entrega",
  "titulo": "Regiões atendidas, modalidades e retirada",
  "conteudo": "Entregamos para todo o Brasil, por Correios (PAC e Sedex)...",
  "palavras_chave": ["entrega", "frete", "correios", "retirada"],
  "perguntas_exemplo": ["Vocês entregam em todo o Brasil?"],
  "status": "aprovado",
  "aprovado_por": "Maria (Logística)",
  "aprovado_em": "2026-10-20",
  "revisar_em": "2027-04-20",
  "nota_interna": "Recado para a equipe; o cliente nunca vê."
}
```

- **Curto**: `conteudo` cabe numa mensagem de WhatsApp (até 700 caracteres). Assunto grande vira vários itens.
- **`palavras_chave`**: as palavras que o cliente usa e o texto não repete ("demora", "pix", "parcelar"). É o que mais melhora a busca.
- **`perguntas_exemplo`**: perguntas reais de clientes que este item responde.
- **`revisar_em`**: quando o texto deve ser revisto.

## Aprovar um item

1. Confira o `conteudo` e preencha qualquer valor entre colchetes (`[PRAZO_PRODUCAO_DIAS_UTEIS]` etc.). **Item com colchetes nunca é servido.**
2. Troque `"status": "rascunho"` por `"aprovado"` e preencha `aprovado_por` e `aprovado_em` (`AAAA-MM-DD`).
3. Rode `npm run kb:validar`. Ele mostra o que falta, por categoria e por responsável, e recusa item aprovado sem aprovador/data ou com valor pendente.

Rascunho **não** chega ao cliente. (Só para desenvolvedores: `KB_INCLUIR_RASCUNHOS=true` no `.env` deixa o chat de teste usar rascunhos sem colchetes.)

## O que mais perguntam e a base não sabe

```bash
npm run kb:lacunas
```

Lista as perguntas sem resposta, da mais frequente para a menos. O que aparece no topo é o próximo item a escrever. Os dados pessoais (telefone, e-mail, CPF) são mascarados antes de gravar.

Quando um cliente recebe resposta da base, o log da conversa guarda o `id` do item usado (`kb_itens`), para auditoria.

## Etiquetas de ocasião

A API da Brinde.me não diz se um produto serve para Natal ou Dia das Mães; quem diz é a loja, em `src/knowledge/etiquetas-ocasiao.json`:

```json
{
  "porCategoria": { "Canecas": ["natal", "corporativo", "dia dos professores"] },
  "porSku":       { "09319": ["sustentabilidade"] },
  "porProduto":   { "dfa3d674-9202-40c1-a60c-48937db9e2be": ["dia das maes"] }
}
```

As três formas se somam. Escreva a ocasião como o cliente falaria; os nomes e variações reconhecidos ficam em `src/knowledge/ocasioes.json` (acrescente uma ocasião nova lá). A mudança vale na conversa seguinte, sem esperar a sincronização do catálogo.

Etiquetar por **categoria** cobre milhares de produtos de uma vez; use `porSku`/`porProduto` para exceções.

## Os 30 pedidos de recomendação

`evals/recomendacao/pedidos.json` traz 30 pedidos de exemplo. Troque por pedidos reais da loja e rode:

```bash
npm run sync:catalogo            # índice atualizado
npm run avaliar:recomendacao     # confere regras e gera a planilha
```

O comando confere sozinho que toda sugestão respeita quantidade mínima, estoque e valor (relendo cada produto na API) e grava `logs/avaliacao-recomendacao-AAAA-MM-DD.md`, com uma linha por pedido para a equipe marcar se a sugestão é adequada.
