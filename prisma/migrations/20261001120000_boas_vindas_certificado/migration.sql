-- Boas-vindas da turma (e-mail + aviso em "Minha conta") e certificado impresso pela secretaria.
-- IF NOT EXISTS: o banco de produção já recebeu mudanças por db push; a migração não pode falhar
-- se alguma coluna já existir.

-- Curso: conteúdo do verso do certificado
ALTER TABLE "Curso" ADD COLUMN IF NOT EXISTS "nomeCertificado" TEXT;
ALTER TABLE "Curso" ADD COLUMN IF NOT EXISTS "conteudoProgramatico" TEXT;
ALTER TABLE "Curso" ADD COLUMN IF NOT EXISTS "certificadoValidade" TEXT;

-- Turma: instrutor (assina o certificado), doação desta turma e quando as boas-vindas foram liberadas
ALTER TABLE "Turma" ADD COLUMN IF NOT EXISTS "instrutorNome" TEXT;
ALTER TABLE "Turma" ADD COLUMN IF NOT EXISTS "instrutorRegistro" TEXT;
ALTER TABLE "Turma" ADD COLUMN IF NOT EXISTS "boasVindasDoacao" TEXT;
ALTER TABLE "Turma" ADD COLUMN IF NOT EXISTS "boasVindasEnviadaEm" TIMESTAMP(3);

-- Matrícula: e-mail de boas-vindas enviado e numeração do certificado (Livro / Registro)
ALTER TABLE "Matricula" ADD COLUMN IF NOT EXISTS "boasVindasEm" TIMESTAMP(3);
ALTER TABLE "Matricula" ADD COLUMN IF NOT EXISTS "certLivro" INTEGER;
ALTER TABLE "Matricula" ADD COLUMN IF NOT EXISTS "certRegistro" INTEGER;
ALTER TABLE "Matricula" ADD COLUMN IF NOT EXISTS "certEmitidoEm" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Matricula_certLivro_certRegistro_key" ON "Matricula"("certLivro", "certRegistro");
