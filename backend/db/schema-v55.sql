-- ============================================
-- Migration v55: monitoramento agent Hiper (painel Master)
-- Adiciona ultimo_ping_agent e forcar_sync_em em hiper_config
-- ============================================

ALTER TABLE hiper_config ADD COLUMN IF NOT EXISTS forcar_sync_em    TIMESTAMPTZ;
ALTER TABLE hiper_config ADD COLUMN IF NOT EXISTS ultimo_ping_agent TIMESTAMPTZ;
