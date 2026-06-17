// Validação de entrada no SERVIDOR (a do navegador é só conforto de UX).
const { z } = require('zod');

const cadastroSchema = z
  .object({
    nome: z.string().trim().min(3, 'Informe seu nome completo.').max(120, 'Nome muito longo.'),
    email: z.string().trim().toLowerCase().email('E-mail inválido.').max(180, 'E-mail muito longo.'),
    documento: z.string().trim().min(1, 'Informe o CPF ou CNPJ.').max(20),
    senha: z.string().min(10, 'A senha deve ter ao menos 10 caracteres.').max(200, 'Senha muito longa.'),
    confirmarSenha: z.string(),
    // Checkbox marcado envia "on"; não marcado não envia o campo.
    consentimento: z.literal('on', {
      errorMap: () => ({
        message: 'É necessário aceitar a Política de Privacidade para criar a conta.',
      }),
    }),
  })
  .refine((dados) => dados.senha === dados.confirmarSenha, {
    path: ['confirmarSenha'],
    message: 'As senhas não coincidem.',
  });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(180),
  // No login não validamos comprimento: a senha já existe; só precisa estar presente.
  senha: z.string().min(1, 'Informe sua senha.').max(200),
});

const esqueciSenhaSchema = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(180),
});

const redefinirSenhaSchema = z
  .object({
    token: z.string().min(1).max(200),
    senha: z.string().min(10, 'A senha deve ter ao menos 10 caracteres.').max(200),
    confirmarSenha: z.string(),
  })
  .refine((dados) => dados.senha === dados.confirmarSenha, {
    path: ['confirmarSenha'],
    message: 'As senhas não coincidem.',
  });

module.exports = { cadastroSchema, loginSchema, esqueciSenhaSchema, redefinirSenhaSchema };

// Criacao de turma (painel da secretaria).
const turmaSchema = z.object({
  cursoId: z.string().min(1, 'Selecione um curso.'),
  inicioPrevisto: z.coerce.date({ errorMap: () => ({ message: 'Data de inicio invalida.' }) }),
  fimPrevisto: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.date().optional()
  ),
  horario: z.string().trim().min(1, 'Informe o horario.').max(50),
  diasSemana: z.string().trim().min(1, 'Informe os dias da semana.').max(60),
  vagas: z.coerce.number().int().min(1, 'Vagas deve ser ao menos 1.').max(1000),
  minimoAlunos: z.coerce.number().int().min(1).max(1000),
});

// Inscricao do aluno em uma turma.
const inscricaoSchema = z
  .object({
    plano: z.enum(['A_VISTA', 'PARCELADO'], { errorMap: () => ({ message: 'Plano invalido.' }) }),
    forma: z.enum(['PIX', 'DEBITO', 'CREDITO', 'DINHEIRO'], {
      errorMap: () => ({ message: 'Forma de pagamento invalida.' }),
    }),
  })
  .refine((d) => !(d.plano === 'PARCELADO' && (d.forma === 'PIX' || d.forma === 'DEBITO')), {
    path: ['forma'],
    message: 'Parcelamento so no cartao de credito ou presencial.',
  });

module.exports.turmaSchema = turmaSchema;
module.exports.inscricaoSchema = inscricaoSchema;
