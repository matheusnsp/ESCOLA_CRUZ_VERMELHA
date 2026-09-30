-- Taxa de matrícula padrão (usada quando o curso deixa a taxa em branco): 100,00 -> 99,00.
-- Só mexe na configuração; cursos com taxa própria e matrículas já feitas não mudam.
UPDATE "Configuracao" SET "valor" = '99.00' WHERE "chave" = 'matricula_valor_padrao';
