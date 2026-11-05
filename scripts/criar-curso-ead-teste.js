// scripts/criar-curso-ead-teste.js
//
// Cria um curso online de TESTE, preenchido com os exemplos do documento "O primeiro EAD da Cruz
// Vermelha Rio" (Exemplos A, B e C e o mapa dos 8 módulos), para ver o painel e o link de teste
// funcionando. O conteúdo clínico é ILUSTRATIVO (o documento diz que passa pela área técnica).
// Os vídeos são um link qualquer do YouTube só para o player aparecer.
// Só roda contra banco local. Rodar de novo apaga o curso de teste anterior e cria outro.
//
//   node scripts/criar-curso-ead-teste.js

require('dotenv').config();
const prisma = require('../src/db');
const eadTeste = require('../src/lib/ead-teste');

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')) {
  console.error('Só roda com DATABASE_URL local (localhost). Nada foi feito.');
  process.exit(1);
}

const NOME = 'Primeiros Socorros — Lei Lucas (teste EAD)';
const VIDEO = 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ'; // só para o player aparecer

const P = (enunciado, alternativas, certa, feedback) => ({ enunciado, feedback, alternativas: alternativas.map((texto, i) => ({ texto, correta: i === certa, ordem: i })) });

const MODULOS = [
  {
    titulo: 'Antes de tudo', min: 20, foto: '/img/capa.webp',
    intro: 'Primeiros socorros começam antes de tocar em alguém: olhar se a cena é segura, se proteger e chamar ajuda do jeito certo.\n\nNeste módulo você aprende o seu papel numa emergência, o que a lei pede de você e o lema que vai aparecer em todo o curso: OLHAR, LIGAR, CUIDAR.',
    topicos: [
      {
        titulo: 'Seu papel numa emergência',
        telas: [
          { titulo: 'Você é o primeiro elo', ancora: 'Entre o mal súbito e a chegada do SAMU passam, em média, de 10 a 15 minutos. Quem está perto — a professora, o porteiro, a merendeira — é quem decide o que acontece nesse tempo.', revisaoTitulo: 'o que se espera de você', revisao: ['Manter a calma e a cena segura.', 'Chamar ajuda cedo: 192 ou 193.', 'Fazer o que sabe, sem se arriscar.', 'Ficar com a vítima até o socorro chegar.'], alerta: 'Omissão de socorro é crime (Art. 135 do Código Penal). Ligar para o 192 já é prestar socorro.' },
          { titulo: 'OLHAR, LIGAR, CUIDAR', ancora: 'Toda emergência do curso começa pelas mesmas três palavras. Elas cabem numa camiseta e ajudam a não travar quando o susto vem.', revisaoTitulo: 'o lema', revisao: ['OLHAR: a cena e a pessoa.', 'LIGAR: 192 (SAMU) ou 193 (Bombeiros).', 'CUIDAR: até o socorro chegar.', 'Em alguns casos, cuidar vem antes de ligar.'], alerta: 'Afogamento e engasgo de criança são exceções: cuide primeiro por 2 minutos e depois ligue, se estiver sozinho.' },
        ],
        perguntas: [
          P('Você encontra um colega caído no corredor. Qual é a primeira coisa a fazer?', ['Virar a pessoa de lado', 'Olhar se a cena é segura', 'Dar água', 'Ir buscar o diretor'], 1, 'Olhar vem primeiro: se a cena não for segura, você vira a segunda vítima.'),
          P('Qual número chama o SAMU?', ['190', '192', '193', '199'], 1, '192 é o SAMU. 193 são os Bombeiros, que também atendem e transferem quando preciso.'),
          P('Ligar para o 192 e ficar com a vítima conta como prestar socorro?', ['Sim', 'Não, é preciso fazer algum procedimento'], 0, 'Sim. A lei pede que você ajude no limite do que sabe; chamar o socorro e acompanhar já é socorro.'),
          P('No lema do curso, o que vem depois de OLHAR?', ['CUIDAR', 'LIGAR', 'ESPERAR', 'CORRER'], 1, 'OLHAR, LIGAR, CUIDAR, com as exceções que o curso mostra (afogamento e engasgo de criança).'),
        ],
      },
      {
        titulo: 'Proteção e consentimento',
        telas: [
          { titulo: 'Luvas e mãos limpas', ancora: 'Sangue e secreções podem transmitir doenças. Antes de cuidar, proteja as mãos — com luvas ou, sem elas, com um saco plástico.', revisaoTitulo: 'proteção', revisao: ['Luvas sempre que houver sangue.', 'Sem luva: saco plástico limpo.', 'Lave as mãos depois, mesmo com luva.', 'Descarte a luva virando do avesso.'], alerta: 'Nunca deixe de socorrer por falta de luva: improvise a barreira e siga.' },
        ],
        perguntas: [
          P('Sem luvas e com uma criança sangrando, o que fazer?', ['Esperar alguém trazer luvas', 'Usar um saco plástico limpo como barreira', 'Pressionar com a mão nua', 'Mandar a criança lavar'], 1, 'Improvise a barreira e aja: o sangramento não espera.'),
          P('Depois de usar luvas, lavar as mãos é necessário?', ['Sim', 'Não'], 0, 'Sim: a luva pode ter furos pequenos e a retirada pode contaminar.'),
          P('Para socorrer um aluno menor de idade sem os pais por perto, você:', ['Precisa esperar autorização dos pais', 'Pode e deve socorrer', 'Só pode ligar, sem tocar', 'Precisa da direção da escola'], 1, 'Em emergência, o socorro ao menor não depende de autorização (ECA). Avise os responsáveis assim que possível.'),
          P('Ao tirar a luva usada, o certo é:', ['Puxar pelos dedos', 'Virar do avesso, sem tocar o lado de fora', 'Lavar e guardar', 'Jogar no chão'], 1, 'Virar do avesso prende o material contaminado do lado de dentro.'),
        ],
      },
    ],
  },
  { titulo: 'Parada cardíaca no adulto', min: 25, intro: 'Infarto e parada não são a mesma coisa. Aqui você aprende a reconhecer a parada, começar a RCP e usar o DEA.', topicos: [{ titulo: 'Reconhecer a parada', telas: [], perguntas: [] }] },
  { titulo: 'Parada cardíaca na criança e no bebê', min: 20, intro: 'Na criança, a parada quase sempre começa na respiração. O afogamento é a primeira causa.', topicos: [] },
  {
    titulo: 'Engasgo', min: 20, foto: '/img/sede-rj.webp',
    intro: 'Pipoca, uva, salsicha, bala: o engasgo acontece rápido e em silêncio, muitas vezes no recreio ou na hora do lanche.\n\nNeste módulo você aprende a diferenciar o engasgo leve do grave em segundos e o que fazer em cada idade.',
    topicos: [
      {
        titulo: 'Reconhecer o engasgo',
        telas: [
          { titulo: 'Sinais de que é grave', ancora: 'Nem todo engasgo é igual. Tossir com força é bom sinal; o silêncio é o que assusta.', revisaoTitulo: 'leve ou grave', revisao: ['Tosse forte e fala: leve.', 'Sem voz e sem tosse: grave.', 'Som agudo ao respirar: grave.', 'Lábios roxos: emergência de vida.'], alerta: 'O engasgo grave é silencioso: se a criança parou de fazer barulho, aja.' },
          { titulo: 'Criança no recreio', foto: '/img/capa.webp', ancora: 'Uma criança de 6 anos está comendo no pátio quando para de rir, leva as mãos ao pescoço e não consegue falar. Você tem segundos para decidir se ela ainda está respirando — e isso muda tudo o que vem depois.', videoTitulo: 'Como diferenciar o engasgo leve do grave', dur: 130, revisaoTitulo: 'os 4 sinais', revisao: ['Mãos no pescoço — o sinal universal.', 'Tosse forte e consegue falar → leve. Incentive a tossir.', 'Som agudo, sem voz, sem tosse → grave. Aja agora.', 'Lábios ou pele arroxeando → já é emergência de vida.'], alerta: 'Se a criança tosse com força, não bata nas costas: você pode transformar um engasgo leve num grave. Fique ao lado e espere a tosse resolver.', dica: 'Pergunte "você está engasgado?". Quem acena com a cabeça e não fala está em engasgo grave.' },
        ],
        perguntas: [
          P('No recreio, um aluno de 7 anos começa a tossir com força depois de engolir um pedaço de pão. Ele está vermelho, mas consegue dizer "tá preso". O que você faz primeiro?', ['Dou 5 tapas firmes nas costas', 'Dou água para ajudar a descer', 'Fico ao lado, incentivo a tossir e observo', 'Ligo para o 192 e aguardo sem intervir'], 2, 'Correto. Tosse forte e voz = via aérea só parcialmente obstruída; o corpo está resolvendo. Tapas nas costas agora podem deslocar o pedaço para pior. Se a tosse parar ou ele perder a voz, aí sim: tapas e compressões.'),
          P('Qual destes é sinal de engasgo grave?', ['Tosse forte', 'Choro alto', 'Sem voz e sem tosse', 'Rosto vermelho falando'], 2, 'Sem voz e sem tosse: o ar não passa. É hora de agir.'),
          P('A criança engasgada tosse forte. Dar água ajuda?', ['Sim', 'Não'], 1, 'Não: a água pode ir para a via aérea e piorar. Deixe a tosse trabalhar.'),
          P('Qual é o "sinal universal" do engasgo?', ['Apontar para a boca', 'Mãos no pescoço', 'Bater no peito', 'Levantar os braços'], 1, 'Mãos no pescoço: ensine os alunos a usar esse sinal.'),
          P('Lábios ficando roxos durante um engasgo indicam:', ['Que está passando', 'Falta de oxigênio: emergência de vida', 'Frio', 'Alergia'], 1, 'Cor roxa = pouco oxigênio no sangue. Aja e peça para alguém ligar 192.'),
        ],
      },
      {
        titulo: 'Adulto e criança',
        telas: [
          { titulo: 'Tapas e compressões', ancora: 'No engasgo grave de adulto e criança acima de 1 ano, alterne 5 tapas nas costas e 5 compressões abdominais até o objeto sair ou a pessoa desmaiar.', revisaoTitulo: 'a sequência', revisao: ['Incline a pessoa para frente.', '5 tapas firmes entre as escápulas.', '5 compressões abdominais.', 'Repita até sair ou desmaiar.'], alerta: 'Se a pessoa desmaiar, deite no chão, ligue 192 e comece a RCP.' },
        ],
        perguntas: [
          P('No engasgo grave em adulto, quantos tapas nas costas antes das compressões?', ['2', '5', '10', '30'], 1, '5 tapas, depois 5 compressões, alternando.'),
          P('A pessoa engasgada desmaiou. E agora?', ['Continuar as compressões em pé', 'Deitar no chão, ligar 192 e começar RCP', 'Dar água', 'Esperar acordar'], 1, 'Desmaiou: chão, 192 e RCP. A compressão do tórax também ajuda a soltar o objeto.'),
          P('As compressões abdominais no engasgo são feitas:', ['No peito', 'Acima do umbigo, para dentro e para cima', 'Nas costas', 'No pescoço'], 1, 'Punho fechado acima do umbigo, puxando para dentro e para cima.'),
        ],
      },
    ],
  },
  { titulo: 'Mal súbito', min: 25, intro: 'Asma, alergia grave, diabetes, convulsão, AVC: o que fazer até o socorro chegar.', topicos: [] },
  { titulo: 'Sangramento grave', min: 10, intro: 'Uma lata de 350 ml de sangue perdido já é grave. Pressão direta é o que salva.', topicos: [] },
  { titulo: 'Lesões e ambiente', min: 15, intro: 'Queimaduras, quedas, calor, frio, intoxicação e animais peçonhentos.', topicos: [] },
];

const FINAL = {
  titulo: 'Juntando tudo', min: 20,
  intro: 'Agora é com você. Cinco cenas do dia a dia da escola, com cronômetro. Não existe reprovação por tempo: o que importa é decidir.',
  cenarios: [
    { titulo: 'Pânico na hora do lanche', cena: 'Creche municipal, 15h. Dona Lúcia, a merendeira, vê que o Davi, 2 anos, parou de mastigar, está com os olhos arregalados e não faz som nenhum. A professora saiu para buscar os outros. Você é o adulto mais perto.', seg: 240,
      decisoes: [{ pergunta: 'O que você faz primeiro?', opcoes: [['OLHAR', false, 'Olhar é sempre bom, mas você já viu: o Davi não respira. Não há tempo a perder.'], ['LIGAR', false, 'Você não tem telefone na mão e ninguém por perto. Primeiro, socorra.'], ['CUIDAR', true, 'Você não tem telefone na mão e o Davi não respira. Isso é uma situação de cuidar primeiro: comece agora e grite por ajuda. Boa escolha.']] }] },
    { titulo: 'Colega na sala dos professores', cena: 'Intervalo. Um colega de 52 anos diz que sente um aperto no peito e fica pálido, suando frio.', seg: 240,
      decisoes: [{ pergunta: 'O que você faz primeiro?', opcoes: [['OLHAR', false, 'Você já percebeu os sinais; agora é hora de chamar ajuda.'], ['LIGAR', true, 'Isso: dor no peito com suor frio pode ser infarto. Ligue 192 já.'], ['CUIDAR', false, 'Deixe-o sentado e calmo, mas o mais importante agora é ligar.']] }] },
  ],
};

(async () => {
  const antigo = await prisma.curso.findFirst({ where: { nome: NOME } });
  if (antigo) {
    const co = await prisma.cursoOnline.findUnique({ where: { cursoId: antigo.id } });
    if (co) { await eadTeste.desligar(co.id); await prisma.cursoOnline.delete({ where: { id: co.id } }); }
    await prisma.curso.delete({ where: { id: antigo.id } });
  }
  const curso = await prisma.curso.create({
    data: { nome: NOME, descricao: 'Capacitação teórica para professores e funcionários de escolas e creches, como pede a Lei Lucas. No seu ritmo, pelo celular.', cargaHoraria: 3, precoAvista: 0, precoCheio: 0, valorParcela: 0, imagemUrl: '/img/capa.webp', ativo: false },
  });
  const co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });

  let ordem = 0;
  for (const m of MODULOS) {
    await prisma.moduloEad.create({
      data: {
        cursoOnlineId: co.id, ordem: ordem++, titulo: m.titulo, minutosEstimados: m.min, introducao: m.intro, fotoIntroUrl: m.foto || null,
        topicos: {
          create: (m.topicos || []).map((t, ti) => ({
            ordem: ti, titulo: t.titulo,
            telas: { create: t.telas.map((x, i) => ({ ordem: i, titulo: x.titulo, ancora: x.ancora, fotoUrl: x.foto || null, videoUrl: VIDEO, videoTitulo: x.videoTitulo || x.titulo, videoDuracaoSeg: x.dur || 120, revisaoTitulo: x.revisaoTitulo, revisaoItens: x.revisao, alerta: x.alerta, dicaProfissional: x.dica || null })) },
            perguntas: { create: t.perguntas.map((q) => ({ enunciado: q.enunciado, feedback: q.feedback, alternativas: { create: q.alternativas } })) },
          })),
        },
      },
    });
  }
  await prisma.moduloEad.create({
    data: {
      cursoOnlineId: co.id, ordem: ordem++, titulo: FINAL.titulo, minutosEstimados: FINAL.min, introducao: FINAL.intro, final: true,
      cenarios: { create: FINAL.cenarios.map((c, i) => ({ ordem: i, titulo: c.titulo, cena: c.cena, tempoSugeridoSeg: c.seg, decisoes: { create: c.decisoes.map((d, di) => ({ ordem: di, pergunta: d.pergunta, opcoes: { create: d.opcoes.map(([texto, correta, feedback], oi) => ({ ordem: oi, texto, correta, feedback })) } })) } })) },
    },
  });

  const codigo = await eadTeste.gerarCodigo(co.id);
  const site = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  console.log(`Curso de teste criado: ${NOME}`);
  console.log(`Painel (modo Online): /ead/curso/${co.id}`);
  console.log(`Link de teste: ${site}/ead-teste/${codigo}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
