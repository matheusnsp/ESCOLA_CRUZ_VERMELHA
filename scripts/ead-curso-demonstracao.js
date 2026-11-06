// scripts/ead-curso-demonstracao.js [--refazer]
//
// Cria no banco (o do .env) um curso online de DEMONSTRAÇÃO todo preenchido: 4 módulos com tópicos,
// telas, perguntas (8 por módulo, o que libera o pré-teste), o módulo final com 2 cenários, tudo
// validado, com preço e link de teste. O curso presencial fica desativado e o online fora do site: nada
// aparece para o público até alguém publicar no painel. Conteúdo: scripts/dados/ead-demonstracao.js.
//   --refazer  apaga a demonstração anterior (se ninguém comprou) e cria de novo.

require('dotenv').config();
const prisma = require('../src/db');
const eadTeste = require('../src/lib/ead-teste');
const dados = require('./dados/ead-demonstracao');

// A alternativa certa vem primeiro nos dados; aqui ela muda de lugar de uma pergunta para outra.
const girar = (lista, i) => lista.map((x, k, l) => l[(k + i) % l.length]);
const ordenar = (alts, i) => girar(alts.map((texto, k) => ({ texto, correta: k === 0 })), i);

async function removerCursoDemonstracao(nome = dados.curso.nome) {
  const curso = await prisma.curso.findFirst({ where: { nome }, include: { online: true } });
  if (!curso) return false;
  if (await prisma.matricula.count({ where: { turma: { cursoId: curso.id } } })) {
    throw new Error(`"${nome}" já tem matrícula: apague pelo painel, não por aqui.`);
  }
  if (curso.online) {
    await eadTeste.desligar(curso.online.id);
    await prisma.cursoOnline.delete({ where: { id: curso.online.id } }); // conteúdo e progresso vão junto
  }
  await prisma.turma.deleteMany({ where: { cursoId: curso.id } });
  await prisma.curso.delete({ where: { id: curso.id } });
  return true;
}

async function criarCursoDemonstracao({ nome = dados.curso.nome } = {}) {
  const agora = new Date();
  const validado = { status: 'VALIDADO', validadoPor: 'SISTEMA', validadoEm: agora };
  const curso = await prisma.curso.create({
    data: { nome, descricao: dados.curso.descricao, cargaHoraria: dados.curso.cargaHoraria, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false },
  });
  const co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: dados.curso.precoOnline, publicado: false } });
  let n = 0;
  for (const [mi, m] of dados.modulos.entries()) {
    const modulo = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, ordem: mi, titulo: m.titulo, minutosEstimados: m.minutos, introducao: m.introducao, ...validado } });
    for (const [ti, t] of m.topicos.entries()) {
      await prisma.topicoEad.create({
        data: {
          moduloId: modulo.id, ordem: ti, titulo: t.titulo,
          telas: { create: t.telas.map((tela, k) => ({ ordem: k, ...tela, videoTitulo: tela.titulo })) },
          perguntas: {
            create: t.perguntas.map(([enunciado, feedback, alts]) => ({
              enunciado, feedback, tipo: 'UNICA',
              alternativas: { create: ordenar(alts, n++).map((a, k) => ({ ...a, ordem: k })) },
            })),
          },
        },
      });
    }
  }
  const f = dados.final;
  const final = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, ordem: dados.modulos.length, titulo: f.titulo, minutosEstimados: f.minutos, introducao: f.introducao, final: true, ...validado } });
  for (const [ci, c] of f.cenarios.entries()) {
    await prisma.cenarioEad.create({
      data: {
        moduloId: final.id, ordem: ci, titulo: c.titulo, cena: c.cena, tempoSugeridoSeg: c.tempo,
        decisoes: {
          create: c.decisoes.map(([pergunta, opcoes], di) => ({
            ordem: di, pergunta,
            opcoes: { create: girar(opcoes, di + ci).map(([texto, correta, feedback], k) => ({ ordem: k, texto, correta, feedback })) },
          })),
        },
      },
    });
  }
  const codigo = await eadTeste.gerarCodigo(co.id);
  return { curso, co, codigo };
}

async function main() {
  const refazer = process.argv.includes('--refazer');
  const existe = await prisma.curso.findFirst({ where: { nome: dados.curso.nome } });
  if (existe && !refazer) {
    console.log(`"${dados.curso.nome}" já existe. Para apagar e criar de novo: node scripts/ead-curso-demonstracao.js --refazer`);
    return;
  }
  if (existe) await removerCursoDemonstracao();
  const { curso, co, codigo } = await criarCursoDemonstracao();
  const site = 'http://localhost:3000';
  console.log(`Curso criado: ${curso.nome}`);
  console.log(`  Link de teste (sem pagar):  ${site}/ead-teste/${codigo}`);
  console.log(`  Página de venda:            ${site}/online/${curso.id}  (abre depois de "Publicar no site")`);
  console.log(`  No painel:                  http://localhost:3001/ead/curso/${co.id}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}

module.exports = { criarCursoDemonstracao, removerCursoDemonstracao };
