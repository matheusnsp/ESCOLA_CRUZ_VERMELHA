# Manual do painel da secretaria

Fonte do assistente da secretaria (lib/assistente.js). Uma seção `##` para cada item do menu (o teste
test/assistente-contexto.test.js avisa quando falta). Quando uma tela mudar, atualize a seção dela.
O menu (grupos e endereços) é montado sozinho a partir de lib/menu-painel.js; aqui fica o que cada tela faz.

## Painel
Página inicial do modo Presencial: Inscrições hoje, Recebido no mês, A receber, Para agir (o que precisa de atenção),
Matrícula rápida (quem espera encaixe), Próximas turmas e Últimas inscrições. Tocar num número abre a lista dele.

## Cursos — presencial (Cursos e turmas › Cursos)
Lista dos cursos presenciais com carga horária, valores, turmas e se aparece no site. Filtro por endereço:
`/cursos?q=<nome>&status=<ATIVO|INATIVO>`.
- **Criar curso:** botão "Novo curso" (`/cursos/novo`). Campos: nome, resumo, texto completo, carga horária,
  escolaridade mínima, área, preço à vista, total no parcelado, máximo de parcelas, taxa de inscrição, nome no
  certificado, conteúdo programático, validade do certificado, exige comprovante de saúde, ativo (aparece no site),
  foto e dúvidas frequentes. O botão "Escrever com IA" escreve resumo, texto completo, conteúdo e dúvidas; o texto
  completo sai sempre em 3 parágrafos (o que o curso forma; o que o aluno aprende; onde vai poder atuar).
  Botão final: "Criar curso" (num curso que já existe, "Salvar alterações").
- **Editar:** botão "Editar" na linha do curso (`/cursos/<id>/editar`).
- **Abrir turma do curso:** "Nova turma" na linha do curso.

## Turmas (Cursos e turmas › Turmas)
Lista das turmas por situação (abas): Por começar, Em andamento, Congeladas, Concluídas, Canceladas. Mostra curso,
início, aulas, vagas ocupadas (inscrições com a taxa paga) e o mínimo. Filtro por endereço:
`/turmas?aba=<por-comecar|andamento|congeladas|concluidas|canceladas>`.
- **Criar turma:** botão "Nova turma" (`/turmas/nova`). Campos: curso, início previsto, vagas, mínimo de alunos,
  instrutor e registro, situação, aulas (data e horário; "Adicionar aula" cria mais linhas). Botão "Criar turma"
  (na edição, "Salvar alterações").
- **Ações na linha:** Alunos (lista filtrada pela turma), Notas, QR da pesquisa, Editar, Excluir (só sem alunos).
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

## Matrícula rápida (Cursos e turmas › Matrícula rápida)
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

## Mapa de horários (Cursos e turmas › Mapa de horários)
Quantos alunos podem em cada dia e período (manhã, tarde, noite), pelo que marcaram no site depois de pagar a
inscrição. Serve para abrir ou remarcar turmas. Filtro: `/horarios?curso=<id do curso>`. "Baixar planilha" exporta.

## Mensagem de boas-vindas (Cursos e turmas › Mensagem de boas-vindas)
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
