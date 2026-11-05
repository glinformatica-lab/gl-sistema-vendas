-- Migration v59 - Permissoes granulares em usuarios
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS permissoes TEXT;
