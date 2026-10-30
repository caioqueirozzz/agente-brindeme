# CRM Presentes Especiais

Gestão comercial interna: **CRM**, **Quadros**, **PresentesIA** e **Relatórios**, com um portal para a administração (`/admin`) e outro para os colaboradores (`/app`). A base visual vem do dcimob (fundo fluido, navbar flutuante, modo claro/escuro). Os leads chegam das conversas que a agente **Lia** (este repositório, pasta de cima) atende no WhatsApp.

## Rodar local

```bash
cd crm
npm install
cp .env.example .env          # preencha AUTH_SECRET, OPENAI_API_KEY, CRM_INTEGRATION_SECRET
npm run db:seed               # dados fictícios de demonstração
npm run dev                   # http://localhost:3200
```

| Perfil | E-mail | Senha (demo) |
|---|---|---|
| Admin | admin@presentesespeciais.com.br | Presentes2026 |
| Colaboradora | ana@presentesespeciais.com.br | Vendas2026 |
| Colaborador | bruno@presentesespeciais.com.br | Vendas2026 |
| Colaboradora | carla@presentesespeciais.com.br | Vendas2026 |

Sem Neon, `DATABASE_URL=pglite:./.pglite` usa um Postgres embutido em arquivo. Ele aceita **um processo por vez**: pare o `npm run dev` antes de rodar `db:seed` ou `admin:criar`.

## Neon (produção)

1. Crie o projeto no Neon e copie a *pooled connection string*.
2. No `.env`: `DATABASE_URL=postgresql://...-pooler...neon.tech/neondb?sslmode=require`
3. `npm run db:migrate` (aplica `db/migrations/*.sql`; pode repetir).
4. `npm run admin:criar -- --nome "Seu Nome" --email voce@empresa.com.br` gera o primeiro admin com senha provisória.
5. Não rode `db:seed` em produção.

Deploy na Vercel: raiz do projeto = `crm/`, com as variáveis do `.env.example`.

## WhatsApp e a Lia (tempo real)

A conexão com o WhatsApp mora na **ponte do agente** (pasta de cima). O CRM controla e acompanha por ela:

```
celular da loja ⇄ ponte (npm run whatsapp) ⇄ Lia (agente)
                     │  ▲
   cada mensagem ────┘  └── QR, status, enviar, devolver (porta 3040, só localhost)
                     ▼
                    CRM
```

1. No `.env` do agente: `CRM_URL=http://localhost:3200` e o **mesmo** `CRM_INTEGRATION_SECRET` do CRM.
2. Na pasta do agente: `npm run whatsapp` (sobe a Lia e a ponte).
3. No CRM, como admin: **CRM › Conexão WhatsApp**. Leia o QR com o celular da loja.

A partir daí:
- toda mensagem (cliente, Lia, equipe) chega na conversa do lead em segundos, com lead novo criado na primeira mensagem;
- o estado que a Lia apurou (ocasião, quantidade, estimativa) atualiza o score depois de cada resposta dela;
- responder pelo CRM sai pelo número da loja e **pausa a Lia** naquela conversa (igual a responder pelo celular); "Devolver para a Lia" religa;
- o QR só aparece para o admin; o colaborador só responde os leads dele.

Sem a ponte rodando, a tela de conexão mostra como ligá-la. `npm run sync:agente` continua disponível para importar conversas antigas dos arquivos; ele não duplica o que já veio ao vivo.

## Permissões

Não há RLS no Neon: toda leitura passa por `src/lib/access.ts`, que deriva o escopo **da sessão**.

| | Admin | Colaborador |
|---|---|---|
| Leads e conversas | todos | só os atribuídos a ele (os demais respondem 404) |
| Distribuir, qualificar/desqualificar | sim | não |
| Central do dia | operação, fila, equipe | agenda, carteira e meta próprias |
| Relatórios | operação + tabela da equipe | só os próprios números |
| Equipe e acessos, distribuição | sim | não |
| PresentesIA | visão da empresa | só os dados dele; ferramentas de gestão nem são enviadas ao modelo |
| Conversas da PresentesIA | só as próprias | só as próprias |

Desativar um colaborador corta a sessão na hora (`session_version`) e devolve os leads abertos à fila. Senhas provisórias exigem troca no primeiro acesso.

## Estrutura

```
db/migrations/        schema SQL (Neon/Postgres 15+)
scripts/              migrate, seed, criarAdmin, syncAgente
src/proxy.ts          roteia /admin e /app por papel
src/lib/access.ts     escopo de dados por usuário (regra única)
src/lib/ingest.ts     conversa da Lia → lead (score, qualificação)
src/lib/leads.ts      atribuição, rodízio, eventos, notificações
src/lib/metrics.ts    central do dia e relatórios
src/lib/ia/           PresentesIA: prompt, ferramentas por papel, conversas privadas
src/components/       shell (dcimob), home, crm, boards, ia, reports, admin
```

## Ainda não feito

- Enviar arquivos/imagens pelo CRM (hoje só texto; arquivos recebidos aparecem como "📎 Arquivo enviado").
- A ponte guarda a fila para o CRM só em memória: se ela reiniciar com o CRM fora do ar, o que estava na fila se perde (as conversas seguem nos arquivos do agente e entram pelo `sync:agente`).
- Recuperação de senha por e-mail: o admin redefine pela tela de Equipe.
