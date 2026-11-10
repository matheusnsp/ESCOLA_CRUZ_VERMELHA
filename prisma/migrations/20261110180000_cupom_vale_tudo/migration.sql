-- Cupom "Tudo" (2026-11-10): vale em cursos online, e-books e presenciais.
-- Só acrescenta uma coluna com padrão. IF NOT EXISTS: não falha se a coluna já existir.
ALTER TABLE "CupomEad" ADD COLUMN IF NOT EXISTS "valeTudo" BOOLEAN NOT NULL DEFAULT false;
