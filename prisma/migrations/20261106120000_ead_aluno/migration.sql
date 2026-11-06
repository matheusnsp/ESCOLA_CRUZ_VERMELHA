-- EAD, etapa 2: progresso do aluno. Só cria tipos, tabelas, índices e as chaves estrangeiras das
-- tabelas novas; nenhuma tabela existente é alterada (ver lib/extras.js, 30/09).

-- CreateEnum
CREATE TYPE "TipoTentativaEad" AS ENUM ('QUIZ', 'PRE_TESTE');

-- CreateTable
CREATE TABLE "AlunoCursoEad" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "cursoOnlineId" TEXT NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlunoCursoEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelaVistaEad" (
    "id" TEXT NOT NULL,
    "alunoCursoId" TEXT NOT NULL,
    "telaId" TEXT NOT NULL,
    "vistaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelaVistaEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TentativaEad" (
    "id" TEXT NOT NULL,
    "alunoCursoId" TEXT NOT NULL,
    "tipo" "TipoTentativaEad" NOT NULL,
    "moduloId" TEXT NOT NULL,
    "topicoId" TEXT,
    "perguntaIds" TEXT[],
    "respostas" JSONB NOT NULL DEFAULT '[]',
    "acertos" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "aprovado" BOOLEAN,
    "concluidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TentativaEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CenarioFeitoEad" (
    "id" TEXT NOT NULL,
    "alunoCursoId" TEXT NOT NULL,
    "cenarioId" TEXT NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decisaoAtual" INTEGER NOT NULL DEFAULT 0,
    "erros" INTEGER NOT NULL DEFAULT 0,
    "tempoSeg" INTEGER,
    "concluidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenarioFeitoEad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlunoCursoEad_cursoOnlineId_idx" ON "AlunoCursoEad"("cursoOnlineId");

-- CreateIndex
CREATE UNIQUE INDEX "AlunoCursoEad_usuarioId_cursoOnlineId_key" ON "AlunoCursoEad"("usuarioId", "cursoOnlineId");

-- CreateIndex
CREATE INDEX "TelaVistaEad_telaId_idx" ON "TelaVistaEad"("telaId");

-- CreateIndex
CREATE UNIQUE INDEX "TelaVistaEad_alunoCursoId_telaId_key" ON "TelaVistaEad"("alunoCursoId", "telaId");

-- CreateIndex
CREATE INDEX "TentativaEad_alunoCursoId_idx" ON "TentativaEad"("alunoCursoId");

-- CreateIndex
CREATE INDEX "TentativaEad_moduloId_idx" ON "TentativaEad"("moduloId");

-- CreateIndex
CREATE INDEX "TentativaEad_topicoId_idx" ON "TentativaEad"("topicoId");

-- CreateIndex
CREATE INDEX "CenarioFeitoEad_cenarioId_idx" ON "CenarioFeitoEad"("cenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "CenarioFeitoEad_alunoCursoId_cenarioId_key" ON "CenarioFeitoEad"("alunoCursoId", "cenarioId");

-- AddForeignKey
ALTER TABLE "AlunoCursoEad" ADD CONSTRAINT "AlunoCursoEad_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlunoCursoEad" ADD CONSTRAINT "AlunoCursoEad_cursoOnlineId_fkey" FOREIGN KEY ("cursoOnlineId") REFERENCES "CursoOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelaVistaEad" ADD CONSTRAINT "TelaVistaEad_alunoCursoId_fkey" FOREIGN KEY ("alunoCursoId") REFERENCES "AlunoCursoEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelaVistaEad" ADD CONSTRAINT "TelaVistaEad_telaId_fkey" FOREIGN KEY ("telaId") REFERENCES "TelaEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TentativaEad" ADD CONSTRAINT "TentativaEad_alunoCursoId_fkey" FOREIGN KEY ("alunoCursoId") REFERENCES "AlunoCursoEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TentativaEad" ADD CONSTRAINT "TentativaEad_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "ModuloEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TentativaEad" ADD CONSTRAINT "TentativaEad_topicoId_fkey" FOREIGN KEY ("topicoId") REFERENCES "TopicoEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenarioFeitoEad" ADD CONSTRAINT "CenarioFeitoEad_alunoCursoId_fkey" FOREIGN KEY ("alunoCursoId") REFERENCES "AlunoCursoEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenarioFeitoEad" ADD CONSTRAINT "CenarioFeitoEad_cenarioId_fkey" FOREIGN KEY ("cenarioId") REFERENCES "CenarioEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

