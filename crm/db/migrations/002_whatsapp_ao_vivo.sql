-- ============================================================
-- WhatsApp ao vivo: a ponte do agente envia cada mensagem ao CRM
-- e o CRM responde pelo número da loja.
-- Só acrescenta; pode rodar mais de uma vez.
-- ============================================================

-- HISTORICO: veio do arquivo de conversa do agente (sync:agente)
-- WHATSAPP: veio da ponte em tempo real, com o id real da mensagem
ALTER TABLE messages ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'HISTORICO';
DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_source_check CHECK (source IN ('HISTORICO', 'WHATSAPP'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tipo do conteúdo (texto, mídia, áudio...) para a tela mostrar "📎 arquivo" em vez de vazio
ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'texto';

CREATE INDEX IF NOT EXISTS idx_messages_lead_source ON messages(lead_id, source);
