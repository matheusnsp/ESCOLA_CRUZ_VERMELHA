-- EAD, etapa 5: dúvidas por aula e curso só online. Só cria o tipo e a tabela novos e acrescenta uma
-- coluna em CursoOnline (tabela do EAD); nada do presencial muda.

-- CreateEnum
CREATE TYPE "StatusDuvidaEad" AS ENUM ('AGUARDANDO', 'RESPONDIDA', 'DESCARTADA', 'OCULTA');

-- AlterTable
ALTER TABLE "CursoOnline" ADD COLUMN     "somenteOnline" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DuvidaEad" (
    "id" TEXT NOT NULL,
    "alunoCursoId" TEXT NOT NULL,
    "telaId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "status" "StatusDuvidaEad" NOT NULL DEFAULT 'AGUARDANDO',
    "resposta" TEXT,
    "respondidaPor" TEXT,
    "respondidaEm" TIMESTAMP(3),
    "motivoDescarte" TEXT,
    "lidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuvidaEad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DuvidaEad_telaId_status_idx" ON "DuvidaEad"("telaId", "status");

-- CreateIndex
CREATE INDEX "DuvidaEad_alunoCursoId_idx" ON "DuvidaEad"("alunoCursoId");

-- CreateIndex
CREATE INDEX "DuvidaEad_status_criadoEm_idx" ON "DuvidaEad"("status", "criadoEm");

-- AddForeignKey
ALTER TABLE "DuvidaEad" ADD CONSTRAINT "DuvidaEad_alunoCursoId_fkey" FOREIGN KEY ("alunoCursoId") REFERENCES "AlunoCursoEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuvidaEad" ADD CONSTRAINT "DuvidaEad_telaId_fkey" FOREIGN KEY ("telaId") REFERENCES "TelaEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

