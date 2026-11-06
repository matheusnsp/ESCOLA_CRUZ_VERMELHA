// lib/curso-endereco.js
//
// Painel: acha o curso pelo endereço com o nome (/cursos/<nome>/editar). Dois cursos podem dar o mesmo
// endereço (nomes iguais ou que só diferem em acento/maiúscula): devolve todos, o ativo primeiro e, entre
// iguais, o mais antigo, para o painel mostrar a escolha.

const prisma = require('../db');
const { slugCurso } = require('./vitrine');

async function cursosPeloEndereco(endereco) {
  const alvo = String(endereco || '').toLowerCase();
  const todos = await prisma.curso.findMany({ select: { id: true, nome: true, ativo: true, criadoEm: true }, orderBy: { criadoEm: 'asc' } });
  return todos.filter((c) => slugCurso(c.nome) === alvo).sort((a, b) => Number(b.ativo) - Number(a.ativo));
}

module.exports = { cursosPeloEndereco };
