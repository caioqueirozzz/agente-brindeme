-- ============================================================
-- Quadro de Pedidos: a sequência da operação depois da venda.
-- Só a gestão (ADMIN) mexe; a Lia lê para responder ao cliente
-- como está o andamento do pedido dele.
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS orders_code_seq START 1;

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Código curto que o cliente e a equipe usam (PED-0001)
  code TEXT NOT NULL UNIQUE DEFAULT ('PED-' || lpad(nextval('orders_code_seq')::text, 4, '0')),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  -- Telefone do cliente (só dígitos, com DDI e nono dígito): é por ele que a Lia acha o pedido
  phone TEXT NOT NULL,
  customer_name TEXT,
  title TEXT NOT NULL,                       -- ex.: "200 canecas personalizadas"
  stage TEXT NOT NULL DEFAULT 'CONFIRMADO'
    CHECK (stage IN ('CONFIRMADO', 'ARTE', 'PRODUCAO', 'PERSONALIZACAO', 'CONFERENCIA', 'EXPEDICAO', 'ENTREGUE')),
  due_date DATE,                             -- previsão de entrega combinada
  client_note TEXT,                          -- o que a Lia pode contar ao cliente
  internal_note TEXT,                        -- só a equipe vê
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_lead ON orders(lead_id);
CREATE INDEX IF NOT EXISTS idx_orders_stage ON orders(stage);
DROP TRIGGER IF EXISTS trg_orders_updated ON orders;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Histórico de etapas: a Lia conta "entrou em produção dia 03/11"
CREATE TABLE IF NOT EXISTS order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);
