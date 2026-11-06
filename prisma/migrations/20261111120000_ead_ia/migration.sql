-- EAD, etapa 9: criar curso com IA. Cria a tabela "GeracaoIaEad" e acrescenta "geradoPorIa" em "ModuloEad" (tabela do
-- EAD); nenhuma tabela do presencial é alterada.

-- AlterTable
ALTER TABLE "ModuloEad" ADD COLUMN     "geradoPorIa" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GeracaoIaEad" (
    "id" TEXT NOT NULL,
    "criadoPor" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "pedido" JSONB NOT NULL,
    "materialTexto" TEXT,
    "materialPdfs" JSONB,
    "roteiro" JSONB,
    "cursoOnlineId" TEXT,
    "modulos" JSONB,
    "tokensEntrada" INTEGER NOT NULL DEFAULT 0,
    "tokensSaida" INTEGER NOT NULL DEFAULT 0,
    "tokensCache" INTEGER NOT NULL DEFAULT 0,
    "custoUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeracaoIaEad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeracaoIaEad_status_idx" ON "GeracaoIaEad"("status");

-- CreateIndex
CREATE INDEX "GeracaoIaEad_criadoEm_idx" ON "GeracaoIaEad"("criadoEm");

