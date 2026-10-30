-- ============================================================
-- CRM Presentes Especiais — schema inicial (Neon / Postgres 15+)
--
-- Não há RLS: o banco é acessado só pelo servidor do Next, e toda
-- consulta passa por src/lib/access.ts, que deriva o escopo da sessão
-- (admin vê a operação, colaborador só o que é atribuído a ele).
-- ============================================================

-- gen_random_uuid() é nativo desde o Postgres 13 (Neon usa 15+): sem extensão

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Usuários (admin e colaboradores)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'COLABORADOR' CHECK (role IN ('ADMIN', 'COLABORADOR')),
  job_title TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Entra na distribuição automática de leads (rodízio)
  receives_leads BOOLEAN NOT NULL DEFAULT true,
  -- Senha provisória definida pelo admin: troca obrigatória no primeiro acesso
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  -- Incrementado ao desativar ou trocar a senha: derruba as sessões abertas
  session_version INTEGER NOT NULL DEFAULT 0,
  monthly_goal NUMERIC(12, 2),
  last_login_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- Configuração do CRM (linha única)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  -- MANUAL: o admin distribui. ROUND_ROBIN: rodízio entre colaboradores que recebem leads
  distribution_mode TEXT NOT NULL DEFAULT 'MANUAL' CHECK (distribution_mode IN ('MANUAL', 'ROUND_ROBIN')),
  -- No rodízio, só distribui lead já qualificado (como no dcimob)
  distribute_only_qualified BOOLEAN NOT NULL DEFAULT true,
  last_assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL DEFAULT 'Presentes Especiais',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO crm_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- Leads: um por cliente (telefone), alimentado pelo agente Lia
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,                 -- só dígitos, com DDI
  name TEXT,
  email TEXT,
  company TEXT,
  customer_type TEXT CHECK (customer_type IN ('PF', 'PJ')),
  source TEXT NOT NULL DEFAULT 'AGENTE' CHECK (source IN ('AGENTE', 'MANUAL')),
  agent_conversation_id TEXT,

  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,

  -- Qualificação (mesma régua do dcimob: score 0-100 → quente/morno/frio)
  qualification_status TEXT NOT NULL DEFAULT 'NONE'
    CHECK (qualification_status IN ('NONE', 'IN_PROGRESS', 'QUALIFIED', 'DISQUALIFIED')),
  qualification_source TEXT CHECK (qualification_source IN ('AGENTE', 'MANUAL')),
  lead_score INTEGER CHECK (lead_score BETWEEN 0 AND 100),
  -- Score definido à mão: o sync do agente não sobrescreve
  score_locked BOOLEAN NOT NULL DEFAULT false,
  qualification JSONB NOT NULL DEFAULT '{}'::jsonb,  -- ocasiao, quantidade, orcamento, data_limite, produtos, itens...
  qualification_summary TEXT,
  disqualification_reason TEXT,
  qualified_at TIMESTAMPTZ,

  -- Funil comercial (quadro de prospecção)
  stage TEXT NOT NULL DEFAULT 'NOVO'
    CHECK (stage IN ('NOVO', 'ATENDIMENTO', 'ORCAMENTO', 'ARTE', 'NEGOCIACAO', 'GANHO', 'PERDIDO')),
  estimated_value NUMERIC(12, 2),
  won_value NUMERIC(12, 2),
  won_at TIMESTAMPTZ,
  lost_reason TEXT,
  lost_at TIMESTAMPTZ,

  -- Próximo passo combinado: alimenta a central do dia
  next_action TEXT,
  next_action_at TIMESTAMPTZ,

  -- Estado da conversa
  agent_mode TEXT NOT NULL DEFAULT 'ia' CHECK (agent_mode IN ('ia', 'humano')),
  needs_attention BOOLEAN NOT NULL DEFAULT false,
  attention_reason TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_from_client BOOLEAN,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_last_message ON leads(last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_leads_next_action ON leads(next_action_at);
DROP TRIGGER IF EXISTS trg_leads_updated ON leads;
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- Mensagens da conversa (cliente, agente ou colaborador)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  -- Idempotência do sync: hash de (papel, horário, texto)
  external_id TEXT NOT NULL,
  author TEXT NOT NULL CHECK (author IN ('CLIENTE', 'AGENTE', 'COLABORADOR')),
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id, sent_at);

-- ------------------------------------------------------------
-- Linha do tempo do lead: atribuição, mudança de etapa, notas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,   -- NOTA | ATRIBUICAO | ETAPA | QUALIFICACAO | PROXIMO_PASSO | CRIADO
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_events_type ON lead_events(type, created_at DESC);

-- ------------------------------------------------------------
-- Notificações (sino da navbar)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- ------------------------------------------------------------
-- PresentesIA: conversas privadas de cada usuário
-- (nem o admin lê as conversas de IA de outra pessoa)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ia_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  last_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ia_conversations_user ON ia_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ia_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ia_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ia_messages_conversation ON ia_messages(conversation_id, created_at);

-- ------------------------------------------------------------
-- Controle de migrations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
