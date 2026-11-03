-- Turma EM_ESPERA (lista de espera por curso): turma interna, uma por curso, que guarda quem ainda
-- não tem data; não aparece como turma aberta em lugar nenhum.
-- Só acrescenta um valor ao enum. IF NOT EXISTS: não falha se o valor já existir.
ALTER TYPE "StatusTurma" ADD VALUE IF NOT EXISTS 'EM_ESPERA';
