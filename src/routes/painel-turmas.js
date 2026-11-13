// routes/painel-turmas.js
//
// Resumo da turma (telas novas de Cursos e Turmas, 2026-11-13; spec docs/superpowers/specs/2026-11-13-cursos-turmas-
// telas-design.md): a turma abre num resumo com cartões (dados, alunos, boas-vindas, notas, QR, certificados) e a caixa
// de cancelar/excluir. Montado em routes/admin.js: require('./painel-turmas')({ requirePermissao, auditar }).
const express = require('express');
const prisma = require('../db');
const extras = require('../lib/extras');
const { faltasTurma } = require('../lib/curso-secoes');

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const VAGA = { taxaConfirmada: true, statusPagamento: { in: ['PAGO', 'PARCELADO', 'PENDENTE'] } };

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Busca da lista de turmas pelo nome do curso (sem acento).
function filtrarPorCurso(turmas, q) {
  const n = semAcento(q);
  return n ? turmas.filter((t) => semAcento(t.curso && t.curso.nome).includes(n)) : turmas;
}

const ddmm = (d) => { const x = new Date(d); return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };

// Frase da próxima mudança automática (lib/concluir-turmas.js): Aberta -> Confirmada à 00:00 do início;
// Confirmada -> Concluída no dia seguinte à última aula.
function proximaMudanca(t, agora = new Date()) {
  if (t.status === 'ABERTA' && new Date(t.inicioPrevisto) > agora) return `vira Confirmada sozinha à 00:00 de ${ddmm(t.inicioPrevisto)}`;
  if (t.status === 'CONFIRMADA') {
    const ultimo = (t.aulas || []).reduce((m, a) => (!m || new Date(a.data) > m ? new Date(a.data) : m), null) || new Date(t.inicioPrevisto);
    const seguinte = new Date(Date.UTC(ultimo.getUTCFullYear(), ultimo.getUTCMonth(), ultimo.getUTCDate() + 1));
    return `vira Concluída sozinha em ${ddmm(seguinte)}`;
  }
  return null;
}

module.exports = function painelTurmas({ requirePermissao }) {
  const router = express.Router();

  router.get(`/turmas/:id(${ID})`, requirePermissao('turmas:gerenciar'), async (req, res) => {
    const turma = await prisma.turma.findUnique({ where: { id: req.params.id }, include: { curso: true, aulas: { orderBy: { data: 'asc' } } } });
    if (!turma) return res.status(404).render('admin/erro', { mensagem: 'Turma não encontrada.' });
    if (turma.status === 'EM_ESPERA') return res.redirect('/turmas?erro=' + encodeURIComponent('A turma de espera não pode ser editada.'));
    if (turma.status === 'ONLINE') return res.redirect('/turmas?erro=' + encodeURIComponent('A turma do curso online não é editada aqui: use o modo Online do painel.'));
    await extras.anexar('turma', [turma]);
    const [inscritos, pendentes, total] = await Promise.all([
      prisma.matricula.count({ where: { turmaId: turma.id, ...VAGA } }),
      prisma.matricula.count({ where: { turmaId: turma.id, taxaConfirmada: true, statusPagamento: 'PENDENTE' } }),
      prisma.matricula.count({ where: { turmaId: turma.id } }),
    ]);
    const faltas = faltasTurma({ totalAulas: turma.aulas.length, inscritos, minimoAlunos: turma.minimoAlunos, pendentes, inicioPrevisto: turma.inicioPrevisto });
    res.render('admin/turma-resumo', { turma, inscritos, pendentes, totalMatriculas: total, faltas, mudanca: proximaMudanca(turma), ok: req.query.ok || null, erro: req.query.erro || null });
  });

  return router;
};
module.exports.filtrarPorCurso = filtrarPorCurso;
module.exports.proximaMudanca = proximaMudanca;
