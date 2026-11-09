-- Imagens com IA (2026-11-09): pedido do Claude, descrição e selo. Só acrescenta colunas.
ALTER TABLE "ModuloEad" ADD COLUMN "fotoPedido" TEXT,
ADD COLUMN "fotoSugestao" TEXT,
ADD COLUMN "fotoGeradaPorIa" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Curso" ADD COLUMN "imagemPedido" TEXT,
ADD COLUMN "imagemSugestao" TEXT,
ADD COLUMN "imagemGeradaPorIa" BOOLEAN NOT NULL DEFAULT false;
