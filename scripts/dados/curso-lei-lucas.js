// Conteúdo do primeiro curso online de verdade: Primeiros Socorros na Escola — Lei Lucas (Lei 13.722/2018).
// Gravado por scripts/criar-curso-lei-lucas.js como RASCUNHO: a área técnica da Escola revisa cada módulo,
// acrescenta os vídeos e valida no painel antes de publicar. Mapa dos 8 módulos do documento "O primeiro EAD
// da Cruz Vermelha Rio"; condutas para leigos conforme as diretrizes de RCP e primeiros socorros vigentes.
//
// Tela: t(título, âncora, título da revisão, itens da revisão, alerta, dica?).
// Pergunta: [enunciado, porquê, [alternativa certa, errada, errada, …]] — a certa vem primeiro aqui e muda de
// lugar na gravação. Opção de cenário: [texto, certa?, fala do instrutor].

const t = (titulo, ancora, revisaoTitulo, revisaoItens, alerta, dicaProfissional = null) => ({ titulo, ancora, revisaoTitulo, revisaoItens, alerta, dicaProfissional });

module.exports = {
  curso: {
    nome: 'Primeiros Socorros na Escola — Lei Lucas',
    descricao: 'Capacitação teórica em primeiros socorros para professores e funcionários de escolas, creches e espaços de recreação infantil, como pede a Lei Lucas (Lei 13.722/2018). No seu ritmo, pelo celular, com certificado da Cruz Vermelha.',
    cargaHoraria: 3,
  },
  modulos: [
    // ─── 1 ──────────────────────────────────────────────────────────────────────────────────────────
    {
      titulo: 'Antes de tudo', minutos: 20,
      introducao: 'Primeiros socorros começam antes de tocar em alguém: olhar se a cena é segura, se proteger e chamar ajuda do jeito certo.\n\nNeste módulo você entende o seu papel numa emergência, o que a Lei Lucas pede e o lema que vai aparecer em todo o curso: OLHAR, LIGAR, CUIDAR.',
      topicos: [
        {
          titulo: 'Seu papel e a Lei Lucas',
          telas: [
            t('Você é o primeiro elo', 'Entre o mal súbito e a chegada da ambulância passam, em média, de 10 a 15 minutos. Quem está perto — a professora, o porteiro, a merendeira — é quem decide o que acontece nesse tempo. Você não precisa ser da saúde: precisa saber o básico e não travar.',
              'o que se espera de você', ['Manter a calma e a cena segura.', 'Chamar ajuda cedo: 192 ou 193.', 'Fazer o que sabe, sem se arriscar.', 'Ficar com a vítima até o socorro chegar.'],
              'Omissão de socorro é crime (Art. 135 do Código Penal). Ligar para o 192 e ficar com a vítima já é prestar socorro.'),
            t('O que a Lei Lucas pede', 'A Lei 13.722/2018, a Lei Lucas, leva o nome de um menino de 10 anos que morreu engasgado num passeio escolar. Ela obriga escolas públicas e privadas de educação básica e espaços de recreação infantil a capacitar professores e funcionários em primeiros socorros, todos os anos.',
              'na prática', ['Vale para professores e funcionários.', 'Escolas públicas e privadas e recreação infantil.', 'A capacitação se renova todo ano.', 'A escola deve ter um kit de primeiros socorros.'],
              'Este curso é a parte teórica. A prática em manequim é oferecida nos cursos presenciais da Escola.'),
          ],
          perguntas: [
            ['A Lei Lucas obriga a capacitação de quem?', 'A lei vale para professores e funcionários de escolas públicas e privadas de educação básica e de espaços de recreação infantil.', ['Professores e funcionários de escolas e espaços de recreação infantil', 'Somente os pais dos alunos', 'Somente enfermeiros escolares', 'Somente a direção da escola']],
            ['De quanto em quanto tempo a capacitação da Lei Lucas deve ser feita?', 'A lei pede capacitação anual: o que não se pratica, se esquece.', ['Todo ano', 'Uma vez na vida', 'A cada 10 anos', 'Só quando houver acidente']],
            ['Ligar para o 192 e ficar com a vítima conta como prestar socorro?', 'Sim. A lei pede que você ajude no limite do que sabe; chamar o socorro e acompanhar já é socorro.', ['Sim', 'Não, é preciso fazer algum procedimento', 'Só se for profissional de saúde', 'Só se a vítima for criança']],
            ['Quanto tempo, em média, a ambulância leva para chegar?', 'Em média de 10 a 15 minutos. É por isso que o que você faz nesse tempo importa tanto.', ['De 10 a 15 minutos', 'Menos de 1 minuto', 'Mais de 2 horas', 'Não chega em escolas']],
          ],
        },
        {
          titulo: 'Cena segura e proteção',
          telas: [
            t('Olhe antes de chegar perto', 'Antes de tocar na vítima, olhe em volta: fios soltos, trânsito, fogo, vidro quebrado, briga, piso molhado. Um socorrista ferido é mais uma vítima, e aí ninguém ajuda ninguém.',
              'pare, olhe, pense', ['Veja o que causou o acidente.', 'Afaste as outras crianças.', 'Só mude a vítima de lugar se ficar for mais perigoso.', 'Peça a outro adulto para ajudar.'],
              'Não vire a segunda vítima.'),
            t('Luvas e mãos limpas', 'Sangue e secreções podem transmitir doenças. Antes de cuidar, proteja as mãos com luvas descartáveis. Sem luvas, improvise com um saco plástico limpo. Depois, lave as mãos com água e sabão, mesmo tendo usado luvas.',
              'proteção', ['Luvas sempre que houver sangue.', 'Sem luva: saco plástico limpo.', 'Tire a luva virando do avesso.', 'Lave as mãos depois.'],
              'Nunca deixe de socorrer por falta de luva: improvise a barreira e siga.',
              'Deixe luvas descartáveis em cada andar, no pátio e na mochila das excursões.'),
          ],
          perguntas: [
            ['Você vê um acidente no pátio. O que fazer primeiro?', 'Antes de tudo, confira se a cena é segura para você e para as crianças em volta.', ['Conferir se a cena é segura', 'Correr até a vítima', 'Levar a vítima de carro ao hospital', 'Procurar quem causou o acidente']],
            ['Sem luvas e com uma criança sangrando, o que fazer?', 'Improvise a barreira com um saco plástico limpo e aja: o sangramento não espera.', ['Usar um saco plástico limpo como barreira', 'Esperar alguém trazer luvas', 'Pressionar com a mão nua', 'Mandar a criança lavar sozinha']],
            ['Ao tirar a luva usada, o certo é:', 'Virar do avesso prende o material contaminado do lado de dentro.', ['Virar do avesso, sem tocar o lado de fora', 'Puxar pelos dedos e sacudir', 'Lavar e guardar para usar de novo', 'Deixar no chão']],
            ['Quando mudar a vítima de lugar?', 'Só se ficar onde está for mais perigoso (fogo, trânsito, risco de desabamento). Mexer à toa pode piorar uma lesão.', ['Só se ficar no lugar for mais perigoso', 'Sempre, para um lugar confortável', 'Nunca, em nenhuma situação', 'Quando ela pedir água']],
          ],
        },
        {
          titulo: 'Chamar ajuda e avaliar',
          telas: [
            t('192 ou 193', 'SAMU (192) para emergências médicas: desmaio, falta de ar, convulsão, dor no peito, parada cardíaca. Bombeiros (193) para resgate: queda de altura, fogo, afogamento, choque elétrico. Os dois se comunicam: ligue para qualquer um e não perca tempo escolhendo.',
              'o que dizer na ligação', ['Endereço completo e um ponto de referência.', 'O que aconteceu e quantas vítimas.', 'Idade aproximada e se respira.', 'Só desligue quando o atendente mandar.'],
              'Mande alguém esperar a ambulância no portão e liberar a passagem.',
              'Ligue no viva-voz: assim você fala com o atendente e continua com as mãos livres.'),
            t('OLHAR, LIGAR, CUIDAR', 'Toda emergência do curso começa pelas mesmas três palavras. OLHAR: a cena e a pessoa — ela responde? respira normalmente? LIGAR: 192 ou 193. CUIDAR: fazer o que sabe até o socorro chegar. Toque nos ombros e chame alto; se não responder, olhe o peito por até 10 segundos.',
              'o lema', ['OLHAR: a cena e a pessoa.', 'LIGAR: 192 (SAMU) ou 193 (Bombeiros).', 'CUIDAR: até o socorro chegar.', 'Sozinho com criança engasgada ou afogada: cuide antes de ligar.'],
              '"Puxadas" de ar espaçadas (gasping) não são respiração normal: são sinal de parada cardíaca.'),
          ],
          perguntas: [
            ['Qual é o número do SAMU?', 'SAMU é 192. Bombeiros é 193. Polícia é 190.', ['192', '190', '193', '199']],
            ['Na ligação para o socorro, o que não pode faltar?', 'Sem endereço e ponto de referência a ambulância não chega.', ['O endereço com um ponto de referência', 'O nome completo dos pais', 'O número da matrícula da criança', 'O CPF da vítima']],
            ['A vítima não responde e só "puxa o ar" de vez em quando. Isso é:', 'Puxadas de ar espaçadas (gasping) não são respiração normal: trate como parada cardíaca.', ['Sinal de parada cardíaca', 'Respiração normal de quem dorme', 'Sinal de que está acordando', 'Crise de ansiedade']],
            ['Por quanto tempo checar a respiração?', 'No máximo 10 segundos: mais do que isso atrasa a ajuda.', ['Até 10 segundos', 'Um minuto inteiro', 'Até o SAMU chegar', 'Não precisa checar']],
            ['No lema do curso, o que vem depois de OLHAR?', 'OLHAR, LIGAR, CUIDAR — com as exceções que o curso mostra (engasgo e afogamento de criança, quando você está sozinho).', ['LIGAR', 'CUIDAR', 'ESPERAR', 'CORRER']],
          ],
        },
      ],
    },
    // ─── 2 ──────────────────────────────────────────────────────────────────────────────────────────
    {
      titulo: 'Parada cardíaca no adulto', minutos: 25,
      introducao: 'Na parada cardíaca o coração para de bombear o sangue. Sem ajuda, o cérebro começa a sofrer em poucos minutos, e cada minuto sem compressões reduz muito a chance de sobreviver.\n\nNeste módulo você aprende a reconhecer a parada, fazer compressões que funcionam e usar o desfibrilador.',
      topicos: [
        {
          titulo: 'Reconhecer a parada',
          telas: [
            t('Infarto não é parada', 'No infarto, a pessoa está acordada, com dor ou aperto no peito que pode ir para o braço, as costas ou o queixo, suor frio, enjoo e falta de ar. Ligue 192 e deixe-a sentada e calma. Na parada cardíaca, a pessoa cai, não responde e não respira normalmente: aí são compressões imediatas.',
              'diferença', ['Infarto: acordada, com dor no peito.', 'Infarto: 192 e repouso.', 'Parada: não responde, não respira normalmente.', 'Parada: 192, DEA e compressões já.'],
              'O infarto pode virar parada. Fique com a pessoa até o socorro chegar.'),
            t('Não responde, mas respira', 'Se a pessoa não responde mas respira normalmente, coloque-a de lado (posição lateral de segurança): assim a língua e o vômito não fecham a passagem do ar. Ligue 192 e confira a respiração o tempo todo. Se houve queda de altura ou batida forte, não mexa: suspeite de lesão na coluna.',
              'posição lateral', ['Não responde, mas respira: de lado.', 'Braço de baixo dobrado para cima.', 'Perna de cima dobrada, apoiando.', 'Confira a respiração a cada minuto.'],
              'Parou de respirar normalmente? Vire de costas e comece as compressões.'),
          ],
          perguntas: [
            ['Colega acordado com dor forte no peito, suor frio e enjoo. O que fazer?', 'Pode ser infarto: ligue 192 e deixe-o em repouso, sentado e calmo. Compressões são só para quem não responde e não respira normalmente.', ['Ligar 192 e deixá-lo em repouso', 'Começar as compressões no peito', 'Levar para caminhar e tomar ar', 'Dar um café forte']],
            ['A pessoa não responde, mas respira normalmente. Como deixá-la?', 'De lado, na posição lateral de segurança, conferindo a respiração até o socorro chegar.', ['De lado (posição lateral de segurança)', 'Sentada', 'De barriga para baixo', 'De pé, apoiada na parede']],
            ['Qual destes é sinal de parada cardíaca?', 'Não responder e não respirar normalmente (ou só "puxar o ar") é parada: compressões já.', ['Não responde e não respira normalmente', 'Dor de cabeça forte', 'Fala enrolada', 'Tosse forte']],
            ['A pessoa caiu da escada, não responde, mas respira. O que fazer?', 'Queda com trauma: suspeite de lesão na coluna. Não mexa, ligue 192 e acompanhe a respiração.', ['Não mexer, ligar 192 e acompanhar a respiração', 'Sentá-la para ver se melhora', 'Virá-la de lado rapidamente', 'Dar água']],
          ],
        },
        {
          titulo: 'Compressões que salvam',
          telas: [
            t('Onde e como apertar', 'Pessoa deitada de costas no chão. Ajoelhe-se ao lado, coloque a base de uma mão no centro do peito (metade de baixo do osso do peito) e a outra por cima. Braços esticados, ombros sobre as mãos: use o peso do corpo, não a força dos braços.',
              'a posição', ['Vítima de costas, em superfície firme.', 'Mãos no centro do peito.', 'Braços esticados.', 'O peso do corpo empurra.'],
              'Cama e sofá afundam: leve a vítima para o chão.'),
            t('Rápido, forte e sem parar', 'Comprima de 100 a 120 vezes por minuto, afundando de 5 a 6 cm, e deixe o peito voltar todo entre uma e outra. Se você aprendeu ventilação, faça 30 compressões e 2 ventilações. Se não aprendeu, faça só compressões, sem parar, até o socorro chegar ou a pessoa acordar.',
              'o ritmo certo', ['100 a 120 compressões por minuto.', '5 a 6 cm de profundidade.', 'Deixe o peito voltar todo.', 'Revezem a cada 2 minutos.'],
              'Não pare as compressões por mais de 10 segundos.',
              'O ritmo de "Stayin\' Alive" (Bee Gees) ajuda a manter os 100 a 120 por minuto.'),
          ],
          perguntas: [
            ['Qual o ritmo das compressões?', 'O ritmo indicado é de 100 a 120 compressões por minuto.', ['100 a 120 por minuto', '60 por minuto', '200 por minuto', '30 por minuto']],
            ['Qual a profundidade das compressões no adulto?', 'No adulto, de 5 a 6 cm, deixando o peito voltar.', ['5 a 6 cm', '1 a 2 cm', '10 cm', 'O máximo possível']],
            ['Onde colocar as mãos para as compressões?', 'No centro do peito, na metade de baixo do osso do peito.', ['No centro do peito', 'Na barriga', 'No lado esquerdo, em cima do coração', 'No pescoço']],
            ['Você não aprendeu a fazer ventilação boca a boca. O que fazer?', 'Faça só compressões, sem parar: elas já mantêm o sangue chegando ao cérebro.', ['Só compressões, sem parar', 'Não fazer nada até o socorro chegar', 'Fazer só ventilações', 'Alternar compressões e tapas no rosto']],
            ['A vítima está numa cama macia. O que fazer antes das compressões?', 'Superfície macia afunda e as compressões perdem força: leve para o chão.', ['Colocar no chão', 'Comprimir mais devagar', 'Colocar um travesseiro nas costas', 'Sentar a vítima']],
          ],
        },
        {
          titulo: 'O desfibrilador (DEA)',
          telas: [
            t('O DEA fala com você', 'O DEA (desfibrilador externo automático) é um aparelho portátil que analisa o coração e, se precisar, dá um choque para ele voltar a bater no ritmo certo. Foi feito para leigos: ligue e siga a voz. Ele só dá choque se for necessário.',
              'com o DEA', ['Ligue assim que chegar.', 'Cole as pás no peito sem roupa, como no desenho.', 'Ninguém toca na vítima na análise e no choque.', 'Volte às compressões logo depois.'],
              'Afaste todos antes do choque: "Todos afastados!"'),
            t('Cuidados com o DEA', 'Peito molhado: seque rápido com uma toalha. Muito pelo: aperte bem as pás. Marca-passo (um caroço sob a pele): cole a pá um pouco ao lado. Não use o DEA com a vítima dentro da água. Com o DEA ou sem ele, as compressões não podem parar.',
              'atenção', ['Seque o peito antes de colar as pás.', 'Fora da água e de poças.', 'Marca-passo: pá ao lado do caroço.', 'Siga até o socorro chegar.'],
              'Peça o DEA logo no começo: "Você, ligue 192. Você, traga o desfibrilador."',
              'Descubra hoje onde fica o DEA mais perto da sua escola.'),
          ],
          perguntas: [
            ['Quem pode usar o DEA?', 'O DEA foi feito para leigos: ele fala cada passo e só dá choque se for necessário.', ['Qualquer pessoa, seguindo as instruções de voz', 'Só médicos', 'Só bombeiros', 'Só quem tem curso de enfermagem']],
            ['Durante a análise e o choque do DEA, o que fazer?', 'Ninguém pode tocar na vítima na análise e no choque.', ['Afastar todos da vítima', 'Continuar as compressões', 'Segurar a mão da vítima', 'Desligar o aparelho']],
            ['O DEA chegou. Quando usar?', 'Assim que chegar: o choque precoce é o que mais aumenta a chance de sobreviver.', ['Assim que chegar', 'Depois de 10 minutos de compressões', 'Só se o SAMU mandar', 'Só se a vítima acordar']],
            ['O peito da vítima está molhado de suor. Antes de colar as pás:', 'Seque o peito rapidamente para as pás grudarem bem.', ['Secar o peito', 'Molhar mais para conduzir melhor', 'Colar as pás por cima da roupa', 'Desistir do DEA']],
          ],
        },
      ],
    },
    // ─── 3 ──────────────────────────────────────────────────────────────────────────────────────────
    {
      titulo: 'Parada cardíaca na criança e no bebê', minutos: 20,
      introducao: 'Na criança, a parada cardíaca quase sempre começa pela falta de ar: afogamento, engasgo, crise respiratória. Por isso o que muda é a força das compressões e quando ligar.\n\nNeste módulo você aprende a RCP na criança e no bebê e o que fazer no afogamento.',
      topicos: [
        {
          titulo: 'RCP na criança',
          telas: [
            t('De 1 ano até a puberdade', 'Uma ou duas mãos no centro do peito, conforme o tamanho da criança, afundando cerca de um terço do peito (uns 5 cm), no mesmo ritmo de 100 a 120 por minuto. Se aprendeu ventilação, faça 30 compressões e 2 ventilações.',
              'na criança', ['Uma ou duas mãos.', 'Um terço do peito (cerca de 5 cm).', '100 a 120 por minuto.', '30 compressões e 2 ventilações, se souber.'],
              'Em criança, a parada costuma vir da falta de ar: comece logo.'),
            t('Quando ligar', 'Com celular: ligue 192 no viva-voz e comece as compressões ao mesmo tempo. Sozinho, sem celular, e sem ter visto a criança cair: faça 2 minutos de RCP e só então vá ligar. Se viu a criança cair de repente, ligue e busque o DEA primeiro.',
              'sozinho', ['Com celular: viva-voz e compressões.', 'Sem celular e sem ter visto: 2 minutos de RCP antes.', 'Viu cair de repente: ligue e busque o DEA.', 'Com outra pessoa: ela liga, você cuida.'],
              'Use o DEA também na criança. Se houver pás infantis, prefira-as.'),
          ],
          perguntas: [
            ['Quanto afundar o peito da criança?', 'Cerca de um terço do peito, uns 5 cm.', ['Cerca de um terço do peito (uns 5 cm)', 'O mínimo possível', 'Metade do peito', 'Cerca de 1 cm']],
            ['Sozinho e sem celular, você encontra uma criança desacordada sem respirar (não viu acontecer). O que fazer?', 'Na criança, a parada costuma vir da falta de ar: 2 minutos de RCP antes de sair para ligar dão mais chance.', ['2 minutos de RCP e depois ligar para o 192', 'Ligar e esperar sem tocar na criança', 'Procurar os pais antes de tudo', 'Sacudir a criança até acordar']],
            ['Pode usar o DEA numa criança?', 'Sim. Prefira as pás infantis; sem elas, use as de adulto, sem que uma encoste na outra.', ['Sim, de preferência com pás infantis', 'Não, nunca', 'Só depois dos 12 anos', 'Só se o médico autorizar']],
            ['Qual o ritmo das compressões na criança?', 'O mesmo do adulto: 100 a 120 por minuto.', ['100 a 120 por minuto', '60 por minuto', '200 por minuto', '30 por minuto']],
          ],
        },
        {
          titulo: 'RCP no bebê',
          telas: [
            t('Menos de 1 ano', 'Bebê de costas numa superfície firme, como uma mesa ou o chão. Envolva o peito com as duas mãos e comprima com os dois polegares no centro do peito, logo abaixo da linha dos mamilos — ou use a base de uma só mão. Afunde cerca de um terço do peito (uns 4 cm), de 100 a 120 vezes por minuto.',
              'no bebê', ['Superfície firme: mesa ou chão.', 'Dois polegares ou a base de uma mão.', 'Cerca de 4 cm.', '100 a 120 por minuto.'],
              'Nunca sacuda o bebê para "acordar".'),
            t('Ventilação no bebê', 'Se você aprendeu: incline a cabeça do bebê só um pouco para trás e cubra a boca e o nariz dele com a sua boca. Sopre o suficiente para o peito subir, como quem enche as bochechas. Faça 30 compressões e 2 ventilações.',
              'boca no nariz e na boca', ['Cabeça só um pouco inclinada.', 'Sua boca cobre boca e nariz.', 'Sopro curto: o peito sobe.', '30 compressões e 2 ventilações.'],
              'Não sabe ventilar? Faça só compressões, sem parar.'),
          ],
          perguntas: [
            ['Como fazer compressões no bebê?', 'Com os dois polegares (abraçando o peito) ou com a base de uma mão, no centro do peito.', ['Com os dois polegares ou a base de uma mão', 'Com as duas mãos sobrepostas, como no adulto', 'Com o punho fechado', 'Com um dedo só']],
            ['Quanto afundar o peito do bebê?', 'Cerca de um terço do peito, uns 4 cm.', ['Cerca de 4 cm', 'Cerca de 1 cm', 'Cerca de 8 cm', 'O máximo possível']],
            ['Onde fazer a RCP no bebê?', 'Numa superfície firme, como uma mesa ou o chão.', ['Numa superfície firme', 'No colo', 'No berço', 'Na cama dos pais']],
            ['Na ventilação do bebê, sua boca cobre:', 'No bebê, sua boca cobre a boca e o nariz ao mesmo tempo.', ['A boca e o nariz do bebê', 'Só o nariz', 'Só a boca, tapando o nariz com força', 'O rosto inteiro']],
          ],
        },
        {
          titulo: 'Afogamento',
          telas: [
            t('Afogamento é silencioso', 'Quem se afoga não grita nem acena: afunda em segundos, sem barulho. Na piscina, no rio e na praia, um adulto deve olhar as crianças o tempo todo, sem celular. Para ajudar alguém na água, jogue algo que flutue; não entre se não souber nadar e salvar.',
              'prevenção', ['Um adulto vigia, sem distração.', 'Boia, prancha ou garrafa para jogar.', 'Não entre na água sem saber salvar.', 'Chame 193.'],
              'Mais da metade dos afogamentos de crianças pequenas acontece em casa: balde, piscina e banheira também afogam.'),
            t('Fora da água', 'Retirada da água, a vítima que não responde e não respira normalmente precisa de ajuda imediata. Se você aprendeu, comece com 5 ventilações e siga com 30 compressões e 2 ventilações. Se não aprendeu, faça compressões sem parar. Se estiver sozinho, faça 2 minutos de RCP e então ligue 193.',
              'no afogado', ['Tire da água sem se arriscar.', 'Se souber: 5 ventilações primeiro.', 'Depois, 30 compressões e 2 ventilações.', 'Sozinho: 2 minutos de RCP, depois ligue.'],
              'Se vomitar, vire de lado, limpe a boca e continue.'),
          ],
          perguntas: [
            ['Como uma criança se afogando costuma se comportar?', 'O afogamento é silencioso: a criança afunda sem gritar nem acenar.', ['Afunda em silêncio, sem gritar', 'Grita e acena bastante', 'Nada até a borda sozinha', 'Chama os pais pelo nome']],
            ['Você não sabe nadar e vê alguém se afogando. O que fazer?', 'Jogue algo que flutue e chame o 193. Entrar na água sem saber salvar cria duas vítimas.', ['Jogar algo que flutue e chamar 193', 'Pular na água para salvar', 'Esperar a pessoa sair sozinha', 'Gritar para ela nadar mais rápido']],
            ['A vítima foi retirada da água, não responde e não respira. Se você sabe ventilar, começa com:', 'No afogamento, comece com 5 ventilações e siga com 30 compressões e 2 ventilações.', ['5 ventilações', 'Tapas nas costas', 'Apertar a barriga para tirar a água', 'Esperar a água sair sozinha']],
            ['Sozinho, depois de tirar a criança da água sem respirar, quando ligar?', 'No afogamento, a falta de ar é a causa: faça 2 minutos de RCP e então ligue 193.', ['Depois de 2 minutos de RCP', 'Antes de qualquer coisa', 'Só se ela não acordar em 1 hora', 'Nunca, o socorro não ajuda']],
          ],
        },
      ],
    },
    // ─── 4 ──────────────────────────────────────────────────────────────────────────────────────────
    {
      titulo: 'Engasgo', minutos: 20,
      introducao: 'Pipoca, uva, salsicha, bala, tampinha: o engasgo acontece rápido e em silêncio, muitas vezes no recreio ou na hora do lanche.\n\nNeste módulo você aprende a diferenciar o engasgo leve do grave em segundos e o que fazer em cada idade.',
      topicos: [
        {
          titulo: 'Leve ou grave',
          telas: [
            t('Os sinais', 'Uma criança está comendo no pátio quando para de rir, leva as mãos ao pescoço e não consegue falar. Você tem segundos para decidir se o ar ainda passa. Tosse forte e voz: o corpo está resolvendo. Sem voz, sem tosse, sem ar: é grave.',
              'os 4 sinais', ['Mãos no pescoço: o sinal universal.', 'Tosse forte e fala: leve.', 'Som agudo, sem voz, sem tosse: grave.', 'Lábios roxos: emergência de vida.'],
              'Se a criança tosse com força, não bata nas costas: você pode transformar um engasgo leve num grave.',
              'Pergunte "você está engasgado?". Quem acena com a cabeça e não fala está em engasgo grave.'),
            t('Prevenir na escola', 'Uva, tomate-cereja e salsicha inteiros são do tamanho da garganta de uma criança pequena: corte no comprido. Criança come sentada, sem correr nem brincar com comida na boca. Brinquedos com peças pequenas ficam longe dos menores de 3 anos.',
              'prevenção', ['Uva e salsicha cortadas no comprido.', 'Comer sentado e com calma.', 'Peças pequenas longe dos menores de 3 anos.', 'Adulto por perto na hora do lanche.'],
              'Pipoca, amendoim e bala dura não são para menores de 4 anos.'),
          ],
          perguntas: [
            ['No recreio, um aluno de 7 anos tosse com força depois de engolir pão. Ele consegue dizer "tá preso". O que fazer primeiro?', 'Tosse forte e voz = o ar passa; o corpo está resolvendo. Fique ao lado e incentive a tossir. Se a tosse parar ou ele perder a voz, aí sim: tapas e compressões.', ['Ficar ao lado, incentivar a tossir e observar', 'Dar 5 tapas firmes nas costas', 'Dar água para ajudar a descer', 'Fazer a manobra na hora']],
            ['Qual destes é sinal de engasgo grave?', 'Sem voz e sem tosse: o ar não passa. É hora de agir.', ['Sem voz e sem tosse', 'Tosse forte', 'Choro alto', 'Rosto vermelho falando']],
            ['Qual é o "sinal universal" do engasgo?', 'Mãos no pescoço. Vale ensinar esse sinal aos alunos.', ['Mãos no pescoço', 'Apontar para a boca', 'Bater no peito', 'Levantar os braços']],
            ['Como servir uva para uma criança pequena?', 'Inteira, a uva tem o tamanho da garganta da criança: corte no comprido.', ['Cortada no comprido', 'Inteira e gelada', 'Inteira, com casca', 'Congelada']],
          ],
        },
        {
          titulo: 'Criança maior e adulto',
          telas: [
            t('Tapas e compressões abdominais', 'Engasgo grave em adulto ou criança acima de 1 ano: fique ao lado, incline a pessoa para frente e dê 5 tapas firmes nas costas, entre as escápulas, com a base da mão. Se não sair, passe para trás dela e faça 5 compressões abdominais. Alterne 5 e 5 até o objeto sair ou a pessoa desmaiar.',
              'a sequência', ['Incline para frente.', '5 tapas entre as escápulas.', '5 compressões abdominais.', 'Alterne até sair ou desmaiar.'],
              'Desmaiou: deite no chão, ligue 192 e comece a RCP.'),
            t('A compressão abdominal', 'Por trás, abrace a pessoa. Feche uma mão em punho logo acima do umbigo, bem abaixo do osso do peito, e segure com a outra. Puxe com força para dentro e para cima. Em criança, ajoelhe-se para ficar da altura dela. Em grávida ou pessoa muito obesa, as compressões são no meio do peito.',
              'a manobra', ['Por trás, abraçando.', 'Punho acima do umbigo.', 'Para dentro e para cima.', 'Grávida ou obeso: no peito.'],
              'Mesmo que resolva, a pessoa deve ser examinada por um médico depois.'),
          ],
          perguntas: [
            ['No engasgo grave em adulto, quantos tapas nas costas antes das compressões?', '5 tapas, depois 5 compressões abdominais, alternando.', ['5', '2', '10', '30']],
            ['Onde colocar o punho na compressão abdominal?', 'Logo acima do umbigo, bem abaixo do osso do peito.', ['Logo acima do umbigo', 'No pescoço', 'Nas costas', 'Em cima do osso do peito']],
            ['Durante a manobra, a pessoa desmaia. E agora?', 'Deite no chão, ligue 192 e comece a RCP: as compressões no peito também ajudam a expulsar o objeto.', ['Deitar no chão, ligar 192 e começar a RCP', 'Continuar a manobra em pé', 'Dar água', 'Esperar ela acordar']],
            ['Uma professora grávida se engasga gravemente. Onde fazer as compressões?', 'Em grávida ou pessoa muito obesa, as compressões são no meio do peito, não na barriga.', ['No meio do peito', 'Na barriga, como sempre', 'Nas costas, só com tapas', 'Não se faz nada em grávida']],
          ],
        },
        {
          titulo: 'Engasgo no bebê',
          telas: [
            t('Tapas e compressões no peito', 'Apoie o bebê de bruços no seu antebraço, cabeça mais baixa que o corpo, segurando a mandíbula com a mão. Dê 5 tapas firmes entre as escápulas. Vire o bebê de barriga para cima, ainda com a cabeça mais baixa, e faça 5 compressões no centro do peito. Repita até sair ou o bebê desmaiar.',
              'no bebê', ['De bruços no antebraço, cabeça mais baixa.', '5 tapas entre as escápulas.', 'Vire e faça 5 compressões no peito.', 'Repita até resolver.'],
              'Bebê desmaiou: ligue 192 e comece a RCP do bebê.'),
            t('Erros comuns', 'Na pressa, muita gente faz o que piora: enfia o dedo na boca sem ver o objeto, sacode o bebê de cabeça para baixo, dá água ou faz a compressão na barriga. Tudo isso pode empurrar o objeto para mais longe ou machucar.',
              'nunca faça', ['Dedo na boca às cegas.', 'Sacudir de cabeça para baixo.', 'Dar água ou comida.', 'Compressão na barriga do bebê.'],
              'Só tire o objeto com os dedos se ele estiver visível e fácil de pegar.'),
          ],
          perguntas: [
            ['Quantos tapas nas costas antes de virar o bebê?', 'São 5 tapas entre as escápulas, depois 5 compressões no peito.', ['5', '1', '20', '30']],
            ['Como posicionar o bebê para os tapas?', 'De bruços no antebraço, com a cabeça mais baixa que o corpo.', ['De bruços, com a cabeça mais baixa que o corpo', 'Sentado no colo', 'De pé, segurando pelos braços', 'Deitado na cama']],
            ['No bebê engasgado, depois dos tapas vêm compressões:', 'No bebê, as compressões são no centro do peito, nunca na barriga.', ['No centro do peito', 'Na barriga', 'No pescoço', 'Nas costas']],
            ['Pode colocar o dedo na boca do bebê para tirar o objeto?', 'Só se o objeto estiver visível. Às cegas, o dedo empurra o objeto mais para dentro.', ['Só se o objeto estiver visível', 'Sim, sempre', 'Sim, procurando no fundo da garganta', 'Sim, com uma colher']],
          ],
        },
      ],
    },
    // ─── 5 ──────────────────────────────────────────────────────────────────────────────────────────
    {
      titulo: 'Mal súbito', minutos: 25,
      introducao: 'Convulsão, desmaio, crise de asma, alergia grave, queda do açúcar no sangue, AVC: na escola, o mal súbito pode acontecer com aluno ou com colega.\n\nNeste módulo você aprende a reconhecer cada um e o que fazer até o socorro chegar.',
      topicos: [
        {
          titulo: 'Convulsão e desmaio',
          telas: [
            t('Convulsão', 'Afaste objetos, proteja a cabeça com algo macio e marque o tempo da crise. Não segure os movimentos e não coloque nada na boca: a pessoa não engole a língua. Quando a crise parar, deixe-a de lado (posição lateral de segurança) e fique com ela até acordar de vez.',
              'na crise', ['Afaste objetos e proteja a cabeça.', 'Marque o tempo.', 'Nada na boca, não segure.', 'Depois, de lado.'],
              'Ligue 192 se passar de 5 minutos, se for a primeira crise, se houve ferimento, se aconteceu na água ou se a pessoa não acorda.',
              'Em criança pequena com febre alta, a convulsão febril assusta, mas a conduta é a mesma.'),
            t('Desmaio', 'Deite a pessoa de costas e eleve as pernas uns 30 cm, se não houver suspeita de queda com trauma. Afrouxe roupas apertadas e mantenha o local arejado, afastando os curiosos. Se não acordar em cerca de 1 minuto, ligue 192 e confira a respiração.',
              'no desmaio', ['Deite e eleve as pernas.', 'Afrouxe as roupas.', 'Nada para beber enquanto estiver tonto.', 'Não acordou em 1 minuto: 192.'],
              'Se não respirar normalmente, comece a RCP.'),
          ],
          perguntas: [
            ['Durante a convulsão, o que NÃO fazer?', 'Nada na boca e não segure os movimentos: isso machuca a pessoa e você. Ela não engole a língua.', ['Colocar algo na boca', 'Proteger a cabeça', 'Marcar o tempo da crise', 'Afastar objetos']],
            ['Quando ligar para o 192 numa convulsão?', 'Crise de mais de 5 minutos, primeira crise, ferimento, crise na água ou se não acorda.', ['Se passar de 5 minutos ou for a primeira crise', 'Nunca, convulsão passa sozinha', 'Só se a criança pedir', 'Só no dia seguinte']],
            ['Depois da convulsão, como deixar a pessoa?', 'De lado (posição lateral de segurança), para a saliva escorrer e a respiração ficar livre.', ['De lado', 'Sentada', 'De pé, andando', 'De barriga para baixo']],
            ['Alguém desmaiou, sem sinal de queda ou trauma. O que fazer?', 'Deite e eleve as pernas; se não acordar em cerca de 1 minuto, ligue 192.', ['Deitar e elevar as pernas', 'Dar água com açúcar na boca', 'Sentar e abanar', 'Jogar água fria no rosto']],
          ],
        },
        {
          titulo: 'Asma e alergia grave',
          telas: [
            t('Crise de asma', 'Na crise de asma, o ar custa a sair: há chiado, tosse, cansaço para falar e o peito "puxa". Sente a pessoa inclinada para frente, mantenha a calma e ajude a usar a bombinha dela, prescrita pelo médico, de preferência com o espaçador. Sem melhora em poucos minutos, ligue 192.',
              'na crise', ['Sentada, inclinada para frente.', 'Calma: fale devagar.', 'A bombinha da própria pessoa.', 'Não melhorou: 192.'],
              'Lábios roxos, não consegue falar ou ficou sonolenta: 192 na hora.',
              'Peça aos pais que deixem na escola a bombinha e a receita do aluno com asma.'),
            t('Alergia grave (anafilaxia)', 'Minutos depois de comer amendoim, leite, ovo ou camarão, de uma picada de abelha ou de um remédio, a criança pode ter inchaço nos lábios e no rosto, manchas pelo corpo, falta de ar, chiado, vômitos ou tontura. É emergência: ligue 192. Se ela tem caneta de adrenalina prescrita, aplique na lateral da coxa, mesmo por cima da roupa.',
              'anafilaxia', ['Inchaço, manchas e falta de ar.', 'Ligue 192 na hora.', 'Caneta de adrenalina na coxa, se tiver.', 'Falta de ar: sentada; tontura: deitada.'],
              'Não espere melhorar sozinho: a anafilaxia piora em minutos.'),
          ],
          perguntas: [
            ['Na crise de asma, como posicionar a pessoa?', 'Sentada e inclinada para frente: assim ela respira com menos esforço.', ['Sentada, inclinada para frente', 'Deitada de costas', 'De pé, correndo para tomar ar', 'De cabeça para baixo']],
            ['Qual bombinha usar na crise de asma?', 'A da própria pessoa, prescrita pelo médico. Remédio de outra pessoa pode não servir ou fazer mal.', ['A da própria pessoa, prescrita pelo médico', 'A de qualquer colega', 'Qualquer spray nasal', 'Nenhuma, só água']],
            ['Depois do lanche com amendoim, a criança fica com o rosto inchado e falta de ar. O que é e o que fazer?', 'É alergia grave (anafilaxia): ligue 192 na hora e use a caneta de adrenalina se ela tiver uma prescrita.', ['Alergia grave: 192 na hora', 'Engasgo: tapas nas costas', 'Ansiedade: esperar passar', 'Fome: dar mais lanche']],
            ['Onde se aplica a caneta de adrenalina?', 'Na lateral da coxa, mesmo por cima da roupa.', ['Na lateral da coxa', 'No braço', 'Na barriga', 'No pescoço']],
          ],
        },
        {
          titulo: 'Diabetes e AVC',
          telas: [
            t('Açúcar baixo (hipoglicemia)', 'Quem tem diabetes pode ter queda do açúcar no sangue: tremor, suor frio, palidez, fome, irritação, confusão. Se está acordada e consegue engolir, dê açúcar rápido: suco de fruta, refrigerante comum ou uma colher de açúcar na água. Deve melhorar em 15 minutos. Desmaiou: nada pela boca, de lado e 192.',
              'na hipoglicemia', ['Tremor, suor frio, confusão.', 'Acordada: suco ou açúcar.', 'Melhora em uns 15 minutos.', 'Desmaiada: nada pela boca, 192.'],
              'Na dúvida entre açúcar alto ou baixo, dê açúcar: o baixo é o que mata rápido.'),
            t('AVC: pense em SAMU', 'O AVC (derrame) é uma emergência em que cada minuto conta. Peça para a pessoa Sorrir (a boca entorta?), Abraçar (um braço cai?) e cantar uma Música ou repetir uma frase (a fala sai enrolada?). Qualquer um desses sinais: Urgência, ligue 192.',
              'o teste SAMU', ['S: Sorria — a boca entorta?', 'A: Abrace — um braço fica fraco?', 'M: Música — a fala sai enrolada?', 'U: Urgência — ligue 192.'],
              'Anote a hora em que os sinais começaram: o tratamento depende disso.'),
          ],
          perguntas: [
            ['Um aluno com diabetes está trêmulo, suando frio e confuso, mas acordado. O que dar?', 'Açúcar rápido: suco de fruta, refrigerante comum ou açúcar na água. Ele deve melhorar em uns 15 minutos.', ['Suco de fruta ou açúcar na água', 'Refrigerante diet', 'Nada, esperar passar', 'Uma injeção de insulina']],
            ['A pessoa com diabetes desmaiou. O que fazer?', 'Desmaiada não engole: nada pela boca. Deixe de lado e ligue 192.', ['Nada pela boca, de lado e 192', 'Colocar açúcar na boca', 'Dar suco de canudinho', 'Sacudir até acordar']],
            ['No teste SAMU para AVC, o que significa o "A"?', 'Abraçar: peça para levantar os dois braços. Um braço que cai ou fica fraco é sinal de AVC.', ['Abrace: um braço fica fraco?', 'Água: dar de beber', 'Ar: abrir a janela', 'Aguardar: esperar melhorar']],
            ['Colega com a boca torta e fala enrolada, de repente. O que fazer?', 'São sinais de AVC: ligue 192 na hora e anote o horário em que começou.', ['Ligar 192 e anotar a hora', 'Mandar para casa descansar', 'Dar um remédio para pressão', 'Esperar até o fim do expediente']],
          ],
        },
      ],
    },
    // ─── 6 ──────────────────────────────────────────────────────────────────────────────────────────
    {
      titulo: 'Sangramento grave', minutos: 15,
      introducao: 'Um sangramento grave pode matar em poucos minutos — e é dos que mais se salva com uma atitude simples: apertar.\n\nNeste módulo você aprende a pressão direta e os casos que pedem cuidado especial.',
      topicos: [
        {
          titulo: 'Estancar o sangramento',
          telas: [
            t('Pressão direta', 'Com luvas, cubra o ferimento com um pano limpo ou gaze e aperte firme, sem soltar para olhar. Se o pano encharcar, coloque outro por cima e continue apertando. Mantenha a vítima deitada e aquecida e ligue 192 se o sangue não parar ou for muito.',
              'para estancar', ['Luvas sempre.', 'Pano limpo e pressão firme.', 'Encharcou: outro pano por cima.', 'Muito sangue: 192.'],
              'Não tire o primeiro pano: o coágulo que está se formando sai junto.'),
            t('Quando é grave', 'Sangue que jorra ou escorre sem parar, poça no chão, roupa encharcada ou vítima pálida, fria, sonolenta e com respiração rápida: é grave. Peça para alguém ligar 192 e aperte com toda a força. O torniquete serve para braço ou perna que não para de sangrar com pressão firme, e precisa de treinamento.',
              'sinais de gravidade', ['Sangue jorrando ou sem parar.', 'Roupa encharcada, poça no chão.', 'Pele pálida e fria, sonolência.', '192 e pressão com toda a força.'],
              'Se usar torniquete, anote a hora em que foi colocado e nunca afrouxe por conta própria.'),
          ],
          perguntas: [
            ['O ferimento sangra muito. O que fazer?', 'Pressão direta e firme com um pano limpo, sem soltar para olhar.', ['Pressionar firme com um pano limpo', 'Lavar com água corrente e esperar', 'Passar pó de café', 'Deixar sangrar para limpar']],
            ['O pano encharcou de sangue. E agora?', 'Coloque outro por cima: tirar o primeiro desfaz o coágulo.', ['Colocar outro pano por cima e continuar apertando', 'Trocar o pano por um limpo', 'Parar de apertar', 'Lavar o ferimento']],
            ['Qual destes é sinal de sangramento grave?', 'Pele pálida e fria, sonolência e respiração rápida indicam que o corpo está perdendo muito sangue.', ['Pele pálida e fria, sonolência', 'Arranhão que já parou', 'Pequena mancha roxa', 'Coceira no local']],
            ['Se colocar um torniquete, o que é obrigatório?', 'Anotar a hora em que foi colocado e não afrouxar por conta própria: a equipe do hospital decide.', ['Anotar a hora em que foi colocado', 'Afrouxar a cada 5 minutos', 'Colocar no pescoço', 'Tirar quando a vítima pedir']],
          ],
        },
        {
          titulo: 'Casos especiais',
          telas: [
            t('Objeto encravado e amputação', 'Objeto encravado no corpo não se retira: ele pode estar segurando o sangramento. Prenda-o com panos para não mexer e chame o 192. Na amputação de um dedo, aperte o ferimento e guarde a parte num saco plástico limpo, dentro de outro saco com água e gelo — nunca direto no gelo.',
              'lembre', ['Objeto encravado: não tire.', 'Prenda com panos e ligue 192.', 'Parte amputada: saco plástico limpo.', 'Saco dentro de água com gelo, nunca direto no gelo.'],
              'Leve a parte amputada junto com a vítima.'),
            t('Nariz e dente', 'No sangramento nasal, incline a cabeça levemente para frente e aperte a parte mole do nariz por 10 minutos, sem soltar. No dente permanente arrancado, segure pela coroa (a parte branca), sem esfregar a raiz, guarde no leite ou no soro fisiológico e procure um dentista em até 1 hora. Dente de leite não se recoloca.',
              'nariz e dente', ['Nariz: cabeça levemente para frente.', 'Aperte a parte mole por 10 minutos.', 'Dente: segure pela coroa, guarde no leite.', 'Dentista em até 1 hora.'],
              'Cabeça para trás faz a criança engolir sangue e vomitar.'),
          ],
          perguntas: [
            ['Há um lápis encravado na perna da criança. O que fazer?', 'Não retire: o objeto pode estar segurando o sangramento. Prenda-o e chame o 192.', ['Não tirar, prender e chamar o 192', 'Tirar com cuidado', 'Empurrar para dentro', 'Cortar o lápis rente à pele']],
            ['Sangramento no nariz: como posicionar a cabeça?', 'Levemente para frente, apertando a parte mole do nariz por 10 minutos.', ['Levemente para frente', 'Para trás', 'Deitada de barriga para cima', 'Entre os joelhos']],
            ['Um aluno de 10 anos perdeu um dente permanente numa queda. Onde guardar o dente?', 'No leite ou no soro fisiológico, segurando pela coroa, e dentista em até 1 hora.', ['No leite ou no soro fisiológico', 'Num papel seco', 'Na água da torneira, depois de esfregar', 'No gelo']],
            ['Como guardar um dedo amputado?', 'Num saco plástico limpo, dentro de outro saco com água e gelo. Nunca direto no gelo.', ['Saco limpo dentro de outro com água e gelo', 'Direto no gelo', 'Num copo com álcool', 'Embrulhado em papel']],
          ],
        },
      ],
    },
    // ─── 7 ──────────────────────────────────────────────────────────────────────────────────────────
    {
      titulo: 'Lesões e ambiente', minutos: 20,
      introducao: 'Quedas, batidas na cabeça, queimaduras, choque elétrico, produtos de limpeza, calor e bichos: as emergências do dia a dia da escola.\n\nNeste módulo você aprende o que fazer — e principalmente o que não fazer — em cada uma.',
      topicos: [
        {
          titulo: 'Quedas e batidas na cabeça',
          telas: [
            t('Batida na cabeça', 'Depois de uma batida na cabeça, avise a família e observe a criança. Ligue 192 se ela desmaiou, vomitou mais de uma vez, ficou sonolenta ou confusa, teve convulsão, sai sangue ou líquido do nariz ou do ouvido, ou a dor de cabeça só aumenta.',
              'sinais de alerta', ['Desmaio ou sonolência.', 'Vômitos repetidos.', 'Confusão ou convulsão.', 'Sangue ou líquido no nariz ou ouvido.'],
              'Os sinais podem aparecer horas depois: oriente a família a observar nas próximas 24 horas.'),
            t('Coluna e ossos', 'Queda de altura, mergulho em água rasa ou atropelamento, com dor no pescoço ou nas costas, formigamento ou fraqueza: suspeite de lesão na coluna. Não mexa a vítima, segure a cabeça alinhada e ligue 193. Na suspeita de fratura, não tente colocar o osso no lugar: imobilize como está.',
              'na suspeita', ['Não mexa a vítima.', 'Cabeça alinhada com o corpo.', 'Fratura: imobilize como está.', 'Ligue 193 ou 192.'],
              'Só tire a vítima do lugar se houver perigo maior, como fogo.',
              'Na torção, gelo envolto num pano por 20 minutos alivia a dor e o inchaço.'),
          ],
          perguntas: [
            ['Depois de bater a cabeça, a criança vomitou duas vezes e está sonolenta. O que fazer?', 'Vômitos repetidos e sonolência são sinais de alerta: ligue 192.', ['Ligar 192', 'Deixar dormir para descansar', 'Dar um analgésico e esperar', 'Mandar voltar para a aula']],
            ['Um aluno caiu do muro e sente dor no pescoço e formigamento nas mãos. O que fazer?', 'Suspeita de lesão na coluna: não mexa, segure a cabeça alinhada e ligue 193.', ['Não mexer, segurar a cabeça alinhada e ligar 193', 'Ajudar a se levantar', 'Levar no colo para a enfermaria', 'Sentá-lo encostado no muro']],
            ['Suspeita de braço quebrado. O que fazer?', 'Não tente colocar no lugar: imobilize na posição em que está e procure atendimento.', ['Imobilizar como está', 'Puxar para alinhar o osso', 'Massagear o local', 'Pedir para mexer bastante']],
            ['Depois de uma batida na cabeça sem sinais de alerta, o que orientar à família?', 'Observar a criança nas próximas 24 horas: os sinais de alerta podem aparecer depois.', ['Observar nas próximas 24 horas', 'Nada, já passou', 'Não deixar a criança dormir por 3 dias', 'Dar remédio para dormir']],
          ],
        },
        {
          titulo: 'Queimadura e choque elétrico',
          telas: [
            t('Queimadura', 'Coloque a área queimada sob água corrente fria (da torneira, não gelada) por 20 minutos. Tire anéis e roupas que não estejam grudadas. Cubra com filme plástico ou pano limpo. Não use gelo, pasta de dente, manteiga, pó de café nem pomada, e não estoure as bolhas.',
              'na queimadura', ['Água corrente fria por 20 minutos.', 'Tire anéis e roupas soltas.', 'Cubra com plástico ou pano limpo.', 'Nada de gelo, pasta ou manteiga.'],
              'Ligue 192 se a queimadura for grande, no rosto, nas mãos ou nos genitais, causada por eletricidade ou produto químico, ou em criança pequena.',
              'Roupa pegando fogo: PARE, DEITE e ROLE no chão.'),
            t('Choque elétrico', 'Antes de tocar na vítima, desligue a energia no disjuntor. Se não der, afaste o fio com algo seco que não conduza eletricidade, como um cabo de vassoura de madeira. Depois, veja se ela responde e respira, ligue 192 e, se preciso, comece a RCP.',
              'no choque', ['Desligue o disjuntor primeiro.', 'Nunca toque na vítima ainda ligada.', 'Afaste o fio com madeira seca.', 'Sempre 192, mesmo que pareça bem.'],
              'Fio de alta tensão caído na rua: não chegue perto. Ligue 193.'),
          ],
          perguntas: [
            ['Uma criança queimou a mão na chaleira. O que fazer primeiro?', 'Água corrente fria (não gelada) por 20 minutos.', ['Água corrente fria por 20 minutos', 'Passar pasta de dente', 'Colocar gelo direto', 'Passar manteiga']],
            ['Apareceram bolhas na queimadura. O que fazer?', 'Não estoure: a bolha protege a pele de infecção. Cubra com plástico ou pano limpo.', ['Não estourar e cobrir com pano limpo', 'Estourar com agulha', 'Arrancar a pele solta', 'Passar álcool']],
            ['Alguém está levando choque, preso a um fio. O que fazer primeiro?', 'Desligue a energia no disjuntor antes de tocar. Se tocar na vítima ainda ligada, você leva o choque também.', ['Desligar a energia no disjuntor', 'Puxar a vítima com as mãos', 'Jogar água', 'Esperar o choque parar sozinho']],
            ['A roupa de uma criança pegou fogo. O que ensinar?', 'PARE, DEITE e ROLE: correr espalha o fogo.', ['Parar, deitar e rolar no chão', 'Correr até a torneira', 'Abanar a roupa', 'Tirar a roupa correndo']],
          ],
        },
        {
          titulo: 'Intoxicação, calor e bichos',
          telas: [
            t('Intoxicação', 'Criança que bebeu produto de limpeza ou tomou remédio: não provoque vômito, não dê leite nem outra coisa para beber. Guarde a embalagem, veja a quantidade e ligue para o Disque-Intoxicação (0800 722 6001) ou para o 192. Produto no olho ou na pele: lave com muita água corrente.',
              'na intoxicação', ['Não provoque vômito.', 'Nada para beber.', 'Leve a embalagem.', 'Disque-Intoxicação: 0800 722 6001.'],
              'Desmaiou, tem convulsão ou falta de ar: 192 na hora.',
              'Produtos de limpeza e remédios ficam trancados e fora do alcance das crianças.'),
            t('Calor e animais peçonhentos', 'No calor forte, a criança com pele quente, dor de cabeça, tontura ou vômitos vai para a sombra, com roupas afrouxadas, panos úmidos e água em goles se estiver acordada. Picada de cobra ou escorpião: lave com água e sabão, deixe a vítima em repouso e vá logo ao hospital. Não corte, não chupe e não amarre.',
              'calor e bichos', ['Calor: sombra, panos úmidos e água.', 'Confusa ou desmaiada: 192.', 'Picada: água e sabão e repouso.', 'Não corte, não chupe, não amarre.'],
              'Escorpião em criança é grave: hospital imediatamente.',
              'Se for seguro, tire uma foto do animal para mostrar no hospital.'),
          ],
          perguntas: [
            ['Uma criança bebeu água sanitária. O que fazer?', 'Não provoque vômito nem dê nada para beber. Guarde a embalagem e ligue para o Disque-Intoxicação (0800 722 6001) ou o 192.', ['Não provocar vômito e ligar para o Disque-Intoxicação ou 192', 'Fazer vomitar', 'Dar leite', 'Dar bastante água com sal']],
            ['Caiu produto de limpeza no olho do funcionário. O que fazer?', 'Lave com muita água corrente, por vários minutos, e procure atendimento.', ['Lavar com muita água corrente', 'Esfregar o olho', 'Pingar colírio qualquer', 'Tapar o olho e esperar']],
            ['Uma criança foi picada por escorpião. O que fazer?', 'Lave com água e sabão, mantenha em repouso e leve ao hospital imediatamente: em criança, o escorpião é grave.', ['Lavar, manter em repouso e levar ao hospital já', 'Fazer um corte e chupar o veneno', 'Amarrar o braço com força', 'Passar álcool e esperar']],
            ['No passeio, uma criança com calor forte está tonta e com dor de cabeça, mas acordada. O que fazer?', 'Leve para a sombra, afrouxe a roupa, refresque com panos úmidos e dê água em goles.', ['Sombra, panos úmidos e água em goles', 'Continuar o passeio', 'Cobrir com um casaco', 'Dar refrigerante gelado de uma vez']],
          ],
        },
      ],
    },
  ],
  // ─── 8: Juntando tudo ────────────────────────────────────────────────────────────────────────────
  final: {
    titulo: 'Juntando tudo', minutos: 25,
    introducao: 'Agora é com você. Cinco cenas do dia a dia da escola, com cronômetro. Não existe reprovação por tempo: o que importa é decidir.\n\nA cada escolha, o instrutor comenta o que deu certo e o que mudaria.',
    cenarios: [
      {
        titulo: 'Pânico na hora do lanche', tempo: 180,
        cena: 'Creche municipal, 15h. Dona Lúcia, a merendeira, vê que o Davi, de 2 anos, parou de mastigar, está com os olhos arregalados e não faz som nenhum. A professora saiu para buscar as outras crianças. Você é o adulto mais perto e está sem celular.',
        decisoes: [
          ['O que está acontecendo com o Davi?', [
            ['Engasgo grave: sem som, o ar não passa', true, 'Isso. Sem tosse, sem choro e sem voz, o objeto bloqueia a passagem do ar. Não há tempo a perder.'],
            ['Ele está só assustado', false, 'Criança assustada chora. Silêncio total com olhos arregalados na hora de comer é engasgo grave.'],
            ['Crise de asma', false, 'Na asma há chiado e tosse. Aqui não há som nenhum: é engasgo.'],
          ]],
          ['Você está sozinho com ele e sem celular. O que faz primeiro?', [
            ['Começo a socorrer agora e grito por ajuda', true, 'Certo. Sozinho com criança engasgada, cuidar vem antes de ligar. Grite: alguém liga para o 192.'],
            ['Saio para ligar para o 192', false, 'Em poucos minutos sem ar o Davi pode desmaiar. Cuide primeiro e grite para alguém ligar.'],
            ['Espero a professora voltar', false, 'Cada segundo conta. Você é quem está perto: aja.'],
          ]],
          ['Davi tem 2 anos. Qual a manobra?', [
            ['5 tapas nas costas e 5 compressões abdominais, ajoelhado na altura dele', true, 'Perfeito. Acima de 1 ano: tapas e compressões abdominais, alternando, até sair ou ele desmaiar.'],
            ['Virar de cabeça para baixo e sacudir', false, 'Sacudir pode piorar e machucar. Use tapas e compressões.'],
            ['Dar água para o pedaço descer', false, 'Água pode ir para a via aérea e piorar a obstrução.'],
          ]],
        ],
      },
      {
        titulo: 'Colega na sala dos professores', tempo: 240,
        cena: 'Intervalo. O professor Carlos, de 52 anos, diz que sente um aperto forte no peito que vai para o braço esquerdo. Está pálido e suando frio. Minutos depois, ele cai da cadeira e não responde.',
        decisoes: [
          ['Antes de ele cair, com aperto no peito e suor frio, o que você faz?', [
            ['Ligo 192 e o deixo sentado e calmo', true, 'Isso. Dor no peito com suor frio pode ser infarto. Ligar cedo ganha minutos preciosos.'],
            ['Começo as compressões no peito', false, 'Ele está acordado e respirando: compressão não é para quem está consciente.'],
            ['Peço para ele ir dirigindo até o hospital', false, 'Nunca deixe quem pode estar infartando dirigir: ligue 192.'],
          ]],
          ['Ele caiu, não responde e só "puxa o ar" de vez em quando. E agora?', [
            ['Peço o DEA e começo as compressões', true, 'Exato. "Puxar o ar" assim é parada cardíaca: compressões já, enquanto alguém traz o DEA.'],
            ['Coloco de lado e espero o SAMU', false, 'De lado é para quem respira normalmente. Gasping é parada: compressões já.'],
            ['Jogo água no rosto para ele acordar', false, 'Cada minuto sem compressão reduz muito a chance de sobreviver.'],
          ]],
          ['O desfibrilador chegou.', [
            ['Ligo, colo as pás e sigo a voz, afastando todos no choque', true, 'Perfeito. O DEA guia tudo; você volta às compressões logo depois do choque.'],
            ['Termino 10 minutos de compressões antes de usar', false, 'Use o DEA assim que chegar: o choque precoce salva vidas.'],
            ['Guardo, porque só médico pode usar', false, 'O DEA foi feito para leigos. Ele fala cada passo.'],
          ]],
        ],
      },
      {
        titulo: 'Queda no pátio', tempo: 180,
        cena: 'No recreio, a Júlia, de 8 anos, cai do trepa-trepa e bate a cabeça no chão. Ela chora, levanta sozinha e diz que está tudo bem. Meia hora depois, na sala, vomita duas vezes e fica sonolenta.',
        decisoes: [
          ['Logo depois da queda, ela levantou e chorou. O que fazer?', [
            ['Observar, colocar gelo envolto em pano no galo e avisar a família', true, 'Certo. Mesmo parecendo bem, a família precisa saber, e a Júlia fica em observação.'],
            ['Nada, ela já está bem', false, 'Batida na cabeça pede observação: os sinais de alerta podem vir depois.'],
            ['Dar um remédio para dor de cabeça', false, 'Remédio sem orientação pode esconder sinais importantes.'],
          ]],
          ['Na sala, ela vomitou duas vezes e está sonolenta. E agora?', [
            ['Ligo 192: são sinais de alerta', true, 'Isso. Vômitos repetidos e sonolência depois de batida na cabeça pedem avaliação urgente.'],
            ['Deixo ela dormir na enfermaria', false, 'Sonolência depois de batida na cabeça é sinal de alerta. Não espere: ligue 192.'],
            ['Dou água com açúcar', false, 'Com vômitos e sonolência, nada pela boca. Ligue 192.'],
          ]],
          ['Enquanto o SAMU não chega, ela vomita de novo e fica bem sonolenta, mas respira. Como posicioná-la?', [
            ['De lado, com a cabeça e o pescoço alinhados', true, 'Correto. De lado, o vômito não vai para o pulmão. Mantenha a cabeça alinhada e confira a respiração.'],
            ['Sentada, com a cabeça para trás', false, 'Assim ela pode engasgar com o vômito. De lado é mais seguro.'],
            ['De barriga para cima, com travesseiro alto', false, 'Barriga para cima com vômito é risco de engasgo. De lado.'],
          ]],
        ],
      },
      {
        titulo: 'Festa junina', tempo: 180,
        cena: 'Festa junina da escola. O Pedro, de 9 anos, come uma paçoca. Minutos depois, os lábios incham, aparecem manchas vermelhas pelo corpo e ele diz que o ar está faltando, com chiado no peito. Na ficha dele consta alergia a amendoim.',
        decisoes: [
          ['O que está acontecendo?', [
            ['Alergia grave (anafilaxia) ao amendoim', true, 'Isso. Inchaço, manchas e falta de ar depois de comer um alimento que causa alergia: anafilaxia.'],
            ['Engasgo com a paçoca', false, 'Ele fala e tem chiado; o inchaço e as manchas mostram que é alergia, não engasgo.'],
            ['Crise de ansiedade pela festa', false, 'Inchaço e manchas não são ansiedade. É emergência.'],
          ]],
          ['Qual a primeira atitude?', [
            ['Ligar 192 na hora', true, 'Certo. A anafilaxia piora em minutos: o socorro precisa vir já.'],
            ['Dar água e esperar melhorar', false, 'Não espere: a anafilaxia pode fechar a passagem do ar.'],
            ['Mandar para casa com os pais', false, 'É emergência médica: 192 agora.'],
          ]],
          ['Na mochila dele há uma caneta de adrenalina prescrita pelo médico. E agora?', [
            ['Aplico na lateral da coxa, como na instrução da caneta', true, 'Perfeito. A adrenalina na coxa, mesmo por cima da roupa, ganha tempo até o SAMU chegar.'],
            ['Guardo para o SAMU decidir', false, 'A caneta é para usar já. Cada minuto conta na anafilaxia.'],
            ['Aplico no braço da criança', false, 'O local indicado é a lateral da coxa.'],
          ]],
        ],
      },
      {
        titulo: 'Passeio no clube', tempo: 240,
        cena: 'Passeio da turma a um clube. Na piscina, você percebe um aluno de 6 anos boiando de bruços, sem se mexer. Os colegas brincam em volta, sem perceber. Você sabe nadar e ninguém mais está perto.',
        decisoes: [
          ['O que fazer primeiro?', [
            ['Tirar o aluno da água com segurança', true, 'Isso. Você sabe nadar e a piscina é segura: tire-o da água o mais rápido possível.'],
            ['Ligar para o 193 antes de qualquer coisa', false, 'Cada segundo debaixo da água conta. Tire-o primeiro e grite por ajuda.'],
            ['Gritar para ele nadar até a borda', false, 'Ele não se mexe: não vai conseguir. Aja.'],
          ]],
          ['Fora da água, ele não responde e não respira. Você aprendeu a ventilar. Por onde começar?', [
            ['5 ventilações e depois 30 compressões e 2 ventilações', true, 'Correto. No afogamento, o problema é a falta de ar: comece pelas ventilações.'],
            ['Apertar a barriga para tirar a água', false, 'Apertar a barriga faz vomitar e não ajuda. Comece pelas ventilações.'],
            ['Virar de cabeça para baixo', false, 'Isso só atrasa a RCP. Comece já pelas ventilações.'],
          ]],
          ['Você está sozinho com ele. Quando ligar para o 193?', [
            ['Depois de 2 minutos de RCP, ou já, se alguém puder ligar', true, 'Exato. Sozinho, faça 2 minutos de RCP antes; se alguém aparecer, peça para ligar na hora.'],
            ['Só quando ele acordar', false, 'O socorro precisa vir de qualquer forma. Ligue depois de 2 minutos de RCP.'],
            ['Antes de começar a RCP', false, 'No afogamento, sozinho, cuidar vem primeiro: 2 minutos de RCP e depois ligue.'],
          ]],
        ],
      },
    ],
  },
};
