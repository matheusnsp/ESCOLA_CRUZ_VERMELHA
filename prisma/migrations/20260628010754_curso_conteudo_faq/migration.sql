-- AlterTable
ALTER TABLE "Curso" ADD COLUMN     "descricaoLonga" TEXT;

-- CreateTable
CREATE TABLE "FaqCurso" (
    "id" TEXT NOT NULL,
    "cursoId" TEXT NOT NULL,
    "pergunta" TEXT NOT NULL,
    "resposta" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaqCurso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FaqCurso_cursoId_idx" ON "FaqCurso"("cursoId");

-- AddForeignKey
ALTER TABLE "FaqCurso" ADD CONSTRAINT "FaqCurso_cursoId_fkey" FOREIGN KEY ("cursoId") REFERENCES "Curso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
