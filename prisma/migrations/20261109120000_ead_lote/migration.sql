-- EAD, etapa 6: venda em lote para escolas e empresas. Só cria as 4 tabelas novas (escola, gestor,
-- lote, vaga), índices e chaves; nenhuma tabela existente é alterada.

-- CreateTable
CREATE TABLE "EscolaEad" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscolaEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GestorEscolaEad" (
    "id" TEXT NOT NULL,
    "escolaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GestorEscolaEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoteEad" (
    "id" TEXT NOT NULL,
    "escolaId" TEXT NOT NULL,
    "cursoOnlineId" TEXT NOT NULL,
    "vagas" INTEGER NOT NULL,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "forma" TEXT NOT NULL,
    "recebidoEm" TIMESTAMP(3),
    "observacao" TEXT,
    "convite" TEXT,
    "criadoPor" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoteEad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VagaLoteEad" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removidaEm" TIMESTAMP(3),

    CONSTRAINT "VagaLoteEad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EscolaEad_cnpj_key" ON "EscolaEad"("cnpj");

-- CreateIndex
CREATE INDEX "GestorEscolaEad_usuarioId_idx" ON "GestorEscolaEad"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "GestorEscolaEad_escolaId_usuarioId_key" ON "GestorEscolaEad"("escolaId", "usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "LoteEad_convite_key" ON "LoteEad"("convite");

-- CreateIndex
CREATE INDEX "LoteEad_escolaId_idx" ON "LoteEad"("escolaId");

-- CreateIndex
CREATE INDEX "LoteEad_cursoOnlineId_idx" ON "LoteEad"("cursoOnlineId");

-- CreateIndex
CREATE INDEX "VagaLoteEad_loteId_idx" ON "VagaLoteEad"("loteId");

-- CreateIndex
CREATE INDEX "VagaLoteEad_usuarioId_idx" ON "VagaLoteEad"("usuarioId");

-- AddForeignKey
ALTER TABLE "GestorEscolaEad" ADD CONSTRAINT "GestorEscolaEad_escolaId_fkey" FOREIGN KEY ("escolaId") REFERENCES "EscolaEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GestorEscolaEad" ADD CONSTRAINT "GestorEscolaEad_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoteEad" ADD CONSTRAINT "LoteEad_escolaId_fkey" FOREIGN KEY ("escolaId") REFERENCES "EscolaEad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoteEad" ADD CONSTRAINT "LoteEad_cursoOnlineId_fkey" FOREIGN KEY ("cursoOnlineId") REFERENCES "CursoOnline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VagaLoteEad" ADD CONSTRAINT "VagaLoteEad_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteEad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VagaLoteEad" ADD CONSTRAINT "VagaLoteEad_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

