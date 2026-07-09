// ============================================================
//  DADOS DE EXEMPLO (cursos + turmas)
//  -----------------------------------------------------------
//  Apenas para desenvolvimento/demonstração. Em produção a
//  SECRETARIA cadastra os cursos pelo painel admin (outro site).
//  Ligar/desligar: env SEED_EXEMPLO="true".
//  Remover do banco depois:  npm run db:seed:limpar
// ============================================================

// FOTOS: deixadas em branco (null) de propósito — cada card mostra um slot
// "Foto a definir". Para usar a foto oficial de um curso, troque o respectivo
// imagemUrl abaixo pela URL da imagem e rode: npm run db:seed

const CURSOS_EXEMPLO = [
  {
    nome: 'Primeiros Socorros Básicos',
    descricao: 'Atendimento inicial de emergências com diretrizes oficiais.',
    imagemUrl: null, // <- cole aqui a URL da foto oficial deste curso
    cargaHoraria: 4,
    escolaridadeMinima: 'Ensino Fundamental',
    precoCheio: 155.0,
    precoAvista: 150.0,
    parcelas: 2,
    valorParcela: 77.5,
    turma: { inicio: '2026-07-03', fim: null, horario: '18:00-22:00', dias: '1 encontro — Sexta' },
  },
  {
    nome: 'Primeiros Socorros em Ambientes com Crianças (Lei Lucas)',
    descricao: 'Capacitação essencial. Inclui Stop the Bleed.',
    imagemUrl: null, // <- cole aqui a URL da foto oficial deste curso
    cargaHoraria: 8,
    escolaridadeMinima: 'Ensino Fundamental',
    precoCheio: 155.0,
    precoAvista: 150.0,
    parcelas: 2,
    valorParcela: 77.5,
    turma: { inicio: '2026-07-01', fim: '2026-07-08', horario: '18:00-22:00', dias: '2 encontros — Quartas (01/07 e 08/07)' },
  },
  {
    nome: 'Bombeiro Civil',
    descricao: 'Formação para atuação em prevenção e combate a incêndios.',
    imagemUrl: null, // <- cole aqui a URL da foto oficial deste curso
    cargaHoraria: 80,
    escolaridadeMinima: 'Ensino Médio',
    precoCheio: 990.0,
    precoAvista: 950.0,
    parcelas: 5,
    valorParcela: 198.0,
    turma: { inicio: '2026-07-07', fim: '2026-09-10', horario: '18:00-22:00', dias: 'Terças e Quintas' },
  },
  {
    nome: 'Formação de Cuidador de Idosos (Curso Livre)',
    descricao: 'Cuidados, segurança e bem-estar no atendimento ao idoso.',
    imagemUrl: null, // <- cole aqui a URL da foto oficial deste curso
    cargaHoraria: 160,
    escolaridadeMinima: 'Ensino Fundamental',
    precoCheio: 990.0,
    precoAvista: 950.0,
    parcelas: 5,
    valorParcela: 198.0,
    turma: { inicio: '2026-07-06', fim: '2026-11-30', horario: '18:00-22:00', dias: 'Segundas e Quartas' },
  },
  {
    nome: 'Punção Venosa',
    descricao: 'Técnica de acesso venoso periférico com segurança.',
    imagemUrl: null, // <- cole aqui a URL da foto oficial deste curso
    cargaHoraria: 8,
    escolaridadeMinima: 'Ensino Médio',
    precoCheio: 155.0,
    precoAvista: 150.0,
    parcelas: 2,
    valorParcela: 77.5,
    turma: { inicio: '2026-07-03', fim: null, horario: '18:00-22:00', dias: '2 encontros — Sextas' },
  },
  {
    nome: 'Micropigmentação Labial',
    descricao: 'Procedimento estético de micropigmentação dos lábios.',
    imagemUrl: null, // <- cole aqui a URL da foto oficial deste curso
    cargaHoraria: 24,
    escolaridadeMinima: 'Ensino Médio',
    precoCheio: 455.0,
    precoAvista: 400.0,
    parcelas: 2,
    valorParcela: 227.5,
    turma: { inicio: '2026-07-06', fim: '2026-07-17', horario: '18:00-22:00', dias: 'Segundas, Terças e Quintas' },
  },
];

// Campos de exibição atualizados ao re-semear (refresca exemplos já criados).
function camposExibicao(c) {
  return {
    descricao: c.descricao,
    imagemUrl: c.imagemUrl,
    escolaridadeMinima: c.escolaridadeMinima,
    cargaHoraria: c.cargaHoraria,
    precoCheio: c.precoCheio,
    precoAvista: c.precoAvista,
    parcelas: c.parcelas,
    valorParcela: c.valorParcela,
  };
}

// Insere (ou atualiza) os cursos/turmas de exemplo. Idempotente.
async function inserirExemplos(prisma) {
  for (const c of CURSOS_EXEMPLO) {
    const { turma, ...dadosCurso } = c;
    let curso = await prisma.curso.findFirst({ where: { nome: dadosCurso.nome } });
    if (!curso) {
      curso = await prisma.curso.create({ data: dadosCurso });
      console.log(`[exemplo] Curso criado: ${curso.nome}`);
    } else {
      curso = await prisma.curso.update({ where: { id: curso.id }, data: camposExibicao(c) });
      console.log(`[exemplo] Curso atualizado: ${curso.nome}`);
    }
    const jaTemTurma = await prisma.turma.findFirst({ where: { cursoId: curso.id } });
    if (!jaTemTurma) {
      await prisma.turma.create({
        data: {
          cursoId: curso.id,
          inicioPrevisto: new Date(turma.inicio + 'T18:00:00'),
          vagas: 30,
          minimoAlunos: 15,
          status: 'ABERTA',
          aulas: {
            create: [
              { data: new Date(turma.inicio), horario: turma.horario },
            ],
          },
        },
      });
      console.log(`[exemplo] Turma criada para: ${curso.nome}`);
    }
  }
}

// Remove os cursos/turmas de exemplo. Pula os que têm matrícula (proteção).
async function removerExemplos(prisma) {
  const nomes = CURSOS_EXEMPLO.map((c) => c.nome);
  const cursos = await prisma.curso.findMany({ where: { nome: { in: nomes } }, include: { turmas: true } });

  for (const curso of cursos) {
    const turmaIds = curso.turmas.map((t) => t.id);
    const matriculas = turmaIds.length
      ? await prisma.matricula.count({ where: { turmaId: { in: turmaIds } } })
      : 0;
    if (matriculas > 0) {
      console.log(`[exemplo] PULANDO "${curso.nome}": tem ${matriculas} matrícula(s).`);
      continue;
    }
    await prisma.turma.deleteMany({ where: { cursoId: curso.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    console.log(`[exemplo] Removido: ${curso.nome}`);
  }
}

module.exports = { CURSOS_EXEMPLO, inserirExemplos, removerExemplos };
