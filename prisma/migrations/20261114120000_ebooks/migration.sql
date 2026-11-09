-- E-books da Escola Digital (2026-11-09). Só acrescenta: tabelas novas e uma coluna opcional no cupom.
-- AlterTable
ALTER TABLE "CupomEad" ADD COLUMN     "ebookId" TEXT;

-- CreateTable
CREATE TABLE "Ebook" (
    "id" TEXT NOT NULL,
    "cursoId" TEXT NOT NULL,
    "arquivoPdf" TEXT,
    "arquivoNome" TEXT,
    "paginas" INTEGER NOT NULL DEFAULT 0,
    "tamanhoBytes" INTEGER NOT NULL DEFAULT 0,
    "precoOnline" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gratuito" BOOLEAN NOT NULL DEFAULT false,
    "maxParcelas" INTEGER NOT NULL DEFAULT 1,
    "publicado" BOOLEAN NOT NULL DEFAULT false,
    "ordemVitrine" INTEGER NOT NULL DEFAULT 0,
    "capaGeradaPorIa" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadEbook" (
    "id" TEXT NOT NULL,
    "ebookId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadEbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcessoEbook" (
    "id" TEXT NOT NULL,
    "ebookId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcessoEbook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ebook_cursoId_key" ON "Ebook"("cursoId");

-- CreateIndex
CREATE INDEX "DownloadEbook_ebookId_idx" ON "DownloadEbook"("ebookId");

-- CreateIndex
CREATE INDEX "DownloadEbook_usuarioId_criadoEm_idx" ON "DownloadEbook"("usuarioId", "criadoEm");

-- CreateIndex
CREATE INDEX "AcessoEbook_usuarioId_idx" ON "AcessoEbook"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "AcessoEbook_ebookId_usuarioId_key" ON "AcessoEbook"("ebookId", "usuarioId");

-- AddForeignKey
ALTER TABLE "CupomEad" ADD CONSTRAINT "CupomEad_ebookId_fkey" FOREIGN KEY ("ebookId") REFERENCES "Ebook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ebook" ADD CONSTRAINT "Ebook_cursoId_fkey" FOREIGN KEY ("cursoId") REFERENCES "Curso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadEbook" ADD CONSTRAINT "DownloadEbook_ebookId_fkey" FOREIGN KEY ("ebookId") REFERENCES "Ebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadEbook" ADD CONSTRAINT "DownloadEbook_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcessoEbook" ADD CONSTRAINT "AcessoEbook_ebookId_fkey" FOREIGN KEY ("ebookId") REFERENCES "Ebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcessoEbook" ADD CONSTRAINT "AcessoEbook_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

