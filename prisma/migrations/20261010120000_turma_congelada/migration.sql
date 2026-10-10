-- Turma CONGELADA (pausada pela secretaria): sai do site e das rotinas automáticas (lembretes,
-- boas-vindas, pesquisa, conclusão automática, A receber); os alunos continuam matriculados e, ao
-- voltar para ABERTA ou CONFIRMADA, tudo volta.
-- Só acrescenta um valor ao enum. IF NOT EXISTS: não falha se o valor já existir.
ALTER TYPE "StatusTurma" ADD VALUE IF NOT EXISTS 'CONGELADA';
