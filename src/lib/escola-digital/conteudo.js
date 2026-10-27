// lib/escola-digital/conteudo.js
//
// Conteúdo dos cursos online em arquivos JSON (curso.json + modulo-NN.json), a validação desse
// conteúdo e a carga dele no banco. A validação é função pura (sem banco); a carga recebe o
// cliente do Prisma. A carga NUNCA apaga conteúdo: apagar tela, tópico ou módulo leva junto o
// progresso dos alunos (onDelete: Cascade), então o que sumiu dos arquivos só vira aviso.

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const PASTA_CONTEUDO = path.join(RAIZ, 'conteudo', 'escola-digital');
const OPCOES_PRIMEIRA_DECISAO = ['OLHAR', 'LIGAR', 'CUIDAR'];

// ---------- leitura ----------

// "primeiros-socorros" vira conteudo/escola-digital/primeiros-socorros; qualquer coisa com
// barra (ou caminho absoluto) é tratada como caminho.
function resolverPasta(arg) {
  const s = String(arg || '').trim();
  if (s && !/[\\/]/.test(s)) return path.join(PASTA_CONTEUDO, s);
  return path.resolve(s);
}

// Lê { curso, modulos[] } de uma pasta. Caminho relativo conta a partir da raiz do projeto.
function lerPasta(pasta) {
  const dir = path.isAbsolute(pasta) ? pasta : path.join(RAIZ, pasta);
  const ler = (arquivo) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, arquivo), 'utf8'));
    } catch (e) {
      throw new Error(`Não foi possível ler ${arquivo} em ${dir}: ${e.message}`);
    }
  };
  const arquivos = fs.readdirSync(dir).filter((f) => /^modulo-\d+\.json$/.test(f)).sort();
  return { curso: ler('curso.json'), modulos: arquivos.map(ler) };
}

// Só localhost / 127.0.0.1 contam como banco local (host exato, não "contém"). Os parâmetros
// ?host= e ?hostaddr= da URL valem mais que o host do endereço (Prisma/libpq): se existirem,
// todos os valores também precisam ser locais (caminho de socket, começando com "/", conta).
function ehBancoLocal(urlBanco) {
  const local = (h) => {
    const v = String(h).trim().toLowerCase();
    return v === 'localhost' || v === '127.0.0.1' || v.startsWith('/');
  };
  try {
    const url = new URL(String(urlBanco || ''));
    if (!local(url.hostname)) return false;
    for (const chave of ['host', 'hostaddr']) {
      for (const valor of url.searchParams.getAll(chave)) {
        // lista separada por vírgula também é aceita pelo libpq: confere cada item
        if (!valor.split(',').every(local)) return false;
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- validação ----------

const ehTexto = (v) => typeof v === 'string' && v.trim() !== '';
const ehInteiro = (v, min) => Number.isInteger(v) && v >= min;
const ehNumero = (v, min) => typeof v === 'number' && Number.isFinite(v) && v >= min;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Devolve a lista de erros (vazia = conteúdo ok). Cada erro diz onde está o problema.
function validarCurso(dados) {
  const erros = [];
  const erro = (onde, msg) => erros.push(`${onde}: ${msg}`);

  if (!ehObjeto(dados)) return ['conteúdo: esperado um objeto { curso, modulos }'];
  const { curso, modulos } = dados;

  // curso
  if (!ehObjeto(curso)) {
    erro('curso', 'ausente');
  } else {
    if (!ehTexto(curso.nome)) erro('curso.nome', 'obrigatório');
    if (curso.descricao != null && typeof curso.descricao !== 'string') erro('curso.descricao', 'deve ser texto');
    if (curso.descricaoLonga != null && typeof curso.descricaoLonga !== 'string') erro('curso.descricaoLonga', 'deve ser texto');
    if (!ehInteiro(curso.cargaHoraria, 1)) erro('curso.cargaHoraria', 'inteiro maior que zero (horas)');
    if (!ehNumero(curso.precoAvista, 0)) erro('curso.precoAvista', 'número a partir de zero');
    if (!ehNumero(curso.precoCheio, 0)) erro('curso.precoCheio', 'número a partir de zero');
    if (!ehInteiro(curso.parcelas, 1)) erro('curso.parcelas', 'inteiro a partir de 1');
    if (!ehInteiro(curso.prazoAcessoDias, 1)) erro('curso.prazoAcessoDias', 'inteiro maior que zero');
    if (!ehInteiro(curso.validadeCertificadoMeses, 1)) erro('curso.validadeCertificadoMeses', 'inteiro maior que zero');
    if (curso.imagemUrl != null && typeof curso.imagemUrl !== 'string') erro('curso.imagemUrl', 'deve ser texto');
    if (curso.videoSubstituto != null && !ehTexto(curso.videoSubstituto)) erro('curso.videoSubstituto', 'deve ser texto (id do vídeo) ou null');
  }

  if (!Array.isArray(modulos) || modulos.length === 0) {
    erro('modulos', 'precisa de ao menos um módulo');
    return erros;
  }

  // chave única dentro de uma lista; devolve a função que registra
  const unicas = (onde) => {
    const vistas = new Set();
    return (chave) => {
      if (vistas.has(chave)) erro(onde, `chave repetida "${chave}"`);
      vistas.add(chave);
    };
  };
  const registrarModulo = unicas('modulos');
  const ordens = new Set();

  modulos.forEach((m, i) => {
    const mo = `modulos[${i}]`;
    if (!ehObjeto(m)) return erro(mo, 'esperado um objeto');
    if (!ehTexto(m.chave)) erro(`${mo}.chave`, 'obrigatória'); else registrarModulo(m.chave);
    if (!ehInteiro(m.ordem, 1)) erro(`${mo}.ordem`, 'inteiro a partir de 1');
    else {
      if (ordens.has(m.ordem)) erro(`${mo}.ordem`, `ordem repetida ${m.ordem}`);
      ordens.add(m.ordem);
    }
    if (!ehTexto(m.titulo)) erro(`${mo}.titulo`, 'obrigatório');
    if (!ehInteiro(m.minutos, 0)) erro(`${mo}.minutos`, 'inteiro a partir de zero');
    if (m.abertura != null && typeof m.abertura !== 'string') erro(`${mo}.abertura`, 'deve ser texto');
    if (typeof m.temPreTeste !== 'boolean') erro(`${mo}.temPreTeste`, 'deve ser true ou false');
    if (typeof m.final !== 'boolean') erro(`${mo}.final`, 'deve ser true ou false');

    // tópicos, telas e perguntas
    if (!Array.isArray(m.topicos)) erro(`${mo}.topicos`, 'deve ser uma lista (pode ser vazia)');
    const registrarTopico = unicas(`${mo}.topicos`);
    (Array.isArray(m.topicos) ? m.topicos : []).forEach((t, j) => {
      const to = `${mo}.topicos[${j}]`;
      if (!ehObjeto(t)) return erro(to, 'esperado um objeto');
      if (!ehTexto(t.chave)) erro(`${to}.chave`, 'obrigatória'); else registrarTopico(t.chave);
      if (!ehTexto(t.titulo)) erro(`${to}.titulo`, 'obrigatório');

      if (!Array.isArray(t.telas)) erro(`${to}.telas`, 'deve ser uma lista');
      const registrarTela = unicas(`${to}.telas`);
      (Array.isArray(t.telas) ? t.telas : []).forEach((tela, k) => {
        const lo = `${to}.telas[${k}]`;
        if (!ehObjeto(tela)) return erro(lo, 'esperado um objeto');
        if (!ehTexto(tela.chave)) erro(`${lo}.chave`, 'obrigatória'); else registrarTela(tela.chave);
        if (!ehTexto(tela.titulo)) erro(`${lo}.titulo`, 'obrigatório');
        if (!ehTexto(tela.ancora)) erro(`${lo}.ancora`, 'obrigatória');
        for (const campo of ['imagemUrl', 'imagemAlt', 'alerta', 'dica']) {
          if (tela[campo] != null && typeof tela[campo] !== 'string') erro(`${lo}.${campo}`, 'deve ser texto');
        }
        if (tela.revisao != null) {
          if (!Array.isArray(tela.revisao) || !tela.revisao.every(ehTexto)) erro(`${lo}.revisao`, 'deve ser uma lista de textos');
          else if (tela.revisao.length > 4) erro(`${lo}.revisao`, `no máximo 4 itens (tem ${tela.revisao.length})`);
        }
        if (tela.video != null) {
          const v = tela.video;
          if (!ehObjeto(v) || !ehTexto(v.id) || !ehTexto(v.titulo) || (v.segundos != null && !ehInteiro(v.segundos, 0))) {
            erro(`${lo}.video`, 'esperado { id, titulo, segundos? }');
          }
        }
      });

      if (!Array.isArray(t.perguntas)) erro(`${to}.perguntas`, 'deve ser uma lista');
      const registrarPergunta = unicas(`${to}.perguntas`);
      (Array.isArray(t.perguntas) ? t.perguntas : []).forEach((p, k) => {
        const po = `${to}.perguntas[${k}]`;
        if (!ehObjeto(p)) return erro(po, 'esperado um objeto');
        if (!ehTexto(p.chave)) erro(`${po}.chave`, 'obrigatória'); else registrarPergunta(p.chave);
        if (!ehTexto(p.enunciado)) erro(`${po}.enunciado`, 'obrigatório');
        if (!ehTexto(p.porque)) erro(`${po}.porque`, 'obrigatório');
        const alts = p.alternativas;
        if (!Array.isArray(alts) || alts.length < 3 || alts.length > 5 || !alts.every(ehTexto)) {
          erro(`${po}.alternativas`, 'de 3 a 5 textos');
        } else if (!ehInteiro(p.correta, 0) || p.correta >= alts.length) {
          erro(`${po}.correta`, `índice fora das alternativas (0 a ${alts.length - 1})`);
        }
      });
    });

    // cenários
    if (m.cenarios != null && !Array.isArray(m.cenarios)) erro(`${mo}.cenarios`, 'deve ser uma lista');
    const cenarios = Array.isArray(m.cenarios) ? m.cenarios : [];
    if (m.final === true && cenarios.length === 0) erro(`${mo}.cenarios`, 'módulo final precisa de cenários');
    const registrarCenario = unicas(`${mo}.cenarios`);
    cenarios.forEach((c, j) => {
      const co = `${mo}.cenarios[${j}]`;
      if (!ehObjeto(c)) return erro(co, 'esperado um objeto');
      if (!ehTexto(c.chave)) erro(`${co}.chave`, 'obrigatória'); else registrarCenario(c.chave);
      if (!ehTexto(c.titulo)) erro(`${co}.titulo`, 'obrigatório');
      if (!ehTexto(c.cena)) erro(`${co}.cena`, 'obrigatória');
      if (!ehInteiro(c.tempoSugerido, 1)) erro(`${co}.tempoSugerido`, 'inteiro em segundos, maior que zero');
      if (!Array.isArray(c.decisoes) || c.decisoes.length === 0) return erro(`${co}.decisoes`, 'precisa de ao menos uma decisão');
      c.decisoes.forEach((d, k) => {
        const dO = `${co}.decisoes[${k}]`;
        if (!ehObjeto(d)) return erro(dO, 'esperado um objeto');
        if (!ehTexto(d.pergunta)) erro(`${dO}.pergunta`, 'obrigatória');
        if (!ehTexto(d.fala)) erro(`${dO}.fala`, 'obrigatória');
        if (!Array.isArray(d.opcoes) || d.opcoes.length !== 3 || !d.opcoes.every(ehTexto)) {
          erro(`${dO}.opcoes`, 'exatamente 3 textos');
        } else if (!ehInteiro(d.correta, 0) || d.correta > 2) {
          erro(`${dO}.correta`, 'índice fora das opções (0 a 2)');
        }
        if (k === 0 && JSON.stringify(d.opcoes) !== JSON.stringify(OPCOES_PRIMEIRA_DECISAO)) {
          erro(`${dO}.opcoes`, `a 1ª decisão do cenário usa exatamente ${JSON.stringify(OPCOES_PRIMEIRA_DECISAO)} (OLHAR, LIGAR, CUIDAR)`);
        }
      });
    });
  });

  return erros;
}

// ---------- carga no banco ----------

const arredondar2 = (n) => Math.round(n * 100) / 100;

// Carrega a pasta no banco. Upsert por chave (dentro do pai); nunca apaga. O que está no banco
// e sumiu dos arquivos fica como está e vira aviso; só as perguntas ausentes ficam ativa=false
// (e voltam a ativa=true se reaparecerem). Tudo numa transação: falhou, nada mudou.
async function carregarCurso(pasta, prisma) {
  const dados = lerPasta(pasta);
  const erros = validarCurso(dados);
  if (erros.length) throw new Error(`Conteúdo inválido:\n - ${erros.join('\n - ')}`);
  const { curso, modulos } = dados;

  const contagem = { criados: 0, atualizados: 0, desativadas: 0 };
  const avisos = [];

  // Cria ou atualiza e conta. `atual` é a linha achada (ou null).
  const gravar = async (delegate, atual, criar, atualizar) => {
    if (atual) {
      contagem.atualizados++;
      return delegate.update({ where: { id: atual.id }, data: atualizar });
    }
    contagem.criados++;
    return delegate.create({ data: criar });
  };

  const cursoId = await prisma.$transaction(async (tx) => {
    // curso: ONLINE + nome (o Curso não tem chave)
    const dadosCurso = {
      nome: curso.nome,
      descricao: curso.descricao ?? null,
      descricaoLonga: curso.descricaoLonga ?? null,
      cargaHoraria: curso.cargaHoraria,
      imagemUrl: curso.imagemUrl ?? null,
      precoAvista: curso.precoAvista,
      precoCheio: curso.precoCheio,
      parcelas: curso.parcelas,
      valorParcela: arredondar2(curso.precoCheio / curso.parcelas),
      prazoAcessoDias: curso.prazoAcessoDias,
      validadeCertificadoMeses: curso.validadeCertificadoMeses,
    };
    const cursoAtual = await tx.curso.findFirst({ where: { modalidade: 'ONLINE', nome: curso.nome } });
    // Ao atualizar não mexe em `ativo` nem na taxa: quem desativou o curso na secretaria manda.
    const cursoGravado = await gravar(
      tx.curso, cursoAtual,
      { ...dadosCurso, modalidade: 'ONLINE', taxaMatricula: null, ativo: true },
      dadosCurso,
    );

    const chavesModulos = new Set(modulos.map((m) => m.chave));
    const modulosNoBanco = await tx.moduloOnline.findMany({ where: { cursoId: cursoGravado.id } });
    for (const antigo of modulosNoBanco) {
      if (!chavesModulos.has(antigo.chave)) avisos.push(`Módulo "${antigo.chave}" está no banco e não está nos arquivos: mantido sem alteração.`);
    }

    for (const m of modulos) {
      const moduloAtual = modulosNoBanco.find((x) => x.chave === m.chave) || null;
      const dadosModulo = {
        ordem: m.ordem, titulo: m.titulo, minutos: m.minutos, abertura: m.abertura ?? null,
        imagemUrl: m.imagemUrl ?? null, temPreTeste: m.temPreTeste, final: m.final,
      };
      const modulo = await gravar(tx.moduloOnline, moduloAtual, { cursoId: cursoGravado.id, chave: m.chave, ...dadosModulo }, dadosModulo);

      // tópicos
      const topicosNoBanco = moduloAtual ? await tx.topicoOnline.findMany({ where: { moduloId: modulo.id } }) : [];
      const chavesTopicos = new Set(m.topicos.map((t) => t.chave));
      for (const antigo of topicosNoBanco) {
        if (!chavesTopicos.has(antigo.chave)) avisos.push(`Tópico "${m.chave}/${antigo.chave}" está no banco e não está nos arquivos: mantido sem alteração.`);
      }
      for (const [ti, t] of m.topicos.entries()) {
        const topicoAtual = topicosNoBanco.find((x) => x.chave === t.chave) || null;
        const dadosTopico = { ordem: ti + 1, titulo: t.titulo };
        const topico = await gravar(tx.topicoOnline, topicoAtual, { moduloId: modulo.id, chave: t.chave, ...dadosTopico }, dadosTopico);

        // telas
        const telasNoBanco = topicoAtual ? await tx.telaOnline.findMany({ where: { topicoId: topico.id } }) : [];
        const chavesTelas = new Set(t.telas.map((x) => x.chave));
        for (const antiga of telasNoBanco) {
          if (!chavesTelas.has(antiga.chave)) avisos.push(`Tela "${m.chave}/${t.chave}/${antiga.chave}" está no banco e não está nos arquivos: mantida sem alteração.`);
        }
        for (const [li, tela] of t.telas.entries()) {
          const telaAtual = telasNoBanco.find((x) => x.chave === tela.chave) || null;
          const dadosTela = {
            ordem: li + 1, titulo: tela.titulo, ancora: tela.ancora,
            imagemUrl: tela.imagemUrl ?? null, imagemAlt: tela.imagemAlt ?? null,
            videoId: tela.video?.id ?? curso.videoSubstituto ?? null,
            videoTitulo: tela.video?.titulo ?? null,
            videoSegundos: tela.video?.segundos ?? null,
            revisao: tela.revisao ?? [],
            alerta: tela.alerta ?? null, dica: tela.dica ?? null,
          };
          await gravar(tx.telaOnline, telaAtual, { topicoId: topico.id, chave: tela.chave, ...dadosTela }, dadosTela);
        }

        // perguntas: as que sumiram dos arquivos ficam inativas (as respostas antigas continuam valendo)
        const perguntasNoBanco = topicoAtual ? await tx.perguntaOnline.findMany({ where: { topicoId: topico.id } }) : [];
        const chavesPerguntas = new Set(t.perguntas.map((x) => x.chave));
        for (const antiga of perguntasNoBanco) {
          if (!chavesPerguntas.has(antiga.chave) && antiga.ativa) {
            await tx.perguntaOnline.update({ where: { id: antiga.id }, data: { ativa: false } });
            contagem.desativadas++;
          }
        }
        for (const p of t.perguntas) {
          const perguntaAtual = perguntasNoBanco.find((x) => x.chave === p.chave) || null;
          const dadosPergunta = {
            enunciado: p.enunciado, alternativas: p.alternativas, correta: p.correta, porque: p.porque, ativa: true,
          };
          await gravar(tx.perguntaOnline, perguntaAtual, { topicoId: topico.id, chave: p.chave, ...dadosPergunta }, dadosPergunta);
        }
      }

      // cenários e decisões
      const cenarios = m.cenarios || [];
      const cenariosNoBanco = moduloAtual ? await tx.cenarioOnline.findMany({ where: { moduloId: modulo.id } }) : [];
      const chavesCenarios = new Set(cenarios.map((c) => c.chave));
      for (const antigo of cenariosNoBanco) {
        if (!chavesCenarios.has(antigo.chave)) avisos.push(`Cenário "${m.chave}/${antigo.chave}" está no banco e não está nos arquivos: mantido sem alteração.`);
      }
      for (const [ci, c] of cenarios.entries()) {
        const cenarioAtual = cenariosNoBanco.find((x) => x.chave === c.chave) || null;
        const dadosCenario = {
          ordem: ci + 1, titulo: c.titulo, cena: c.cena, imagemUrl: c.imagemUrl ?? null, tempoSugerido: c.tempoSugerido,
        };
        const cenario = await gravar(tx.cenarioOnline, cenarioAtual, { moduloId: modulo.id, chave: c.chave, ...dadosCenario }, dadosCenario);

        const decisoesNoBanco = cenarioAtual ? await tx.decisaoCenario.findMany({ where: { cenarioId: cenario.id } }) : [];
        for (const [di, d] of c.decisoes.entries()) {
          const decisaoAtual = decisoesNoBanco.find((x) => x.ordem === di + 1) || null;
          const dadosDecisao = { pergunta: d.pergunta, opcoes: d.opcoes, correta: d.correta, fala: d.fala };
          await gravar(tx.decisaoCenario, decisaoAtual, { cenarioId: cenario.id, ordem: di + 1, ...dadosDecisao }, dadosDecisao);
        }
        const sobrando = decisoesNoBanco.filter((x) => x.ordem > c.decisoes.length);
        if (sobrando.length) {
          avisos.push(`Cenário "${m.chave}/${c.chave}": ${sobrando.length} decisão(ões) a mais no banco (ordem ${sobrando.map((x) => x.ordem).join(', ')}): mantida(s) sem alteração.`);
        }
      }
    }
    return cursoGravado.id;
  }, { timeout: 120000, maxWait: 20000 });

  return { cursoId, ...contagem, avisos };
}

module.exports = { validarCurso, lerPasta, resolverPasta, ehBancoLocal, carregarCurso, OPCOES_PRIMEIRA_DECISAO };
