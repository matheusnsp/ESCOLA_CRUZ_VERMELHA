-- CreateEnum
CREATE TYPE "ModalidadeCurso" AS ENUM ('PRESENCIAL', 'ONLINE');

-- CreateEnum
CREATE TYPE "SituacaoInscricaoOnline" AS ENUM ('AGUARDANDO_PAGAMENTO', 'ATIVA', 'CONCLUIDA', 'EXPIRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ComoConcluiu" AS ENUM ('TELAS', 'PRE_TESTE', 'CENARIOS');

-- CreateEnum
CREATE TYPE "TipoTeste" AS ENUM ('TOPICO', 'PRE_TESTE');

-- AlterTable
ALTER TABLE "Curso" ADD COLUMN     "modalidade" "ModalidadeCurso" NOT NULL DEFAULT 'PRESENCIAL',
ADD COLUMN     "prazoAcessoDias" INTEGER,
ADD COLUMN     "validadeCertificadoMeses" INTEGER;

-- CreateTable
CREATE TABLE "ModuloOnline" (
    "id" TEXT NOT NULL,
    "cursoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "minutos" INTEGER NOT NULL DEFAULT 0,
    "abertura" TEXT,
    "imagemUrl" TEXT,
    "temPreTeste" BOOLEAN NOT NULL DEFAULT true,
    "final" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ModuloOnline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicoOnline" (
    "id" TEXT NOT NULL,
    "moduloId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,

    CONSTRAINT "TopicoOnline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelaOnline" (
    "id" TEXT NOT NULL,
    "topicoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "ancora" TEXT NOT NULL,
    "imagemUrl" TEXT,
    "imagemAlt" TEXT,
    "videoId" TEXT,
    "videoTitulo" TEXT,
    "videoSegundos" INTEGER,
    "revisao" JSONB NOT NULL DEFAULT '[]',
    "alerta" TEXT,
    "dica" TEXT,

    CONSTRAINT "TelaOnline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerguntaOnline" (
    "id" TEXT NOT NULL,
    "topicoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "enunciado" TEXT NOT NULL,
    "alternativas" JSONB NOT NULL,
    "correta" INTEGER NOT NULL,
    "porque" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PerguntaOnline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CenarioOnline" (
    "id" TEXT NOT NULL,
    "moduloId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "cena" TEXT NOT NULL,
    "imagemUrl" TEXT,
    "tempoSugerido" INTEGER NOT NULL,

    CONSTRAINT "CenarioOnline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisaoCenario" (
    "id" TEXT NOT NULL,
    "cenarioId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "pergunta" TEXT NOT NULL,
    "opcoes" JSONB NOT NULL,
    "correta" INTEGER NOT NULL,
    "fala" TEXT NOT NULL,

    CONSTRAINT "DecisaoCenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InscricaoOnline" (
    "id" TEXT NOT NULL,
    "alunoId" TEXT NOT NULL,
    "cursoId" TEXT NOT NULL,
    "situacao" "SituacaoInscricaoOnline" NOT NULL DEFAULT 'AGUARDANDO_PAGAMENTO',
    "plano" "PlanoPagamento",
    "forma" "FormaPagamento",
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "valor" DECIMAL(10,2),
    "ativadaEm" TIMESTAMP(3),
    "acessoAte" TIMESTAMP(3),
    "concluidaEm" TIMESTAMP(3),
    "certificadoValidoAte" TIMESTAMP(3),
    "codigoCertificado" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InscricaoOnline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagamentoOnline" (
    "id" TEXT NOT NULL,
    "inscricaoId" TEXT NOT NULL,
    "metodo" "FormaPagamento" NOT NULL,
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "valor" DECIMAL(10,2) NOT NULL,
    "status" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
    "gateway" TEXT,
    "gatewayRef" TEXT,
    "gatewayHash" TEXT,
    "gatewayStatus" TEXT,
    "gatewayResponse" JSONB,
    "pixQrCode" TEXT,
    "pixUrl" TEXT,
    "pixBase64" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PagamentoOnline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelaVista" (
    "inscricaoId" TEXT NOT NULL,
    "telaId" TEXT NOT NULL,
    "vistaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelaVista_pkey" PRIMARY KEY ("inscricaoId","telaId")
);

-- CreateTable
CREATE TABLE "TentativaTeste" (
    "id" TEXT NOT NULL,
    "inscricaoId" TEXT NOT NULL,
    "tipo" "TipoTeste" NOT NULL,
    "topicoId" TEXT,
    "moduloId" TEXT,
    "perguntas" JSONB NOT NULL,
    "respostas" JSONB NOT NULL DEFAULT '[]',
    "acertos" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "aprovado" BOOLEAN NOT NULL DEFAULT false,
    "finalizada" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TentativaTeste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuloConcluido" (
    "inscricaoId" TEXT NOT NULL,
    "moduloId" TEXT NOT NULL,
    "como" "ComoConcluiu" NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuloConcluido_pkey" PRIMARY KEY ("inscricaoId","moduloId")
);

-- CreateTable
CREATE TABLE "CenarioFeito" (
    "inscricaoId" TEXT NOT NULL,
    "cenarioId" TEXT NOT NULL,
    "escolhas" JSONB NOT NULL,
    "acertos" INTEGER NOT NULL,
    "segundos" INTEGER NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CenarioFeito_pkey" PRIMARY KEY ("inscricaoId","cenarioId")
);

-- CreateIndex
CREATE INDEX "ModuloOnline_cursoId_idx" ON "ModuloOnline"("cursoId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuloOnline_cursoId_chave_key" ON "ModuloOnline"("cursoId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "TopicoOnline_moduloId_chave_key" ON "TopicoOnline"("moduloId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "TelaOnline_topicoId_chave_key" ON "TelaOnline"("topicoId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "PerguntaOnline_topicoId_chave_key" ON "PerguntaOnline"("topicoId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "CenarioOnline_moduloId_chave_key" ON "CenarioOnline"("moduloId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "DecisaoCenario_cenarioId_ordem_key" ON "DecisaoCenario"("cenarioId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "InscricaoOnline_codigoCertificado_key" ON "InscricaoOnline"("codigoCertificado");

-- CreateIndex
CREATE INDEX "InscricaoOnline_cursoId_idx" ON "InscricaoOnline"("cursoId");

-- CreateIndex
CREATE UNIQUE INDEX "InscricaoOnline_alunoId_cursoId_key" ON "InscricaoOnline"("alunoId", "cursoId");

-- CreateIndex
CREATE INDEX "PagamentoOnline_inscricaoId_idx" ON "PagamentoOnline"("inscricaoId");

-- CreateIndex
CREATE INDEX "PagamentoOnline_gatewayRef_idx" ON "PagamentoOnline"("gatewayRef");

-- CreateIndex
CREATE INDEX "PagamentoOnline_gatewayHash_idx" ON "PagamentoOnline"("gatewayHash");

-- CreateIndex
CREATE INDEX "PagamentoOnline_status_idx" ON "PagamentoOnline"("status");

-- CreateIndex
CREATE INDEX "TelaVista_telaId_idx" ON "TelaVista"("telaId");

-- CreateIndex
CREATE INDEX "TentativaTeste_inscricaoId_idx" ON "TentativaTeste"("inscricaoId");

-- CreateIndex
CREATE INDEX "TentativaTeste_topicoId_idx" ON "TentativaTeste"("topicoId");

-- CreateIndex
CREATE INDEX "TentativaTeste_moduloId_idx" ON "TentativaTeste"("moduloId");

-- CreateIndex
CREATE INDEX "ModuloConcluido_moduloId_idx" ON "ModuloConcluido"("moduloId");

-- CreateIndex
CREATE INDEX "CenarioFeito_cenarioId_idx" ON "CenarioFeito"("cenarioId");

-- AddForeignKey
ALTER TABLE "ModuloOnline" ADD CONSTRAINT "ModuloOnline_cursoId_fkey" FOREIGN KEY ("cursoId") REFERENCES "Curso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicoOnline" ADD CONSTRAINT "TopicoOnline_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "ModuloOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelaOnline" ADD CONSTRAINT "TelaOnline_topicoId_fkey" FOREIGN KEY ("topicoId") REFERENCES "TopicoOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerguntaOnline" ADD CONSTRAINT "PerguntaOnline_topicoId_fkey" FOREIGN KEY ("topicoId") REFERENCES "TopicoOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenarioOnline" ADD CONSTRAINT "CenarioOnline_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "ModuloOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisaoCenario" ADD CONSTRAINT "DecisaoCenario_cenarioId_fkey" FOREIGN KEY ("cenarioId") REFERENCES "CenarioOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InscricaoOnline" ADD CONSTRAINT "InscricaoOnline_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InscricaoOnline" ADD CONSTRAINT "InscricaoOnline_cursoId_fkey" FOREIGN KEY ("cursoId") REFERENCES "Curso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoOnline" ADD CONSTRAINT "PagamentoOnline_inscricaoId_fkey" FOREIGN KEY ("inscricaoId") REFERENCES "InscricaoOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelaVista" ADD CONSTRAINT "TelaVista_inscricaoId_fkey" FOREIGN KEY ("inscricaoId") REFERENCES "InscricaoOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelaVista" ADD CONSTRAINT "TelaVista_telaId_fkey" FOREIGN KEY ("telaId") REFERENCES "TelaOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TentativaTeste" ADD CONSTRAINT "TentativaTeste_inscricaoId_fkey" FOREIGN KEY ("inscricaoId") REFERENCES "InscricaoOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TentativaTeste" ADD CONSTRAINT "TentativaTeste_topicoId_fkey" FOREIGN KEY ("topicoId") REFERENCES "TopicoOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TentativaTeste" ADD CONSTRAINT "TentativaTeste_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "ModuloOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuloConcluido" ADD CONSTRAINT "ModuloConcluido_inscricaoId_fkey" FOREIGN KEY ("inscricaoId") REFERENCES "InscricaoOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuloConcluido" ADD CONSTRAINT "ModuloConcluido_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "ModuloOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenarioFeito" ADD CONSTRAINT "CenarioFeito_inscricaoId_fkey" FOREIGN KEY ("inscricaoId") REFERENCES "InscricaoOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenarioFeito" ADD CONSTRAINT "CenarioFeito_cenarioId_fkey" FOREIGN KEY ("cenarioId") REFERENCES "CenarioOnline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

