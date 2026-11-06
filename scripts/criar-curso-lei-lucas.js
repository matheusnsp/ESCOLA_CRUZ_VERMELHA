// scripts/criar-curso-lei-lucas.js [--gravar]
//
// Cria o primeiro curso online de verdade, "Primeiros Socorros na Escola — Lei Lucas", no banco do
// DATABASE_URL: curso só online, 7 módulos + "Juntando tudo", tudo em RASCUNHO, sem preço, fora do site e
// sem link de teste. Conteúdo: scripts/dados/curso-lei-lucas.js.
//
// Depois, no painel (Online → Cursos online): a área técnica revisa cada módulo, cola o vídeo de cada
// tela (o painel só valida com vídeo), valida, define preço e publica (docs/ead/como-publicar-um-curso.md).
//
//   sem --gravar  só mostra o que seria criado e em qual banco (não grava nada)
//   --gravar      grava. Se já existir um curso com o mesmo nome, não faz nada.

require('dotenv').config();
const prisma = require('../src/db');
const { pendencias } = require('../src/lib/ead');
const cursoOnline = require('../src/lib/ead-curso-online');
const { enderecoOnlineEmUso } = require('../src/lib/ead-acesso');
const { urlOnline } = require('../src/lib/vitrine');
const DADOS = require('./dados/curso-lei-lucas');

// A alternativa certa vem primeiro nos dados; aqui ela muda de lugar de uma pergunta para outra.
const girar = (lista, i) => lista.map((x, k, l) => l[(k + i) % l.length]);

// Os dados no formato do banco (e de lib/ead.js pendencias()), na ordem em que serão gravados.
function arvore(d = DADOS) {
  let n = 0;
  const comuns = d.modulos.map((m, mi) => ({
    ordem: mi, titulo: m.titulo, minutosEstimados: m.minutos, introducao: m.introducao, final: false, cenarios: [],
    topicos: m.topicos.map((t, ti) => ({
      ordem: ti, titulo: t.titulo,
      telas: t.telas.map((tela, k) => ({ ordem: k, ...tela, videoUrl: null, videoTitulo: tela.titulo })),
      perguntas: t.perguntas.map(([enunciado, feedback, alts]) => ({
        tipo: 'UNICA', ativa: true, enunciado, feedback,
        alternativas: girar(alts.map((texto, k) => ({ texto, correta: k === 0 })), n++).map((a, k) => ({ ...a, ordem: k })),
      })),
    })),
  }));
  const f = d.final;
  const final = {
    ordem: comuns.length, titulo: f.titulo, minutosEstimados: f.minutos, introducao: f.introducao, final: true, topicos: [],
    cenarios: f.cenarios.map((c, ci) => ({
      ordem: ci, titulo: c.titulo, cena: c.cena, tempoSugeridoSeg: c.tempo,
      decisoes: c.decisoes.map(([pergunta, opcoes], di) => ({
        ordem: di, pergunta,
        opcoes: girar(opcoes, di + ci).map(([texto, correta, feedback], k) => ({ ordem: k, texto, correta, feedback })),
      })),
    })),
  };
  return [...comuns, final];
}

// Grava tudo numa transação só: ou o curso entra inteiro, ou nada entra.
async function criarCurso(d = DADOS) {
  const v = cursoOnline.validar(d.curso);
  if (v.erro) return { ok: false, erro: v.erro };
  if (await cursoOnline.nomeEmUso(v.dados.nome) || await enderecoOnlineEmUso(v.dados.nome)) {
    return { ok: false, erro: `Já existe um curso com o nome "${v.dados.nome}" (ou com o mesmo endereço no site). Nada foi gravado.` };
  }
  const mods = arvore(d);
  const r = await prisma.$transaction(async (tx) => {
    const curso = await tx.curso.create({ data: { ...v.dados, imagemUrl: '/img/capa.webp', precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    const co = await tx.cursoOnline.create({ data: { cursoId: curso.id, somenteOnline: true } });
    for (const m of mods) {
      await tx.moduloEad.create({
        data: {
          cursoOnlineId: co.id, ordem: m.ordem, titulo: m.titulo, minutosEstimados: m.minutosEstimados, introducao: m.introducao, final: m.final,
          topicos: {
            create: m.topicos.map((t) => ({
              ordem: t.ordem, titulo: t.titulo,
              telas: { create: t.telas.map((tela) => ({ ...tela })) },
              perguntas: { create: t.perguntas.map(({ ativa, alternativas, ...q }) => ({ ...q, ativa, alternativas: { create: alternativas } })) },
            })),
          },
          cenarios: {
            create: m.cenarios.map((c) => ({
              ordem: c.ordem, titulo: c.titulo, cena: c.cena, tempoSugeridoSeg: c.tempoSugeridoSeg,
              decisoes: { create: c.decisoes.map((dc) => ({ ordem: dc.ordem, pergunta: dc.pergunta, opcoes: { create: dc.opcoes } })) },
            })),
          },
        },
      });
    }
    await tx.logAuditoria.create({ data: { atorId: 'SISTEMA', acao: 'EAD_CRIOU_CURSO_SCRIPT', alvoTipo: 'CursoOnline', alvoId: co.id, detalhe: { nome: curso.nome, script: 'scripts/criar-curso-lei-lucas.js' } } });
    return { curso, co };
  }, { timeout: 120000, maxWait: 20000 });
  return { ok: true, ...r };
}

function resumo(d = DADOS) {
  const mods = arvore(d);
  const linhas = mods.map((m, i) => {
    const pend = pendencias(m);
    const semVideo = pend.filter((p) => /sem vídeo/.test(p)).length;
    const outras = pend.length - semVideo;
    const conteudo = m.final ? `${m.cenarios.length} cenários` : `${m.topicos.length} tópicos, ${m.topicos.reduce((s, t) => s + t.telas.length, 0)} telas, ${m.topicos.reduce((s, t) => s + t.perguntas.length, 0)} perguntas`;
    return `  ${i + 1}. ${m.titulo} (${m.minutosEstimados} min): ${conteudo}${semVideo ? ` — faltam ${semVideo} vídeos` : ''}${outras ? ` — ${outras} outras pendências` : ''}`;
  });
  return linhas.join('\n');
}

function bancoDestino() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch (e) { return '(DATABASE_URL não definido)'; }
}

async function main() {
  const gravar = process.argv.includes('--gravar');
  console.log(`Curso: ${DADOS.curso.nome}`);
  console.log(`Banco: ${bancoDestino()}`);
  console.log(resumo());
  if (!gravar) {
    console.log('\nNada foi gravado. Para gravar, rode de novo com --gravar.');
    return;
  }
  const r = await criarCurso();
  if (!r.ok) { console.error(`\n${r.erro}`); process.exitCode = 1; return; }
  console.log('\nCurso criado em RASCUNHO, fora do site.');
  console.log(`  No painel: Online → Cursos online → "${r.curso.nome}"  (/ead/curso/${r.co.id})`);
  console.log(`  Endereço no site, depois de publicar: ${urlOnline(r.curso)}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}

module.exports = { arvore, criarCurso, resumo };
