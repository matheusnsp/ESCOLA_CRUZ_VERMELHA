#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * PATCH — prospecção por WhatsApp na tela /alunos
 *
 * Aplica três edições em src/routes/admin.js:
 *
 *   1. acrescenta montarLinkProspeccao ao import de lib/lembretes
 *   2. substitui a rota GET /alunos (carrega turmas abertas + histórico
 *      de prospecção, e monta o link de cada linha)
 *   3. acrescenta a rota POST /alunos/:id/prospeccao
 *
 * Por que um script em vez do arquivo inteiro: o admin.js tem ~1900
 * linhas e a mudança são 3 trechos. Redigitar o arquivo todo coloca em
 * risco as 1897 linhas que NÃO mudam. Aqui o seu arquivo é a fonte da
 * verdade — só os 3 pontos são tocados.
 *
 * COMO USAR (na raiz do projeto):
 *
 *   node patch-prospeccao.js
 *
 * Faz backup em src/routes/admin.js.bak antes de mexer. Se algo der
 * errado, é só restaurar:
 *
 *   cp src/routes/admin.js.bak src/routes/admin.js
 *
 * Rodar duas vezes é seguro: ele detecta que já foi aplicado e para.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const ALVO = path.join(process.cwd(), 'src', 'routes', 'admin.js');

function sair(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(ALVO)) {
  sair(`Não encontrei ${ALVO}\n   Rode este script na RAIZ do projeto (onde fica a pasta src/).`);
}

let src = fs.readFileSync(ALVO, 'utf8');

// ── Já aplicado? ────────────────────────────────────────────────────────
if (src.includes('/alunos/:id/prospeccao')) {
  console.log('\n✓ O patch já está aplicado neste arquivo. Nada a fazer.\n');
  process.exit(0);
}

// ── Backup ──────────────────────────────────────────────────────────────
fs.writeFileSync(ALVO + '.bak', src);
console.log(`\n📦 Backup salvo em ${ALVO}.bak`);

// ═══════════════════════════════════════════════════════════════════════
// EDIÇÃO 1 — import
// ═══════════════════════════════════════════════════════════════════════
const IMPORT_ANTIGO = `const { enviarLembreteAvulso, montarPendencia, montarLinkWhats } = require('../lib/lembretes');`;
const IMPORT_NOVO = `const { enviarLembreteAvulso, montarPendencia, montarLinkWhats, montarLinkProspeccao } = require('../lib/lembretes');`;

if (!src.includes(IMPORT_ANTIGO)) {
  sair(
    'Não encontrei a linha de import de lib/lembretes no formato esperado.\n' +
    '   Esperado:\n   ' + IMPORT_ANTIGO + '\n\n' +
    '   Aplique a mão: acrescente montarLinkProspeccao a essa lista.'
  );
}
src = src.replace(IMPORT_ANTIGO, IMPORT_NOVO);
console.log('✓ 1/3 — import atualizado');

// ═══════════════════════════════════════════════════════════════════════
// EDIÇÃO 2 — rota GET /alunos
// ═══════════════════════════════════════════════════════════════════════
const GET_ANTIGO = `  try {
    const [alunos, total, turmas] = await Promise.all([
      prisma.usuario.findMany({
        where,
        orderBy: { nome: 'asc' },
        take: 200,
        include: { _count: { select: { matriculas: true } } }
      }),
      prisma.usuario.count({ where }),
      prisma.turma.findMany({ orderBy: { criadoEm: 'desc' }, include: { curso: true } }),
    ]);

    res.render('admin/alunos', { 
      alunos, 
      total,
      busca, 
      inscricao,
      turmas,
      turmaId,
      ok: req.query.ok || null,
      mascarar 
    });`;

const GET_NOVO = `  try {
    const [alunos, total, turmas, turmasAbertas] = await Promise.all([
      prisma.usuario.findMany({
        where,
        orderBy: { nome: 'asc' },
        take: 200,
        include: { _count: { select: { matriculas: true } } }
      }),
      prisma.usuario.count({ where }),
      prisma.turma.findMany({ orderBy: { criadoEm: 'desc' }, include: { curso: true } }),

      // 💡 NOVO — Turmas realmente abertas e que ainda não começaram. É o que
      // o texto de prospecção vai oferecer, puxado na hora pra nunca citar
      // turma que já lotou ou passou da data.
      prisma.turma.findMany({
        where: { status: 'ABERTA', inicioPrevisto: { gt: new Date() } },
        orderBy: { inicioPrevisto: 'asc' },
        include: { curso: true },
      }),
    ]);

    // 💡 NOVO — Quem já recebeu abordagem, e quando. Sai do LogAuditoria em
    // vez de uma coluna nova em Usuario: a informação já estava sendo gravada
    // de qualquer forma, e assim não precisa de migration.
    const idsNaTela = alunos.map((a) => a.id);
    const logsProspeccao = idsNaTela.length
      ? await prisma.logAuditoria.findMany({
          where: { acao: 'CONTATO_PROSPECCAO', alvoId: { in: idsNaTela } },
          orderBy: { criadoEm: 'desc' },
        })
      : [];

    const prospeccaoEm = {};
    for (const log of logsProspeccao) {
      if (!prospeccaoEm[log.alvoId]) prospeccaoEm[log.alvoId] = log.criadoEm;
    }

    // Só quem tem ZERO inscrições ganha link de convite.
    const linhas = alunos.map((a) => ({
      ...a,
      linkProspeccao: a._count.matriculas === 0
        ? montarLinkProspeccao(a, turmasAbertas)
        : null,
      prospeccaoEm: prospeccaoEm[a.id] || null,
    }));

    res.render('admin/alunos', { 
      alunos: linhas, 
      total,
      busca, 
      inscricao,
      turmas,
      turmaId,
      ok: req.query.ok || null,
      erro: req.query.erro || null,
      mascarar 
    });`;

if (!src.includes(GET_ANTIGO)) {
  sair(
    'Não encontrei o corpo da rota GET /alunos no formato esperado.\n' +
    '   Provavelmente ela já foi editada. Aplique a mão usando o\n' +
    '   admin-alunos-colar.js.txt como referência.'
  );
}
src = src.replace(GET_ANTIGO, GET_NOVO);
console.log('✓ 2/3 — rota GET /alunos atualizada');

// ═══════════════════════════════════════════════════════════════════════
// EDIÇÃO 3 — nova rota POST /alunos/:id/prospeccao
// Inserida logo antes do GET /alunos/:id/editar.
// ═══════════════════════════════════════════════════════════════════════
const ANCORA = `router.get('/alunos/:id/editar', requirePermissao('aluno:gerenciar'), async (req, res) => {`;

const ROTA_NOVA = `// 💡 NOVO — Convite por WhatsApp para quem nunca se inscreveu.
//
// Por que um POST que só redireciona, em vez de um <a href> direto pro
// wa.me: abordagem fria precisa de rastro. Se aparecer reclamação, tem que
// dar pra saber quem mandou, pra quem e quando. Um link não passa pelo
// servidor e não deixaria registro nenhum.
//
// O formulário na view usa target="_blank", então o WhatsApp abre em aba
// nova e a listagem continua onde estava.
router.post('/alunos/:id/prospeccao', requirePermissao('aluno:gerenciar'), async (req, res) => {
  const voltarErro = (msg) => res.redirect('/alunos?inscricao=sem&erro=' + encodeURIComponent(msg));

  const aluno = await prisma.usuario.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { matriculas: true } } },
  });

  if (!aluno || aluno.papel !== 'ALUNO') {
    return res.status(404).render('admin/erro', { mensagem: 'Aluno nao encontrado.' });
  }

  // Guarda contra corrida: entre carregar a tela e clicar, a pessoa pode ter
  // se inscrito. Mandar "vi que você não se inscreveu" nessa hora seria ruim.
  if (aluno._count.matriculas > 0) {
    return voltarErro(\`\${aluno.nome.split(' ')[0]} já tem inscrição — a lista estava desatualizada.\`);
  }

  const turmasAbertas = await prisma.turma.findMany({
    where: { status: 'ABERTA', inicioPrevisto: { gt: new Date() } },
    orderBy: { inicioPrevisto: 'asc' },
    include: { curso: true },
  });

  const link = montarLinkProspeccao(aluno, turmasAbertas);
  if (!link) {
    return voltarErro(\`\${aluno.nome.split(' ')[0]} não tem celular válido cadastrado.\`);
  }

  await auditar(req, 'CONTATO_PROSPECCAO', 'Usuario', aluno.id, {
    turmasOferecidas: [...new Set(turmasAbertas.map((t) => t.curso.nome))].slice(0, 3),
  });

  return res.redirect(link);
});

`;

if (!src.includes(ANCORA)) {
  sair('Não encontrei a rota GET /alunos/:id/editar para usar como âncora.');
}
src = src.replace(ANCORA, ROTA_NOVA + ANCORA);
console.log('✓ 3/3 — rota POST /alunos/:id/prospeccao inserida');

// ── Grava e valida ──────────────────────────────────────────────────────
fs.writeFileSync(ALVO, src);

try {
  new (require('vm').Script)(src, { filename: ALVO });
  console.log('✓ Sintaxe do arquivo validada\n');
} catch (e) {
  fs.writeFileSync(ALVO, fs.readFileSync(ALVO + '.bak', 'utf8'));
  sair(`Erro de sintaxe após o patch: ${e.message}\n   O arquivo original foi RESTAURADO do backup.`);
}

console.log('🎉 Patch aplicado. Reinicie o servidor e abra /alunos?inscricao=sem\n');
