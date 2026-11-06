-- EAD, etapa 7: cupom de desconto do curso online e parcelas no cartão. Cria 2 tabelas novas e acrescenta
-- "maxParcelas" em "CursoOnline" (tabela do EAD); nenhuma tabela do presencial é alterada.

-- AlterTable
ALTER TABLE "CursoOnline" ADD COLUMN     "maxParcelas" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CupomEad" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "cursoOnlineId" TEXT,
    "validoAte" TIMESTAMP(3),
    "limiteUsos" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "criadoPor" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CupomEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CupomMatriculaEad" (
    "id" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "cupomId" TEXT NOT NULL,
    "precoCheio" DECIMAL(10,2) NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL,
    "precoFinal" DECIMAL(10,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CupomMatriculaEad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CupomEad_codigo_key" ON "CupomEad"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "CupomMatriculaEad_matriculaId_key" ON "CupomMatriculaEad"("matriculaId");

-- CreateIndex
CREATE INDEX "CupomMatriculaEad_cupomId_idx" ON "CupomMatriculaEad"("cupomId");

-- AddForeignKey
ALTER TABLE "CupomEad" ADD CONSTRAINT "CupomEad_cursoOnlineId_fkey" FOREIGN KEY ("cursoOnlineId") REFERENCES "CursoOnline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CupomMatriculaEad" ADD CONSTRAINT "CupomMatriculaEad_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CupomMatriculaEad" ADD CONSTRAINT "CupomMatriculaEad_cupomId_fkey" FOREIGN KEY ("cupomId") REFERENCES "CupomEad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

