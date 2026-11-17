-- Cupom de valor final (2026-11-17). Só acrescenta: colunas opcionais ou com padrão.
-- AlterTable
ALTER TABLE "CupomEad" ADD COLUMN     "taxaFinal" DECIMAL(10,2),
ADD COLUMN     "renovar" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "noSite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CupomMatriculaEad" ADD COLUMN     "taxaFinal" DECIMAL(10,2);
