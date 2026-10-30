/**
 * Dados de demonstração (fictícios): 1 admin, 3 colaboradores e ~30 leads
 * criados pelo mesmo caminho das conversas reais da Lia (ingestConversation).
 *   npm run db:seed
 * Não rode em produção: as senhas de demonstração são conhecidas.
 */
import { one, query } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/session";
import { ingestConversation } from "../src/lib/ingest";
import type { AgentState } from "../src/lib/ingest";

if (process.env.NODE_ENV === "production") {
  console.error("Seed de demonstração bloqueado em produção.");
  process.exit(1);
}

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function upsertUser(name: string, email: string, role: "ADMIN" | "COLABORADOR", password: string, extra: { job?: string; goal?: number } = {}) {
  const found = await one<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  if (found) return found.id;
  const row = await one<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role, job_title, monthly_goal, must_change_password, receives_leads, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, false, $7, NOW() - INTERVAL '2 hours') RETURNING id`,
    [name, email, await hashPassword(password), role, extra.job ?? null, extra.goal ?? null, role === "COLABORADOR"]
  );
  return row!.id;
}

const CLIENTES = [
  { nome: "Mariana Albuquerque", empresa: "Grupo Solar Energia", tipo: "PJ" as const },
  { nome: "Ricardo Teixeira", empresa: "Construtora Horizonte", tipo: "PJ" as const },
  { nome: "Juliana Farias", empresa: "Clínica Vida Plena", tipo: "PJ" as const },
  { nome: "Fernando Castro", empresa: "TechNordeste Software", tipo: "PJ" as const },
  { nome: "Patrícia Moura", empresa: "Escola Pequeno Saber", tipo: "PJ" as const },
  { nome: "Gustavo Henrique", empresa: "Banco Cooperativo Litoral", tipo: "PJ" as const },
  { nome: "Camila Ribeiro", empresa: null, tipo: "PF" as const },
  { nome: "Thiago Nascimento", empresa: "Agência Maré Digital", tipo: "PJ" as const },
  { nome: "Aline Barbosa", empresa: "Hospital São Lucas", tipo: "PJ" as const },
  { nome: "Rodrigo Pires", empresa: "Indústria Têxtil Paraíba", tipo: "PJ" as const },
  { nome: "Beatriz Campos", empresa: null, tipo: "PF" as const },
  { nome: "Leonardo Dantas", empresa: "Advocacia Dantas & Lima", tipo: "PJ" as const },
  { nome: "Vanessa Cordeiro", empresa: "Rede Farmácia Popular+", tipo: "PJ" as const },
  { nome: "Eduardo Monteiro", empresa: "Imobiliária Costa Azul", tipo: "PJ" as const },
  { nome: "Larissa Queiroz", empresa: "Startup Pague Fácil", tipo: "PJ" as const },
  { nome: "Marcelo Araújo", empresa: "Concessionária Motors JP", tipo: "PJ" as const },
  { nome: "Renata Siqueira", empresa: null, tipo: "PF" as const },
  { nome: "Paulo Vasconcelos", empresa: "Universidade Atlântica", tipo: "PJ" as const },
  { nome: "Daniela Lopes", empresa: "Laboratório BioAnálises", tipo: "PJ" as const },
  { nome: "André Figueiredo", empresa: "Rede de Academias Fit+", tipo: "PJ" as const },
  { nome: "Natália Freire", empresa: "Cerimonial Encanto", tipo: "PJ" as const },
  { nome: "Sérgio Medeiros", empresa: "Cooperativa Agro Sertão", tipo: "PJ" as const },
  { nome: "Isabela Rocha", empresa: null, tipo: "PF" as const },
  { nome: "Felipe Cavalcanti", empresa: "Seguradora Proteção Total", tipo: "PJ" as const },
  { nome: "Tatiane Gomes", empresa: "Hotel Brisa Mar", tipo: "PJ" as const },
  { nome: "Hugo Brandão", empresa: "Distribuidora Nordeste Bebidas", tipo: "PJ" as const },
  { nome: "Priscila Melo", empresa: "Consultório Odonto Sorriso", tipo: "PJ" as const },
  { nome: "Otávio Lins", empresa: "Startup LogiFácil", tipo: "PJ" as const },
  { nome: "Cláudia Rangel", empresa: "Prefeitura — Sec. de Educação", tipo: "PJ" as const },
  { nome: "Vinícius Prado", empresa: null, tipo: "PF" as const },
];

const OCASIOES = ["fim de ano", "onboarding de colaboradores", "evento corporativo", "dia das mães", "aniversário da empresa", "feira / congresso", "kit boas-vindas", "dia do cliente"];
const PRODUTOS = [
  { nome: "Garrafa térmica inox 500ml", preco: 38.9 },
  { nome: "Caneca cerâmica personalizada", preco: 19.5 },
  { nome: "Kit caderno + caneta bambu", preco: 27.0 },
  { nome: "Mochila executiva notebook", preco: 129.0 },
  { nome: "Ecobag algodão cru", preco: 14.9 },
  { nome: "Power bank 10.000 mAh", preco: 74.0 },
  { nome: "Copo térmico 450ml", preco: 32.5 },
  { nome: "Kit churrasco 3 peças", preco: 89.0 },
];
const MOTIVOS_PERDA = ["Preço", "Prazo de produção", "Comprou com concorrente", "Sem retorno do cliente", "Desistiu do evento"];

function conversation(i: number, level: number, startedAt: number): AgentState {
  const c = CLIENTES[i];
  const phone = `55839${String(91000000 + i * 137_911).slice(0, 8)}`;
  const ocasiao = pick(OCASIOES);
  const qtd = pick([30, 50, 80, 100, 150, 200, 300, 500, 800]);
  const prods = [pick(PRODUTOS), pick(PRODUTOS)].filter((p, idx, arr) => arr.findIndex((x) => x.nome === p.nome) === idx);
  const prazo = new Date(startedAt + (20 + Math.floor(rand() * 40)) * DAY).toLocaleDateString("pt-BR");
  let t = startedAt;
  const h: AgentState["historico"] = [];
  const say = (role: "user" | "assistant", content: string) => {
    t += (2 + rand() * 25) * 60_000;
    h!.push({ role, content, timestamp: new Date(t).toISOString() });
  };

  say("user", pick(["Oi, boa tarde!", "Olá, vocês fazem brindes personalizados?", "Bom dia, queria um orçamento", "Oi! Vi o Instagram de vocês"]));
  say("assistant", "Olá! Aqui é a Lia, da Presentes Especiais 😊 Fazemos sim! Me conta: é para qual ocasião e mais ou menos quantas unidades?");
  const state: AgentState = { telefone: phone, conversaId: `demo-${i}`, modo: "ia", cliente: {}, necessidade: {}, produtosDiscutidos: [], artes: [], historico: h };
  if (level >= 1) {
    say("user", `É para ${ocasiao}${c.empresa ? ` aqui da ${c.empresa}` : ""}, umas ${qtd} unidades`);
    state.necessidade = { ocasiao, quantidade: qtd };
    say("assistant", `Que ótimo! Para ${ocasiao} costumam sair muito bem ${prods.map((p) => p.nome.toLowerCase()).join(" e ")}. Tem um valor por unidade em mente e uma data limite?`);
  }
  if (level >= 2) {
    const teto = Math.round(prods[0].preco * (1 + rand() * 0.6));
    say("user", `Até uns R$ ${teto} por unidade. Precisamos receber até ${prazo}. Meu nome é ${c.nome}.`);
    state.cliente = { nome: c.nome, tipo: c.tipo };
    state.necessidade = { ...state.necessidade, precoMaxUnitario: teto, dataLimite: prazo };
    state.produtosDiscutidos = prods.map((p) => p.nome);
    say("assistant", `Perfeito, ${c.nome.split(" ")[0]}! Separei opções dentro desse valor com gravação da logo. Quer que eu monte a estimativa?`);
  }
  if (level >= 3) {
    say("user", "Pode montar sim, com a logo em 1 cor. Vou mandar a arte.");
    state.artes = [{ ref: "arte-1", arquivo: "logo.png" }];
    const itens = prods.map((p) => ({ subproduto_id: "x", cor: pick(["preto", "branco", "azul", "verde"]), nome_produto: p.nome, quantidade: qtd, preco_unitario: p.preco, subtotal: Math.round(p.preco * qtd * 100) / 100 }));
    const total = Math.round(itens.reduce((s, x) => s + x.subtotal, 0) * 100) / 100;
    state.fichaPedido = {
      resumo: { tipo: c.tipo, nome: c.nome, email: `${c.nome.split(" ")[0].toLowerCase()}@exemplo.com.br`, itens, total_estimado: total, prazo_desejado: prazo, personalizacao: "Gravação da logo em 1 cor" },
    };
    state.cliente = { ...state.cliente, email: `${c.nome.split(" ")[0].toLowerCase()}@exemplo.com.br` };
    say("assistant", `Estimativa: ${itens.map((x) => `${x.quantidade}x ${x.nome_produto}`).join(" + ")}, total aproximado de ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Confirma que posso passar para nossa equipe emitir o orçamento oficial?`);
    say("user", "Confirmo, pode passar!");
    say("assistant", "Combinado! Vou te conectar com um atendente agora. Em instantes alguém da nossa equipe entrará em contato! 😊");
    state.modo = "humano";
  }
  if (level === 1 && rand() > 0.5) say("user", "Vou ver com meu gestor e te falo");
  return state;
}

// ---------------------------------------------------------------------------

const adminId = await upsertUser("Luis Montenegro", "admin@presentesespeciais.com.br", "ADMIN", "Presentes2026", { job: "Diretor comercial" });
const sellers = [
  await upsertUser("Ana Souza", "ana@presentesespeciais.com.br", "COLABORADOR", "Vendas2026", { job: "Consultora comercial", goal: 60000 }),
  await upsertUser("Bruno Lima", "bruno@presentesespeciais.com.br", "COLABORADOR", "Vendas2026", { job: "Consultor comercial", goal: 50000 }),
  await upsertUser("Carla Mendes", "carla@presentesespeciais.com.br", "COLABORADOR", "Vendas2026", { job: "Executiva de contas", goal: 45000 }),
];

const existing = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM leads");
if (existing && existing.n > 0) {
  console.log(`Já existem ${existing.n} leads: seed de leads ignorado.`);
} else {
  for (let i = 0; i < CLIENTES.length; i++) {
    const daysAgo = Math.floor(rand() * 28) + (i < 4 ? 0 : 1);
    const startedAt = Date.now() - daysAgo * DAY - rand() * 8 * HOUR;
    // Distribuição: poucos frios, muitos qualificados
    const level = i < 4 ? 1 : i < 8 ? 2 : 3;
    const { leadId } = await ingestConversation({ estado: conversation(i, level, startedAt), transferenciaPendente: level >= 3 ? { resumo: { motivo: "orcamento_para_emitir" } } : undefined });
    await query("UPDATE leads SET created_at = $2, company = $3 WHERE id = $1", [leadId, new Date(startedAt).toISOString(), CLIENTES[i].empresa]);

    if (level < 3 || i % 7 === 3) continue; // fila: qualificados sem vendedor
    const seller = sellers[i % 3];
    const assignedAt = startedAt + (1 + rand() * 5) * HOUR;
    await query(
      "UPDATE leads SET assigned_to = $2, assigned_at = $3, needs_attention = $4, unread_count = $5 WHERE id = $1",
      [leadId, seller, new Date(Math.min(assignedAt, Date.now())).toISOString(), i % 5 === 0, i % 4 === 0 ? Math.ceil(rand() * 3) : 0]
    );
    await query("INSERT INTO lead_events (lead_id, user_id, type, data, created_at) VALUES ($1, $2, 'ATRIBUICAO', $3, $4)", [
      leadId,
      adminId,
      JSON.stringify({ para: ["Ana Souza", "Bruno Lima", "Carla Mendes"][i % 3], para_id: seller }),
      new Date(Math.min(assignedAt, Date.now())).toISOString(),
    ]);

    const roll = rand();
    const lead = await one<{ estimated_value: number }>("SELECT estimated_value FROM leads WHERE id = $1", [leadId]);
    if (roll < 0.3) {
      const wonAt = Math.min(assignedAt + (2 + rand() * 6) * DAY, Date.now() - HOUR);
      await query("UPDATE leads SET stage = 'GANHO', won_value = $2, won_at = $3, last_message_from_client = false WHERE id = $1", [
        leadId,
        Math.round((lead?.estimated_value ?? 5000) * (0.9 + rand() * 0.25)),
        new Date(wonAt).toISOString(),
      ]);
    } else if (roll < 0.42) {
      await query("UPDATE leads SET stage = 'PERDIDO', lost_reason = $2, lost_at = $3 WHERE id = $1", [leadId, pick(MOTIVOS_PERDA), new Date(Date.now() - rand() * 10 * DAY).toISOString()]);
    } else {
      const stage = pick(["ATENDIMENTO", "ORCAMENTO", "ORCAMENTO", "ARTE", "NEGOCIACAO"]);
      const next = Date.now() + (rand() * 3 - 1.3) * DAY; // alguns vencidos, alguns hoje, alguns futuros
      await query("UPDATE leads SET stage = $2, next_action = $3, next_action_at = $4 WHERE id = $1", [
        leadId,
        stage,
        pick(["Enviar orçamento oficial", "Ligar para aprovar a arte", "Cobrar retorno do orçamento", "Confirmar quantidade final", "Enviar mockup com a logo"]),
        new Date(next).toISOString(),
      ]);
      // Parte dos clientes respondeu depois da transferência e espera o vendedor
      if (i % 2 === 0) {
        const at = new Date(Date.now() - (1 + rand() * 20) * HOUR).toISOString();
        const body = pick(["Oi! Conseguiram ver o orçamento?", "Bom dia, a arte ficou boa? Precisamos aprovar essa semana", "Dá pra fazer em outra cor?", "Qual o prazo se eu fechar hoje?"]);
        await query("INSERT INTO messages (lead_id, external_id, author, body, sent_at) VALUES ($1, $2, 'CLIENTE', $3, $4)", [leadId, `seed-${i}`, body, at]);
        await query("UPDATE leads SET last_message_text = $2, last_message_at = $3, last_message_from_client = true, unread_count = unread_count + 1 WHERE id = $1", [leadId, body, at]);
      }
    }
  }
  await query(
    `INSERT INTO notifications (user_id, title, message, link)
     SELECT id, 'Bem-vindo ao CRM', 'Seus leads e conversas atribuídos aparecem no CRM. A PresentesIA ajuda a priorizar o dia.', NULL
     FROM users`
  );
}

const total = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM leads");
console.log(`
Seed concluído (${total?.n} leads).

  Admin:        admin@presentesespeciais.com.br / Presentes2026
  Colaborador:  ana@presentesespeciais.com.br   / Vendas2026
                bruno@presentesespeciais.com.br / Vendas2026
                carla@presentesespeciais.com.br / Vendas2026
`);
process.exit(0);
