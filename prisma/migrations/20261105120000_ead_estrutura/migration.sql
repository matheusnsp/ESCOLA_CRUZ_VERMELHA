-- EAD, etapa 1: conteúdo do curso 100% online. Só cria tipos, tabelas, índices e as chaves
-- estrangeiras das tabelas novas; nenhuma tabela existente é alterada (ver lib/extras.js, 30/09).

-- CreateEnum
CREATE TYPE "StatusModuloEad" AS ENUM ('RASCUNHO', 'VALIDADO');

-- CreateEnum
CREATE TYPE "TipoPerguntaEad" AS ENUM ('UNICA', 'MULTIPLA', 'VF');

-- CreateTable
CREATE TABLE "CursoOnline" (
    "id" TEXT NOT NULL,
    "cursoId" TEXT NOT NULL,
    "notaMinimaQuiz" INTEGER NOT NULL DEFAULT 80,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CursoOnline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuloEad" (
    "id" TEXT NOT NULL,
    "cursoOnlineId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "titulo" TEXT NOT NULL,
    "minutosEstimados" INTEGER NOT NULL DEFAULT 0,
    "introducao" TEXT,
    "fotoIntroUrl" TEXT,
    "final" BOOLEAN NOT NULL DEFAULT false,
    "status" "StatusModuloEad" NOT NULL DEFAULT 'RASCUNHO',
    "validadoPor" TEXT,
    "validadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuloEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicoEad" (
    "id" TEXT NOT NULL,
    "moduloId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "titulo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicoEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelaEad" (
    "id" TEXT NOT NULL,
    "topicoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "titulo" TEXT NOT NULL,
    "ancora" TEXT,
    "fotoUrl" TEXT,
    "videoUrl" TEXT,
    "videoTitulo" TEXT,
    "videoDuracaoSeg" INTEGER,
    "revisaoTitulo" TEXT,
    "revisaoItens" TEXT[],
    "alerta" TEXT,
    "dicaProfissional" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelaEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerguntaEad" (
    "id" TEXT NOT NULL,
    "topicoId" TEXT NOT NULL,
    "tipo" "TipoPerguntaEad" NOT NULL DEFAULT 'UNICA',
    "enunciado" TEXT NOT NULL,
    "feedback" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerguntaEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlternativaEad" (
    "id" TEXT NOT NULL,
    "perguntaId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "texto" TEXT NOT NULL,
    "correta" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlternativaEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CenarioEad" (
    "id" TEXT NOT NULL,
    "moduloId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "titulo" TEXT NOT NULL,
    "cena" TEXT,
    "fotoUrl" TEXT,
    "videoUrl" TEXT,
    "tempoSugeridoSeg" INTEGER NOT NULL DEFAULT 240,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenarioEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisaoCenario" (
    "id" TEXT NOT NULL,
    "cenarioId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "pergunta" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisaoCenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpcaoDecisao" (
    "id" TEXT NOT NULL,
    "decisaoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "texto" TEXT NOT NULL,
    "correta" BOOLEAN NOT NULL DEFAULT false,
    "feedback" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpcaoDecisao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CursoOnline_cursoId_key" ON "CursoOnline"("cursoId");

-- CreateIndex
CREATE INDEX "ModuloEad_cursoOnlineId_idx" ON "ModuloEad"("cursoOnlineId");

-- CreateIndex
CREATE INDEX "TopicoEad_moduloId_idx" ON "TopicoEad"("moduloId");

-- CreateIndex
CREATE INDEX "TelaEad_topicoId_idx" ON "TelaEad"("topicoId");

-- CreateIndex
CREATE INDEX "PerguntaEad_topicoId_idx" ON "PerguntaEad"("topicoId");

-- CreateIndex
CREATE INDEX "AlternativaEad_perguntaId_idx" ON "AlternativaEad"("perguntaId");

-- CreateIndex
CREATE INDEX "CenarioEad_moduloId_idx" ON "CenarioEad"("moduloId");

-- CreateIndex
CREATE INDEX "DecisaoCenario_cenarioId_idx" ON "DecisaoCenario"("cenarioId");

-- CreateIndex
CREATE INDEX "OpcaoDecisao_decisaoId_idx" ON "OpcaoDecisao"("decisaoId");

-- AddForeignKey
ALTER TABLE "CursoOnline" ADD CONSTRAINT "CursoOnline_cursoId_fkey" FOREIGN KEY ("cursoId") REFERENCES "Curso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuloEad" ADD CONSTRAINT "ModuloEad_cursoOnlineId_fkey" FOREIGN KEY ("cursoOnlineId") REFERENCES "CursoOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicoEad" ADD CONSTRAINT "TopicoEad_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "ModuloEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelaEad" ADD CONSTRAINT "TelaEad_topicoId_fkey" FOREIGN KEY ("topicoId") REFERENCES "TopicoEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerguntaEad" ADD CONSTRAINT "PerguntaEad_topicoId_fkey" FOREIGN KEY ("topicoId") REFERENCES "TopicoEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlternativaEad" ADD CONSTRAINT "AlternativaEad_perguntaId_fkey" FOREIGN KEY ("perguntaId") REFERENCES "PerguntaEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenarioEad" ADD CONSTRAINT "CenarioEad_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "ModuloEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisaoCenario" ADD CONSTRAINT "DecisaoCenario_cenarioId_fkey" FOREIGN KEY ("cenarioId") REFERENCES "CenarioEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpcaoDecisao" ADD CONSTRAINT "OpcaoDecisao_decisaoId_fkey" FOREIGN KEY ("decisaoId") REFERENCES "DecisaoCenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

