// Conteúdo do curso online de demonstração (scripts/ead-curso-demonstracao.js): Primeiros Socorros na
// Escola, como pede a Lei Lucas (Lei 13.722/2018). Serve para ver a plataforma toda preenchida; antes de
// vender, o conteúdo real passa pela revisão técnica da Escola.
//
// Pergunta: [enunciado, porquê, [alternativa certa, errada, errada]] — a certa vem primeiro aqui e é
// embaralhada na gravação. Opção de cenário: [texto, certa?, fala do instrutor].

const t = (titulo, ancora, revisaoTitulo, revisaoItens, alerta, dicaProfissional = null) => ({ titulo, ancora, revisaoTitulo, revisaoItens, alerta, dicaProfissional });

module.exports = {
  curso: {
    nome: 'Primeiros Socorros na Escola (demonstração)',
    descricao: 'Capacitação teórica para professores e funcionários de escolas e creches, como pede a Lei Lucas. No seu ritmo, pelo celular.',
    cargaHoraria: 3,
    precoOnline: 49.9,
  },
  modulos: [
    {
      titulo: 'Antes de tudo', minutos: 15,
      introducao: 'Quem está perto decide o que acontece nos primeiros minutos. Aqui você aprende a chegar com segurança e a pedir ajuda do jeito certo.',
      topicos: [
        {
          titulo: 'Você é o primeiro elo',
          telas: [
            t('O que a Lei Lucas pede', 'A Lei 13.722/2018, a Lei Lucas, obriga escolas e espaços de recreação infantil a capacitar professores e funcionários em primeiros socorros. O objetivo não é virar profissional de saúde: é manter a vítima viva até o socorro chegar.',
              'o que se espera de você', ['Manter a calma.', 'Chamar ajuda cedo.', 'Fazer o que sabe, sem se arriscar.', 'Ficar com a vítima até o socorro chegar.'],
              'Omissão de socorro é crime (Art. 135 do Código Penal). Ligar para o 192 já é prestar socorro.'),
            t('Cena segura primeiro', 'Antes de chegar perto, olhe em volta: fios soltos, trânsito, fogo, vidro quebrado, briga. Um socorrista ferido é mais uma vítima, e ninguém ajuda ninguém.',
              'pare, olhe, pense', ['Veja o que causou o acidente.', 'Afaste as outras crianças.', 'Só tire a vítima do lugar se ficar for mais perigoso.', 'Havendo sangue, use luvas ou um saco plástico nas mãos.'],
              'Não vire a segunda vítima.', 'Deixe um kit com luvas descartáveis em cada andar e no pátio.'),
          ],
          perguntas: [
            ['A Lei Lucas obriga a capacitação de quem?', 'A lei vale para professores e funcionários de escolas e de espaços de recreação infantil, públicos e privados.', ['Professores e funcionários de escolas e de espaços de recreação infantil', 'Somente os pais dos alunos', 'Somente enfermeiros escolares']],
            ['Você vê um acidente no pátio. O que fazer primeiro?', 'Antes de tudo, confira se a cena é segura para você e para as crianças em volta.', ['Conferir se a cena é segura', 'Correr até a vítima', 'Levar a vítima de carro ao hospital']],
            ['Quem não é da área da saúde pode deixar de socorrer?', 'Omissão de socorro é crime para qualquer pessoa. Se não puder agir com segurança, pedir ajuda ao 192 já é prestar socorro.', ['Não: pelo menos pedir ajuda é obrigação de todos', 'Sim, socorro é só para profissionais', 'Sim, se a vítima for adulta']],
            ['A criança se cortou e está sangrando. Como proteger suas mãos?', 'Luvas, ou na falta delas um saco plástico, protegem você e a criança.', ['Com luvas ou um saco plástico', 'Não precisa, é só lavar depois', 'Com um pano úmido']],
          ],
        },
        {
          titulo: 'Chamar ajuda',
          telas: [
            t('192 ou 193', 'SAMU (192) para emergências médicas: desmaio, falta de ar, convulsão, parada cardíaca. Bombeiros (193) para resgate: queda de altura, fogo, afogamento, choque elétrico. Os dois se comunicam: ligue para qualquer um e não perca tempo.',
              'o que dizer na ligação', ['Endereço completo e um ponto de referência.', 'O que aconteceu.', 'Idade aproximada e se respira.', 'Não desligue antes do atendente.'],
              'Mande alguém esperar a ambulância no portão da escola.'),
            t('Avaliar a vítima', 'Toque nos ombros e chame alto. Se não responder, olhe o peito por até 10 segundos: ele sobe e desce normalmente? Respiração ausente, ou só "puxadas" de ar espaçadas, é sinal de parada cardíaca.',
              'em 10 segundos', ['Responde ao chamado?', 'Respira normalmente?', 'Não respira ou só "puxa o ar": é parada.', 'Peça o desfibrilador (DEA), se a escola tiver.'],
              'As "puxadas" de ar (gasping) enganam: não são respiração normal.'),
          ],
          perguntas: [
            ['Qual é o número do SAMU?', 'SAMU é 192. Bombeiros é 193. Polícia é 190.', ['192', '190', '199']],
            ['Na ligação para o socorro, o que não pode faltar?', 'Sem endereço e ponto de referência a ambulância não chega.', ['O endereço com um ponto de referência', 'O nome completo dos pais', 'O número da matrícula da criança']],
            ['A vítima não responde e só "puxa o ar" de vez em quando. Isso é:', 'Puxadas de ar espaçadas (gasping) não são respiração normal: trate como parada cardíaca.', ['Sinal de parada cardíaca', 'Respiração normal de quem dorme', 'Sinal de que está acordando']],
            ['Por quanto tempo checar a respiração?', 'No máximo 10 segundos: mais do que isso atrasa a ajuda.', ['Até 10 segundos', 'Um minuto inteiro', 'Até o SAMU chegar']],
          ],
        },
      ],
    },
    {
      titulo: 'Parada cardíaca', minutos: 20,
      introducao: 'Na parada cardíaca, cada minuto sem compressão reduz a chance de sobreviver. Compressões bem feitas mantêm o sangue chegando ao cérebro.',
      topicos: [
        {
          titulo: 'RCP no adulto',
          telas: [
            t('Compressões que salvam', 'Pessoa deitada de costas em superfície firme. Mãos sobrepostas no centro do peito, braços esticados, o peso do corpo empurrando. Comprima rápido e forte e deixe o peito voltar entre uma e outra.',
              'o ritmo certo', ['100 a 120 compressões por minuto.', '5 a 6 cm de profundidade.', 'Deixe o peito voltar todo.', 'Revezem a cada 2 minutos.'],
              'Não pare as compressões por mais de 10 segundos.', 'O ritmo de "Stayin\' Alive" ajuda a manter os 100 a 120 por minuto.'),
            t('O desfibrilador (DEA)', 'O DEA fala o que fazer. Ligue, cole as pás no peito como mostra o desenho e siga a voz. Ele analisa o coração e decide se dá choque.',
              'com o DEA', ['Ligue assim que chegar.', 'Cole as pás no peito sem roupa.', 'Ninguém toca na vítima durante a análise e o choque.', 'Volte às compressões logo depois.'],
              'Afaste todos antes do choque: "Todos afastados!"'),
          ],
          perguntas: [
            ['Qual o ritmo das compressões?', 'O ritmo indicado é de 100 a 120 compressões por minuto.', ['100 a 120 por minuto', '60 por minuto', '200 por minuto']],
            ['Qual a profundidade das compressões no adulto?', 'No adulto, de 5 a 6 cm, deixando o peito voltar.', ['5 a 6 cm', '1 a 2 cm', '10 cm']],
            ['Quem pode usar o DEA?', 'O DEA foi feito para leigos: ele fala cada passo.', ['Qualquer pessoa, seguindo as instruções de voz', 'Só médicos', 'Só bombeiros']],
            ['Durante o choque do DEA, o que fazer?', 'Ninguém pode tocar na vítima na análise e no choque.', ['Afastar todos da vítima', 'Continuar as compressões', 'Segurar a mão da vítima']],
          ],
        },
        {
          titulo: 'RCP na criança e no bebê',
          telas: [
            t('Criança (de 1 ano à puberdade)', 'Uma ou duas mãos no centro do peito, afundando cerca de um terço do peito (uns 5 cm), no mesmo ritmo de 100 a 120 por minuto. Se estiver sozinho e não viu a criança desmaiar, faça 2 minutos de RCP e depois ligue para o 192.',
              'na criança', ['Uma ou duas mãos.', 'Um terço do peito (cerca de 5 cm).', '100 a 120 por minuto.', 'Sozinho e sem ter visto: 2 minutos de RCP antes de ligar.'],
              'Em criança, a parada costuma vir da falta de ar: comece logo.'),
            t('Bebê (menos de 1 ano)', 'Dois dedos no centro do peito, logo abaixo da linha dos mamilos, afundando cerca de 4 cm. Mesmo ritmo: 100 a 120 por minuto.',
              'no bebê', ['Dois dedos no centro do peito.', 'Cerca de 4 cm.', '100 a 120 por minuto.', 'Superfície firme: mesa ou chão.'],
              'Nunca sacuda o bebê para "acordar".'),
          ],
          perguntas: [
            ['Como fazer compressões no bebê?', 'No bebê, use dois dedos no centro do peito, logo abaixo da linha dos mamilos.', ['Com dois dedos no centro do peito', 'Com as duas mãos, como no adulto', 'Com o punho fechado']],
            ['Quanto afundar o peito da criança?', 'Cerca de um terço do peito, uns 5 cm.', ['Cerca de um terço do peito (uns 5 cm)', 'O mínimo possível', 'Metade do peito']],
            ['Quanto afundar o peito do bebê?', 'Cerca de 4 cm.', ['Cerca de 4 cm', 'Cerca de 1 cm', 'Cerca de 8 cm']],
            ['Sozinho, você encontra uma criança desacordada sem respirar (não viu acontecer). O que fazer?', 'Na criança, a parada costuma vir da falta de ar: 2 minutos de RCP antes de ligar dão mais chance.', ['2 minutos de RCP e depois ligar para o 192', 'Ligar e esperar sem tocar na criança', 'Procurar os pais antes de tudo']],
          ],
        },
      ],
    },
    {
      titulo: 'Engasgo', minutos: 15,
      introducao: 'Engasgo com comida ou brinquedo é uma das emergências mais comuns na escola. Saber a manobra certa resolve em segundos.',
      topicos: [
        {
          titulo: 'Criança maior e adulto',
          telas: [
            t('Reconhecer o engasgo', 'Se a pessoa tosse forte, o ar está passando: incentive a tossir e fique perto. Se não consegue tossir, falar ou respirar e leva as mãos ao pescoço, a obstrução é grave.',
              'leve ou grave?', ['Tosse forte: deixe tossir.', 'Sem tosse, sem voz, sem ar: grave.', 'Mãos no pescoço: sinal universal.', 'Lábios roxos: urgência.'],
              'Não bata nas costas de quem está tossindo forte.'),
            t('Manobra de Heimlich', 'Por trás da vítima, punho fechado logo acima do umbigo, a outra mão por cima. Puxe para dentro e para cima, com força, até o objeto sair ou a vítima desmaiar.',
              'passo a passo', ['Por trás, abraçando.', 'Punho acima do umbigo.', 'Puxões para dentro e para cima.', 'Desmaiou: deite, chame o 192 e comece a RCP.'],
              'Em criança pequena, ajoelhe-se para ficar da altura dela.'),
          ],
          perguntas: [
            ['A criança engasgou e tosse forte. O que fazer?', 'Tosse forte quer dizer que o ar passa: incentive a tossir e observe.', ['Incentivar a tossir e observar', 'Dar tapas fortes nas costas', 'Fazer a manobra de Heimlich na hora']],
            ['Qual destes é sinal de engasgo grave?', 'Sem tosse, sem voz e sem ar, o objeto bloqueia a passagem.', ['Não consegue tossir nem falar', 'Tosse alta e forte', 'Fala que está engasgada']],
            ['Onde colocar o punho na manobra de Heimlich?', 'Logo acima do umbigo, bem abaixo do osso do peito.', ['Logo acima do umbigo', 'No pescoço', 'Nas costas']],
            ['Durante a manobra, a vítima desmaia. E agora?', 'Deite no chão, chame o 192 e comece a RCP: as compressões também ajudam a expulsar o objeto.', ['Deitar, chamar o 192 e começar a RCP', 'Continuar a manobra em pé', 'Esperar ela acordar']],
          ],
        },
        {
          titulo: 'Engasgo no bebê',
          telas: [
            t('Tapas e compressões', 'Apoie o bebê de bruços no seu antebraço, cabeça mais baixa que o corpo, segurando a mandíbula. Dê 5 tapas firmes entre as escápulas. Vire o bebê e faça 5 compressões com dois dedos no centro do peito. Repita até sair ou o bebê desmaiar.',
              'no bebê', ['De bruços, cabeça mais baixa.', '5 tapas entre as escápulas.', 'Vire e faça 5 compressões no peito.', 'Repita até resolver.'],
              'Desmaiou: chame o 192 e comece a RCP do bebê.'),
            t('Erros comuns', 'Na pressa, muita gente faz o que piora: enfia o dedo na boca sem ver o objeto, sacode o bebê de cabeça para baixo ou dá água. Tudo isso pode empurrar o objeto para mais longe.',
              'nunca faça', ['Dedo na boca às cegas.', 'Sacudir de cabeça para baixo.', 'Dar água ou comida.', 'Manobra de Heimlich no bebê.'],
              'Só tire o objeto com os dedos se ele estiver visível e fácil de pegar.'),
          ],
          perguntas: [
            ['Quantos tapas nas costas antes de virar o bebê?', 'São 5 tapas entre as escápulas, depois 5 compressões no peito.', ['5', '1', '20']],
            ['Como posicionar o bebê para os tapas?', 'De bruços no antebraço, com a cabeça mais baixa que o corpo.', ['De bruços, com a cabeça mais baixa que o corpo', 'Sentado no colo', 'De pé, segurando pelos braços']],
            ['Pode colocar o dedo na boca do bebê para tirar o objeto?', 'Só se o objeto estiver visível. Às cegas, o dedo empurra o objeto mais para dentro.', ['Só se o objeto estiver visível', 'Sim, sempre', 'Sim, e procurar no fundo da garganta']],
            ['Dar água ajuda a desengasgar?', 'Não: água pode piorar a obstrução.', ['Não', 'Sim, em pequenos goles', 'Sim, se for morna']],
          ],
        },
      ],
    },
    {
      titulo: 'Sangramento, convulsão e desmaio', minutos: 20,
      introducao: 'Três situações que assustam, mas têm conduta simples. O mais importante é saber o que não fazer.',
      topicos: [
        {
          titulo: 'Sangramento',
          telas: [
            t('Pressão direta', 'Com luvas, cubra o ferimento com um pano limpo e pressione firme, sem soltar para olhar. Se o pano encharcar, coloque outro por cima e continue apertando.',
              'para estancar', ['Luvas sempre.', 'Pano limpo e pressão firme.', 'Encharcou: outro pano por cima.', 'Muito sangue: 192.'],
              'Não tire o primeiro pano: o coágulo que está se formando sai junto.'),
            t('Objeto encravado e nariz', 'Objeto encravado no corpo não se retira: prenda-o para não mexer e chame o 192. No sangramento nasal, incline a cabeça levemente para frente e aperte a parte mole do nariz por 10 minutos.',
              'lembre', ['Objeto encravado: não tire.', 'Nariz: cabeça para frente.', 'Aperte a parte mole por 10 minutos.', 'Não volte a cabeça para trás.'],
              'Cabeça para trás faz a criança engolir sangue e vomitar.'),
          ],
          perguntas: [
            ['O ferimento sangra muito. O que fazer?', 'Pressão direta e firme com um pano limpo, sem soltar para olhar.', ['Pressionar firme com um pano limpo', 'Lavar com água corrente e esperar', 'Passar pó de café']],
            ['O pano encharcou de sangue. E agora?', 'Coloque outro por cima: tirar o primeiro desfaz o coágulo.', ['Colocar outro pano por cima e continuar apertando', 'Trocar o pano por um limpo', 'Parar de apertar']],
            ['Há um lápis encravado na perna da criança. O que fazer?', 'Não retire: o objeto pode estar segurando o sangramento. Prenda-o e chame o 192.', ['Não tirar, prender e chamar o 192', 'Tirar com cuidado', 'Empurrar para dentro']],
            ['Sangramento no nariz: como posicionar a cabeça?', 'Levemente para frente, apertando a parte mole do nariz.', ['Levemente para frente', 'Para trás', 'Deitada de barriga para cima']],
          ],
        },
        {
          titulo: 'Convulsão e desmaio',
          telas: [
            t('Convulsão', 'Afaste objetos, proteja a cabeça com algo macio e marque o tempo. Não segure os movimentos e não coloque nada na boca. Quando parar, deixe a criança de lado (posição lateral de segurança).',
              'na crise', ['Afaste objetos e proteja a cabeça.', 'Marque o tempo.', 'Nada na boca, não segure.', 'Depois, de lado.'],
              'Ligue 192 se passar de 5 minutos, se for a primeira crise, se houve ferimento ou se não acordar.'),
            t('Desmaio', 'Deite a pessoa de costas e eleve as pernas, se não houver suspeita de trauma. Afrouxe roupas apertadas e mantenha o local arejado. Se não acordar em cerca de 1 minuto, ligue para o 192 e cheque a respiração.',
              'no desmaio', ['Deite e eleve as pernas.', 'Afrouxe as roupas.', 'Não dê nada para beber.', 'Não acordou em 1 minuto: 192.'],
              'Se não respirar normalmente, comece a RCP.'),
          ],
          perguntas: [
            ['Durante a convulsão, o que NÃO fazer?', 'Nada na boca e não segure os movimentos: isso machuca a criança e você.', ['Colocar algo na boca da criança', 'Proteger a cabeça', 'Marcar o tempo da crise']],
            ['Quando ligar para o 192 numa convulsão?', 'Crise de mais de 5 minutos, primeira crise, ferimento ou se não acorda.', ['Se passar de 5 minutos ou for a primeira crise', 'Nunca, convulsão passa sozinha', 'Só se a criança pedir']],
            ['Depois da convulsão, como deixar a criança?', 'De lado (posição lateral de segurança), para a saliva escorrer e a respiração ficar livre.', ['De lado', 'Sentada', 'De barriga para baixo']],
            ['Alguém desmaiou, sem sinal de queda ou trauma. O que fazer?', 'Deite e eleve as pernas; se não acordar em 1 minuto, ligue para o 192.', ['Deitar e elevar as pernas', 'Dar água com açúcar', 'Sentar e abanar']],
          ],
        },
      ],
    },
  ],
  final: {
    titulo: 'Juntando tudo', minutos: 15,
    introducao: 'Duas situações reais da escola. Você decide o que fazer; o instrutor comenta cada escolha.',
    cenarios: [
      {
        titulo: 'Recreio: queda e silêncio', tempo: 240,
        cena: 'No recreio, o porteiro, de 50 anos, cai no pátio e não se mexe. Várias crianças estão em volta.',
        decisoes: [
          ['O que você faz primeiro?', [
            ['Afasto as crianças e confiro se a cena é segura', true, 'Isso. Cena segura e crianças longe: agora dá para ajudar.'],
            ['Corro e sacudo o porteiro', false, 'Antes, veja se é seguro e afaste as crianças. Sacudir pode piorar uma lesão.'],
            ['Pego o celular para filmar', false, 'O celular serve para ligar para o 192, não para filmar.'],
          ]],
          ['Ele não responde e só "puxa o ar" de vez em quando. E agora?', [
            ['Peço para alguém ligar 192 e trazer o DEA, e começo as compressões', true, 'Exato. "Puxar o ar" assim é parada cardíaca: compressões já.'],
            ['Espero uns minutos para ver se melhora', false, 'Cada minuto sem compressão reduz muito a chance de sobreviver.'],
            ['Sento o porteiro encostado na parede', false, 'Na parada, a vítima fica deitada de costas em superfície firme.'],
          ]],
          ['O desfibrilador chegou.', [
            ['Ligo, colo as pás e sigo a voz, afastando todos no choque', true, 'Perfeito. O DEA guia tudo; você volta às compressões logo depois.'],
            ['Termino 10 minutos de compressões antes de usar', false, 'Use o DEA assim que chegar: o choque precoce salva vidas.'],
            ['Guardo, porque só médico pode usar', false, 'O DEA foi feito para leigos. Ele fala cada passo.'],
          ]],
        ],
      },
      {
        titulo: 'Hora do lanche', tempo: 180,
        cena: 'No refeitório, uma criança de 6 anos leva as mãos ao pescoço. Ela não tosse e não consegue falar.',
        decisoes: [
          ['O que está acontecendo?', [
            ['Engasgo grave', true, 'Isso: sem tosse e sem voz, o objeto bloqueia a passagem do ar.'],
            ['É brincadeira', false, 'Mãos no pescoço sem tosse é o sinal universal de engasgo. Não espere.'],
            ['Crise de asma', false, 'Na asma há chiado e tosse. Aqui não há som nenhum: é engasgo.'],
          ]],
          ['Qual a conduta?', [
            ['Manobra de Heimlich, por trás, ajoelhado na altura dela', true, 'Certo: punho acima do umbigo, puxões para dentro e para cima.'],
            ['Dar água para ajudar a descer', false, 'Água pode piorar a obstrução.'],
            ['Tapas fortes de frente, no peito', false, 'Na criança maior, a manobra é a de Heimlich, por trás.'],
          ]],
          ['Ela ficou mole e desmaiou.', [
            ['Deito no chão, chamo o 192 e começo a RCP', true, 'Isso. As compressões também ajudam a expulsar o objeto.'],
            ['Continuo a manobra com ela em pé', false, 'Desmaiou: deite e comece a RCP.'],
            ['Procuro o objeto com o dedo, às cegas', false, 'Às cegas o dedo empurra o objeto. Só retire se estiver visível.'],
          ]],
        ],
      },
    ],
  },
};
