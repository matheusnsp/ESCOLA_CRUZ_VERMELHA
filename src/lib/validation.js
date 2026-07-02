const { z } = require('zod');

// --- CONSTANTES ---
const ESCOLARIDADES = ['Ensino Fundamental', 'Ensino Médio', 'Ensino Superior'];
const SITUACOES_ESCOLARIDADE = ['Cursando', 'Completo'];
const GENEROS = ['Masculino', 'Feminino', 'Outro', 'Prefiro não informar'];
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

// --- CAMPOS REUTILIZÁVEIS ---
const escolaridadeField = z.string().trim().min(1, 'Selecione sua escolaridade.').refine((v) => ESCOLARIDADES.includes(v), { message: 'Escolaridade inválida.' });
const escolaridadeSituacaoField = z.string().trim().min(1, 'Selecione se está cursando ou já concluiu.').refine((v) => SITUACOES_ESCOLARIDADE.includes(v), { message: 'Situação de escolaridade inválida.' });
const generoField = z.string().trim().optional().transform(v => v || '').refine(v => v === '' || GENEROS.includes(v), { message: 'Gênero inválido.' });
const opcionalTexto = (max, msg) => z.string().trim().max(max, msg).optional().transform(v => v || '');

const cepField = z.string().trim().transform(v => v ? v.replace(/\D/g, '') : '').refine(v => v.length === 8, { message: 'CEP inválido.' });
const ufField = z.string().trim().transform(v => v.toUpperCase()).refine(v => UFS.includes(v), { message: 'Selecione a UF.' });

const enderecoShape = {
  cep: cepField,
  logradouro: z.string().trim().min(1, 'Informe a rua.').max(160, 'Endereço muito longo.'),
  numero: z.string().trim().min(1, 'Informe o número.').max(20, 'Número muito longo.'),
  complemento: opcionalTexto(80, 'Complemento muito longo.'),
  bairro: z.string().trim().min(1, 'Informe o bairro.').max(80, 'Bairro muito longo.'),
  cidade: z.string().trim().min(1, 'Informe a cidade.').max(80, 'Cidade muito longa.'),
  uf: ufField,
};

// --- SCHEMAS ---
const cadastroSchema = z.object({
  nome: z.string().trim().min(3, 'Nome completo obrigatório.').refine(v => v.split(/\s+/).filter(Boolean).length >= 2, { message: 'Informe nome e sobrenome.' }),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(180),
  documento: z.string().trim().transform(v => v.replace(/\D/g, '')).refine(v => v.length >= 11, { message: 'CPF/CNPJ inválido.' }),
  rg: opcionalTexto(20, 'RG muito longo.'),
  celular: z.string().trim().transform(v => v.replace(/\D/g, '')).refine(v => v.length === 10 || v.length === 11, { message: 'Celular inválido.' }),
  escolaridade: escolaridadeField,
  escolaridadeSituacao: escolaridadeSituacaoField,
  genero: generoField,
  ...enderecoShape,
  senha: z.string().min(10, 'A senha deve ter ao menos 10 caracteres.'),
  confirmarSenha: z.string(),
  consentimento: z.literal('on', { errorMap: () => ({ message: 'Aceite a Política de Privacidade.' }) }),
}).refine(d => d.senha === d.confirmarSenha, { path: ['confirmarSenha'], message: 'As senhas não coincidem.' });

const inscricaoSchema = z.object({
  plano: z.enum(['A_VISTA', 'PARCELADO']),
  forma: z.enum(['PIX', 'CREDITO', 'DINHEIRO']),
  numero: z.string().optional(),
  titular: z.string().optional(),
  mesExpiracao: z.string().optional(),
  anoExpiracao: z.string().optional(),
  cvv: z.string().optional(),
}).refine(d => {
  if (d.forma === 'CREDITO') {
    return !!(d.numero && d.titular && d.cvv && d.mesExpiracao && d.anoExpiracao);
  }
  return true;
}, { message: "Dados do cartão incompletos.", path: ["numero"] })
.refine(d => !(d.plano === 'PARCELADO' && d.forma === 'PIX'), { path: ['forma'], message: 'Parcelamento apenas no crédito ou presencial.' });

const turmaSchema = z.object({
  cursoId: z.string().min(1),
  inicioPrevisto: z.coerce.date(),
  fimPrevisto: z.preprocess(v => (v === '' ? undefined : v), z.coerce.date().optional()),
  horario: z.string().min(1).max(50),
  diasSemana: z.string().min(1).max(60),
  vagas: z.coerce.number().int().min(1),
  minimoAlunos: z.coerce.number().int().min(1),
});

module.exports = {
  cadastroSchema,
  perfilSchema: z.object({ escolaridade: escolaridadeField, escolaridadeSituacao: escolaridadeSituacaoField, genero: generoField, ...enderecoShape }),
  loginSchema: z.object({ email: z.string().email(), senha: z.string().min(1) }),
  esqueciSenhaSchema: z.object({ email: z.string().email() }),
  redefinirSenhaSchema: z.object({ token: z.string(), senha: z.string().min(10), confirmarSenha: z.string() }).refine(d => d.senha === d.confirmarSenha, { path: ['confirmarSenha'], message: 'Senhas não coincidem.' }),
  turmaSchema,
  inscricaoSchema,
  ESCOLARIDADES,
  SITUACOES_ESCOLARIDADE,
  GENEROS,
  UFS
};