-- Escola Digital, vitrine (2026-11-09): curso gratuito e ordem na vitrine. Só acrescenta colunas com padrão.
ALTER TABLE "CursoOnline" ADD COLUMN "gratuito" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ordemVitrine" INTEGER NOT NULL DEFAULT 0;
