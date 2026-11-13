-- Webinários da Escola Digital (2026-11-13). Só acrescenta: tabelas novas e uma coluna opcional no cupom.
-- AlterTable
ALTER TABLE "CupomEad" ADD COLUMN     "webinarioId" TEXT;

-- CreateTable
CREATE TABLE "Webinario" (
    "id" TEXT NOT NULL,
    "cursoId" TEXT NOT NULL,
    "apresentador" TEXT,
    "inicioEm" TIMESTAMP(3),
    "duracaoMin" INTEGER NOT NULL,
    "linkAoVivo" TEXT,
    "gravacaoUrl" TEXT,
    "palavraCodigo" TEXT,
    "precoOnline" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gratuito" BOOLEAN NOT NULL DEFAULT false,
    "maxParcelas" INTEGER NOT NULL DEFAULT 1,
    "publicado" BOOLEAN NOT NULL DEFAULT false,
    "ordemVitrine" INTEGER NOT NULL DEFAULT 0,
    "gravacaoAvisadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webinario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InscricaoWebinario" (
    "id" TEXT NOT NULL,
    "webinarioId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lembrete24hEm" TIMESTAMP(3),
    "lembrete1hEm" TIMESTAMP(3),

    CONSTRAINT "InscricaoWebinario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresencaWebinario" (
    "id" TEXT NOT NULL,
    "webinarioId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "confirmadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresencaWebinario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TentativaPalavraWebinario" (
    "id" TEXT NOT NULL,
    "webinarioId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TentativaPalavraWebinario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Webinario_cursoId_key" ON "Webinario"("cursoId");

-- CreateIndex
CREATE INDEX "Webinario_publicado_inicioEm_idx" ON "Webinario"("publicado", "inicioEm");

-- CreateIndex
CREATE INDEX "InscricaoWebinario_usuarioId_idx" ON "InscricaoWebinario"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "InscricaoWebinario_webinarioId_usuarioId_key" ON "InscricaoWebinario"("webinarioId", "usuarioId");

-- CreateIndex
CREATE INDEX "PresencaWebinario_usuarioId_idx" ON "PresencaWebinario"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "PresencaWebinario_webinarioId_usuarioId_key" ON "PresencaWebinario"("webinarioId", "usuarioId");

-- CreateIndex
CREATE INDEX "TentativaPalavraWebinario_webinarioId_usuarioId_criadoEm_idx" ON "TentativaPalavraWebinario"("webinarioId", "usuarioId", "criadoEm");

-- AddForeignKey
ALTER TABLE "CupomEad" ADD CONSTRAINT "CupomEad_webinarioId_fkey" FOREIGN KEY ("webinarioId") REFERENCES "Webinario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webinario" ADD CONSTRAINT "Webinario_cursoId_fkey" FOREIGN KEY ("cursoId") REFERENCES "Curso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InscricaoWebinario" ADD CONSTRAINT "InscricaoWebinario_webinarioId_fkey" FOREIGN KEY ("webinarioId") REFERENCES "Webinario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InscricaoWebinario" ADD CONSTRAINT "InscricaoWebinario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresencaWebinario" ADD CONSTRAINT "PresencaWebinario_webinarioId_fkey" FOREIGN KEY ("webinarioId") REFERENCES "Webinario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresencaWebinario" ADD CONSTRAINT "PresencaWebinario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TentativaPalavraWebinario" ADD CONSTRAINT "TentativaPalavraWebinario_webinarioId_fkey" FOREIGN KEY ("webinarioId") REFERENCES "Webinario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TentativaPalavraWebinario" ADD CONSTRAINT "TentativaPalavraWebinario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

