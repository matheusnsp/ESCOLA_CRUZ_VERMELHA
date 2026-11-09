-- Cupom no curso presencial (2026-11-09). Só acrescenta: duas colunas no cupom (uma opcional, uma com padrão).
-- AlterTable
ALTER TABLE "CupomEad" ADD COLUMN     "cursoId" TEXT,
ADD COLUMN     "todosPresenciais" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "CupomEad" ADD CONSTRAINT "CupomEad_cursoId_fkey" FOREIGN KEY ("cursoId") REFERENCES "Curso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

