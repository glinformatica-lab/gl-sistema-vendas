-- Migration v40: Previsão de entrega em Ordens de Compra
ALTER TABLE ordens_compra ADD COLUMN IF NOT EXISTS previsao_entrega DATE;
