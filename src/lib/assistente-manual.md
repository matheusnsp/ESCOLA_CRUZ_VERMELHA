# Manual do painel da secretaria

Fonte do assistente da secretaria (lib/assistente.js). Uma seção `##` para cada item do menu (o teste
test/assistente-contexto.test.js avisa quando falta). Quando uma tela mudar, atualize a seção dela.
O menu (grupos e endereços) é montado sozinho a partir de lib/menu-painel.js; aqui fica o que cada tela faz.

## Painel
Página inicial do modo Presencial: Inscrições hoje, Recebido no mês, A receber, Para agir (o que precisa de atenção),
Matrícula rápida (quem espera encaixe), Próximas turmas e Últimas inscrições. Tocar num número abre a lista dele.

## Todos os cursos (Cursos › Todos os cursos)
Lista dos cursos presenciais: nome, horas e área, próximas turmas, se está no site e o que falta (foto, texto
completo, conteúdo do certificado, dúvidas). Filtros por endereço: `/cursos?q=<nome>&status=<ATIVO|INATIVO>`
(ATIVO = No site, INATIVO = Fora do site). O botão **Abrir** leva ao resumo do curso (`/cursos/<id>`).
- **Resumo do curso:** um cartão por parte, cada uma com a sua tela e o seu botão de salvar:
  - Página no site (`/cursos/<id>/pagina`): nome, resumo, texto completo, carga horária, área, escolaridade e foto
    ("Escrever com IA" com Desfazer; "Gerar foto com IA"). Botão "Salvar página".
  - Valores (`/cursos/<id>/valores`): à vista, total no parcelado, máximo de parcelas, taxa de inscrição. "Salvar valores".
  - Certificado (`/cursos/<id>/certificado`): nome no certificado, conteúdo programático ("Sugerir com IA"),
    validade e quem assina (até 4). "Salvar certificado".
  - Dúvidas frequentes (`/cursos/<id>/duvidas`): editar, mudar a ordem (setas), remover, adicionar e "Sugerir dúvidas"
    (IA; marcar e "Adicionar as marcadas"). Cada ação grava na hora.
  - Turmas deste curso (`/cursos/<id>/turmas`): as turmas e "Nova turma deste curso".
  - Inscrição e publicação (`/cursos/<id>/publicacao`): "Mostrar este curso no site", "Exige comprovante da área da
    saúde" ("Salvar") e **Excluir curso** (só sem turmas, inscrições, EAD ou cupom; senão, desmarque Mostrar no site).
- O texto completo sai sempre em 3 parágrafos (o que o curso forma; o que o aluno aprende; onde vai poder atuar).

## Novo curso (Cursos › Novo curso)
`/cursos/novo`, em 3 passos: 1 Curso (nome, carga horária, área, escolaridade), 2 Valores (preços e taxa), 3 Textos
(resumo, texto completo, dúvidas e "Mais detalhes": conteúdo programático, nome no certificado, validade, comprovante
de saúde, Mostrar no site). "Começar com a IA" no topo: a pessoa escreve o que sabe e a IA preenche os 3 passos.
Voltar/Continuar não salvam; só "Criar curso". O curso nasce fora do site e abre no resumo. Foto, certificado e o resto
se completam depois, nas seções.

## Todas as turmas (Turmas › Todas as turmas)
Lista das turmas por situação (abas): Por começar, Em andamento, Congeladas, Concluídas, Canceladas. Mostra curso,
início, aulas, vagas ocupadas (inscrições com a taxa paga) e o mínimo. Filtros por endereço:
`/turmas?aba=<por-comecar|andamento|congeladas|concluidas|canceladas>&q=<nome do curso>`. O botão **Abrir** leva ao
resumo da turma (`/turmas/<id>`).
- **Resumo da turma:** a situação e a próxima mudança automática, e cartões para Dados da turma (`/turmas/<id>/editar`),
  Alunos (`/alunos?turma=<id>`, com quantos têm pagamento pendente), Mensagem de boas-vindas, Notas, QR da pesquisa e
  Certificados. Embaixo, Excluir turma (só sem alunos; com alunos, marque Cancelada em Dados da turma).
- **Dados da turma:** blocos Quando (curso, início, aulas e **Gerar aulas**: dias da semana + horário + até quando
  cria as datas de uma vez), Vagas (vagas e mínimo), Situação e Instrutor. Botão "Salvar alterações" (na nova, "Criar
  turma"); depois de salvar, volta ao resumo.
- **Situações:**
  - Aberta: aparece no site e aceita inscrição. Vira Confirmada sozinha à 00:00 do dia de início.
  - Confirmada: vai acontecer e não aceita mais inscrição pelo site nem encaixe na Matrícula rápida (quem já está
    nela pode ser movido para outra turma ou voltar para a espera). Marcar Confirmada antes do início fecha as
    inscrições na hora.
  - Concluída: a Confirmada vira Concluída sozinha no dia seguinte à última aula. Se alguém escolher Concluída antes
    disso, a turma fica Confirmada até lá (a tela avisa o dia).
  - Congelada: pausa a turma; some do site, não recebe lembretes, boas-vindas nem pesquisa, sai do A receber e não
    é concluída sozinha. Para retomar, volte para Aberta ou Confirmada.
  - Cancelada: tira a turma do site guardando o histórico (é o caminho quando ela tem alunos e não pode ser excluída).

## Nova turma (Turmas › Nova turma)
`/turmas/nova` (`?curso=<id>` já escolhe o curso): os mesmos blocos de Dados da turma, com "Começar com a IA" no topo
(a pessoa escreve curso, dias, horário, vagas e instrutor; a IA preenche) e "Gerar aulas". Botão "Criar turma"; a turma
nasce Aberta e abre no resumo.

## Matrícula rápida (Turmas › Matrícula rápida)
Quem pagou a inscrição no site da instituição, sem criar conta. A pessoa sugere a turma e os horários; a secretaria
encaixa numa turma e ela recebe o e-mail para pagar o curso. Abas: Aguardando, Em turma, Todos. Filtro por endereço:
`/matricula-rapida?sit=<aguardando|encaixados|todos>&curso=<id do curso>&q=<nome, e-mail ou telefone>`.
As ações precisam da permissão de aprovar taxa. O destino é sempre só turma Aberta do mesmo curso:
Confirmada não recebe mais aluno.
- **Encaixar:** no cartão de quem está aguardando, escolha a turma e clique em "Encaixar".
- **Mover:** no cartão de quem já está em turma, escolha outra turma aberta e clique em "Mover" (a pessoa recebe o
  aviso por e-mail; vale também para quem está numa turma Confirmada).
- **Voltar para a espera:** quando a pessoa não pode mais ir na turma; escreva o motivo. Ela volta para Aguardando e
  nada é apagado (pagamentos e histórico ficam). Não vale para turma já concluída.

## Mapa de horários (Turmas › Mapa de horários)
Quantos alunos podem em cada dia e período (manhã, tarde, noite), pelo que marcaram no site depois de pagar a
inscrição. Serve para abrir ou remarcar turmas. Filtro: `/horarios?curso=<id do curso>`. "Baixar planilha" exporta.

## Mensagem de boas-vindas (Turmas › Mensagem de boas-vindas)
Tudo sobre boas-vindas num lugar só:
- **Envio por turma** (no topo): turmas abertas/confirmadas em andamento, situação do envio e "Abrir envio". Na
  tela de envio da turma: prévia do e-mail, "Enviar para X alunos" (quem pagar depois recebe sozinho) e a doação
  solidária só daquela turma.
- **Texto padrão** de todas as turmas, com os campos {CURSO}, {curso}, {data}, {hora}, {local}, {doacao}.
- **Texto por curso:** um texto só de um curso ("Escrever texto do curso"); "Voltar ao padrão" apaga.

## Alunos (Alunos › Alunos)
Lista de alunos com busca por nome, e-mail, CPF ou passaporte e filtro por turma. Filtro por endereço:
`/alunos?q=<busca>&turma=<id da turma>`. Tocar no aluno abre as inscrições dele (`/alunos/<id>/matriculas`): dados,
inscrições, situação da taxa e da matrícula, valores, e "Editar dados".

## Matrículas (Alunos › Matrículas)
Todas as inscrições com busca e filtros: `/inscricoes?q=<busca>&status=<PAGO,PARCELADO|PENDENTE>&turma=<id>`.
Ações na linha: Confirmar taxa (taxa paga por fora), Confirmar pagamento (curso pago por fora), Transferir (outra
turma; o valor pago vai junto), Nota, Estornar e Cancelar.
- **Transferir aluno:** Alunos › Matrículas, procure o aluno, "Transferir" na linha, escolha a turma e confirme.

## Pendentes (Alunos › Pendentes)
Quem não terminou de pagar. Abas: "Inscrição paga, matrícula pendente" (pagou a taxa, falta o curso — é onde tem
dinheiro parado), "Nada pago, ainda dá tempo", "Fora de prazo" (a turma já começou ou acabou). Filtro por endereço:
`/pendentes?aba=<com-taxa|sem-taxa|fora-prazo>`.
- **Cobrar:** botão do WhatsApp na linha (abre a conversa e registra o contato) ou "Enviar lembrete por e-mail".

## Comprovantes (Alunos › Comprovantes)
Comprovantes da área da saúde exigidos na inscrição dos cursos marcados no cadastro do curso. Abas: Para conferir,
Aprovados, Recusados (`/comprovantes-saude?aba=<conferir|aprovados|recusados>`). "Aprovar" ou "Recusar e avisar o
aluno".

## Pesquisa de satisfação (Alunos › Pesquisa de satisfação)
Respostas da pesquisa enviada por e-mail no fim de cada turma (nota de 0 a 5). Filtros por endereço:
`/pesquisa?curso=<id>&turma=<id>&nota=<satisfeitos|neutros|insatisfeitos>&aba=<aguardando|aprovadas|ocultas|todas>`.
Depoimentos com autorização do aluno podem ir para o site: "Aprovar" / "Não publicar"; a chave "Seção na página
inicial" mostra ou esconde a seção no site.

## Financeiro (Financeiro › Financeiro)
Recebido por conta (Únicopag da escola, Únicopag da instituição e recebido na secretaria) e lista de pagamentos com
abas (Todos, Matrícula paga, Só a inscrição, Estornados) e busca na própria tela. Filtro por endereço:
`/financeiro?conta=<principal|segunda|manual>` (principal = Únicopag da escola, segunda = Únicopag da instituição,
manual = recebido na secretaria). "Exportar" baixa planilhas.

## Contas a pagar (Financeiro › Contas a pagar)
Despesas, pedidos de compra e reembolsos, com aprovação e pagamento. Abas: `/contas?aba=<semana|enviadas|aprovar|pagar|historico>`.
Criar: "Nova despesa", "Pedido de compra" ou "Reembolso".

## Cupons (Financeiro › Cupons / Vendas › Cupons)
Cupons de desconto (só DEV). Valem para cursos online, e-books e cursos presenciais (no presencial, o desconto é só
no valor do curso, não na taxa de inscrição). "Novo cupom": código, percentual ou valor, para qual curso, validade e
limite de usos.

## Certificados
Tudo sobre certificados num lugar só:
- **Imprimir por turma** (no topo): turmas em andamento e concluídas; "Abrir certificados" leva à impressão daquela
  turma (escolher quem, "Imprimir selecionados").
- **Quem assina:** até 6 pessoas (nome, cargo, assinatura escaneada).
- **Certificado online:** com ou sem assinatura. **Livro em uso.** **Prévia** com um aluno de exemplo.

## Usuários do painel (Configurações › Usuários do painel)
Contas da equipe (só DEV): papel (Secretaria, Coordenador, Financeiro, Consulta…), permissões, último acesso.
"Novo usuário".

## Permissões (Configurações › Permissões)
O que cada papel pode fazer no painel (só DEV).

## Alunos banidos (Configurações › Alunos banidos)
Alunos bloqueados (só DEV). Busca: `/banimentos?q=<nome>`.

## Suspeitos (Configurações › Suspeitos)
Cadastros com sinais de fraude para revisar (só DEV).

## Integração (Configurações › Integração)
Planilha do Excel ligada ao banco de dados (cada pessoa gera a sua).

## Cursos — online (Cursos online › Cursos)
Modo Online (só DEV): cursos 100% online da Escola Digital, com módulos, telas, perguntas, alunos, concluintes e
desempenho. "Criar curso só online".

## Criar curso com IA (Cursos online › Criar curso com IA)
Gera um curso online completo como rascunho a partir de um tema (e material opcional).

## Dúvidas dos alunos (Cursos online › Dúvidas dos alunos)
Perguntas dos alunos dos cursos online: Aguardando, Respondidas. Filtro: `/ead/duvidas?status=<…>&curso=<id>`.

## E-books (Conteúdos › E-books)
E-books da Escola Digital (PDF com o nome do comprador no rodapé). "Novo e-book".

## Webinários (Conteúdos › Webinários)
Webinários da Escola Digital (só DEV): palestras ao vivo (Zoom, Meet ou YouTube) e/ou gravadas (YouTube ou Vimeo),
grátis ou pagas. "Novo webinário": título, descrições, capa, quem apresenta, data e hora (em branco = só gravado),
duração, link da transmissão, link da gravação, palavra-código do certificado e preço. Para publicar: palavra-código e
data ou gravação. "Inscritos" mostra quem se inscreveu, a forma e a presença; "Exportar CSV" baixa a lista. O
certificado de participação sai quando a pessoa digita a palavra-código na página do webinário.

## Escolas (lotes) (Vendas › Escolas (lotes))
Vagas de cursos online vendidas em lote para escolas e empresas. "Novo lote".

## O que o sistema não faz (para orientar a falar com o dev)
- Mandar mensagem de WhatsApp sozinho (o painel só abre a conversa para a pessoa enviar).
- Mandar certificado por WhatsApp ou e-mail a partir do painel.
- Emitir nota fiscal ou boleto.
- Agendar mensagens.
- Relatórios que não estejam nas telas (o Financeiro e a Integração exportam planilhas).
