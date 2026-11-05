-- EAD, etapa 4: turma online permanente (status ONLINE, só acrescenta o valor, como o EM_ESPERA) e
-- preço/publicação do curso online (colunas novas na tabela do EAD, que ainda não existe em produção).

-- AlterEnum
ALTER TYPE "StatusTurma" ADD VALUE IF NOT EXISTS 'ONLINE';

-- AlterTable
ALTER TABLE "CursoOnline" ADD COLUMN     "precoOnline" DECIMAL(10,2),
ADD COLUMN     "publicado" BOOLEAN NOT NULL DEFAULT false;

