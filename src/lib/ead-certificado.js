// lib/ead-certificado.js
//
// Certificado do curso online (EAD, etapa 3). Mesmo modelo, mesmo Livro/Registro e mesma Redação do
// presencial (lib/certificado.js, lib/redacao.js), com o selo CURSO ONLINE, a modalidade a distância,
// a data de conclusão e a ressalva de que não inclui prática em manequim.
// Spec: docs/superpowers/specs/2026-11-06-ead-certificado.md

const cert = require('./certificado');

const MAX_NO_CERTIFICADO = cert.MAX_NO_CERTIFICADO;

// dd/mm/aaaa no fuso do Rio (a conclusão às 23h de um dia não pode virar o dia seguinte em UTC).
function dataRio(d) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
}

// Assinaturas do curso, sem o instrutor (o online não tem turma). Sem escolha válida: a primeira da lista.
function assinaturasDoCurso(curso, ajustes) {
  const lista = [];
  for (const chave of cert.escolhaDoCurso(curso)) {
    if (chave === 'instrutor') continue;
    const a = ajustes.assinantes[Number(chave.slice(1))];
    if (a && a.nome) lista.push({ nome: a.nome, cargo: a.cargo });
  }
  if (!lista.length) {
    const primeira = ajustes.assinantes.find((a) => a && a.nome);
    if (primeira) lista.push({ nome: primeira.nome, cargo: primeira.cargo });
  }
  return lista.slice(0, MAX_NO_CERTIFICADO);
}

// Tudo o que o modelo imprime para o aluno do curso online, no formato de dadosDoCertificado + online.
// curso: o Curso com os extras anexados (nomeCertificado, certAssinaturas…); modulos: [{ titulo, final }].
function dadosCertificadoEad({ usuario, curso, modulos, numero, concluidoEm, ajustes, documentoAluno }) {
  const doc = documentoAluno(usuario);
  const concluido = dataRio(concluidoEm);
  const ordem = [...modulos.filter((m) => !m.final), ...modulos.filter((m) => m.final)];
  return {
    online: true,
    nome: String(usuario.nome || '').trim(),
    portador: cert.portador(usuario.genero),
    documento: doc ? { tipo: doc.tipo.split(' ·')[0], numero: doc.numero } : null,
    curso: (curso.nomeCertificado || curso.nome).trim(),
    cargaHoraria: `${String(curso.cargaHoraria).padStart(2, '0')} ${curso.cargaHoraria === 1 ? 'hora' : 'horas'}`,
    periodo: { frase: `concluído em ${concluido}`, curta: concluido },
    concluidoEm: concluido,
    emitidoEm: cert.emitidoEm(numero.emitidoEm || new Date()),
    assinaturas: assinaturasDoCurso(curso, ajustes),
    instrutorNome: '',
    instrutorRegistro: '',
    livro: numero.livro,
    registro: numero.registro,
    validade: (curso.certificadoValidade || '').trim(),
    conteudo: ordem.map((m) => m.titulo),
  };
}

module.exports = { dadosCertificadoEad, assinaturasDoCurso, dataRio };
