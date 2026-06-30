// Validação de entrada no SERVIDOR (a do navegador é só conforto de UX).
const { z } = require('zod');

// Níveis de escolaridade (apenas os três; obrigatório).
const ESCOLARIDADES = [
  'Ensino Fundamental',
  'Ensino Médio',
  'Ensino Superior',
];

// Situação do nível (obrigatória junto com o nível).
const SITUACOES_ESCOLARIDADE = ['Cursando', 'Completo'];

// Escolaridade é OBRIGATÓRIA (nível + situação).
const escolaridadeField = z
  .string({ required_error: 'Selecione sua escolaridade.' })
  .trim()
  .min(1, 'Selecione sua escolaridade.')
  .refine((v) => ESCOLARIDADES.includes(v), { message: 'Escolaridade inválida.' });

const escolaridadeSituacaoField = z
  .string({ required_error: 'Selecione se está cursando ou já concluiu.' })
  .trim()
  .min(1, 'Selecione se está cursando ou já concluiu.')
  .refine((v) => SITUACOES_ESCOLARIDADE.includes(v), { message: 'Situação de escolaridade inválida.' });

// Nome completo: exige ao menos nome + sobrenome (duas palavras).
const nomeCompletoField = z
  .string()
  .trim()
  .min(3, 'Informe seu nome completo.')
  .max(120, 'Nome muito longo.')
  .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, {
    message: 'Informe nome e sobrenome (nome completo) — usado no certificado.',
  });

// Gênero é OPCIONAL (aceita vazio ou um dos valores da lista).
const GENEROS = ['Masculino', 'Feminino', 'Outro', 'Prefiro não informar'];
const generoField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : ''))
  .refine((v) => v === '' || GENEROS.includes(v), { message: 'Gênero inválido.' });

// Endereço — OBRIGATÓRIO (exceto complemento). Coletado para cobrança em caso de inadimplência.
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const opcionalTexto = (max, msg) =>
  z.string().trim().max(max, msg).optional().transform((v) => (v ? v : ''));

const cepField = z
  .string({ required_error: 'Informe o CEP.' })
  .trim()
  .transform((v) => (v ? v.replace(/\D/g, '') : ''))
  .refine((v) => v.length === 8, { message: 'Informe um CEP válido (8 dígitos).' });

const ufField = z
  .string({ required_error: 'Selecione a UF.' })
  .trim()
  .transform((v) => (v ? v.toUpperCase() : ''))
  .refine((v) => UFS.includes(v), { message: 'Selecione a UF.' });

const enderecoShape = {
  cep: cepField,
  logradouro: z.string().trim().min(1, 'Informe a rua/logradouro.').max(160, 'Endereço muito longo.'),
  numero: z.string().trim().min(1, 'Informe o número.').max(20, 'Número muito longo.'),
  complemento: opcionalTexto(80, 'Complemento muito longo.'),
  bairro: z.string().trim().min(1, 'Informe o bairro.').max(80, 'Bairro muito longo.'),
  cidade: z.string().trim().min(1, 'Informe a cidade.').max(80, 'Cidade muito longa.'),
  uf: ufField,
};

const cadastroSchema = z
  .object({
    nome: nomeCompletoField,
    email: z.string().trim().toLowerCase().email('E-mail inválido.').max(180, 'E-mail muito longo.'),
    documento: z.string().trim().min(1, 'Informe o CPF ou CNPJ.').max(20),
    rg: z.string().trim().max(20, 'RG muito longo.').optional().transform((v) => (v ? v : '')),
    celular: z
      .string({ required_error: 'Informe o celular.' })
      .trim()
      .transform((v) => (v ? v.replace(/\D/g, '') : ''))
      .refine((v) => v.length === 10 || v.length === 11, { message: 'Informe um celular válido com DDD.' }),
    escolaridade: escolaridadeField,
    escolaridadeSituacao: escolaridadeSituacaoField,
    genero: generoField,
    ...enderecoShape,
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

// Edição de perfil do aluno: escolaridade, gênero e endereço são editáveis.
// Nome, e-mail e CPF são travados (vão no certificado / são identidade/login).
const perfilSchema = z.object({
  escolaridade: escolaridadeField,
  escolaridadeSituacao: escolaridadeSituacaoField,
  genero: generoField,
  ...enderecoShape,
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

module.exports = { cadastroSchema, loginSchema, esqueciSenhaSchema, redefinirSenhaSchema, perfilSchema, ESCOLARIDADES, SITUACOES_ESCOLARIDADE, GENEROS, UFS };

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
