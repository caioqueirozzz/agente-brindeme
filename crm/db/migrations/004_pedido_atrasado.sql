-- ============================================================
-- Pedido atrasado: quando o cliente pergunta pela Lia e o pedido
-- passou da previsão, a equipe é avisada e o card ganha um "*".
-- Some quando a gestão muda a etapa, a previsão ou marca como resolvido.
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS late_alert_at TIMESTAMPTZ;
