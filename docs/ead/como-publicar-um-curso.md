# Como publicar um curso online

Guia para quem usa o painel. O EAD aparece só para contas **DEV**, no seletor **Online** do topo do painel.

## 1. Criar o curso

O curso online pode nascer de dois jeitos:

- **A partir de um curso do presencial:** em **Online → Cursos online**, clique em **Ativar EAD** no curso. O curso presencial continua igual.
- **Curso só online:** em **Online → Cursos online → Criar curso só online**. Preencha nome, descrição, carga horária e foto. Esse curso não aparece no presencial (nem no painel, nem no site).

O endereço do curso no site é o nome dele, dentro da Escola Digital: `/escola-digital/nome-do-curso` (os endereços antigos `/online/...` continuam abrindo). Se você renomear o curso, o endereço muda junto, e o endereço antigo (dos e-mails já enviados e dos links de campanha) continua levando ao curso. Dois cursos online não podem ter o mesmo endereço: o painel recusa o nome igual ou parecido.

## 2. Escrever o conteúdo

Na página do curso (**Abrir**):

1. **Novo módulo:**
   - título;
   - **Tópicos (um por linha):** opcional, já cria os tópicos de uma vez;
   - tempo e texto de abertura são **opcionais** (vazio, o tempo é calculado sozinho);
   - "final" só no módulo de cenários ("Juntando tudo"), que abre depois dos outros. **O módulo final é opcional**, e o curso só pode ter um.
2. Em cada tópico:
   - **+ Nova tela:** o conteúdo da aula (texto, foto, vídeo, revisão, alerta e dica). Use **Salvar e escrever outra** para emendar as telas;
   - **+ Nova pergunta:** enunciado, alternativas (uma correta) e o porquê.
3. **Novo cenário** (no módulo final): uma situação com decisões; cada decisão tem 2 ou 3 opções e uma certa.

A página do módulo mostra duas listas desde o começo:
- **Para validar** (é o que trava): título; pelo menos 1 tópico com 1 tela; todo tópico com pelo menos 1 tela; perguntas com alternativas válidas. No final: pelo menos 1 cenário, todo cenário com decisão, toda decisão com 2 a 4 opções e 1 certa.
- **Recomendado** (não trava): vídeo e âncora nas telas, introdução, 3 perguntas por tópico, 8 no módulo (libera o pré-teste), o porquê, a cena e a fala do instrutor.

Regras que o aluno vai encontrar:
- **Teste rápido:** até 3 perguntas sorteadas por tópico (se houver perguntas), com nota mínima de 80%.
- **Pré-teste ("Já sei isso"):** aparece quando o módulo tem pelo menos 8 perguntas.
- **Os 7 primeiros dias:** os módulos abrem em sequência. Depois disso, o aluno escolhe a ordem.

## 3. Validar

Cada módulo nasce em **rascunho**. Quando a área técnica revisar o conteúdo, clique em **Validar módulo**. Mexeu num módulo validado? Ele volta a rascunho até ser validado de novo (mudar só a ordem dos módulos não volta).

**Curso já publicado:** o painel avisa "Este curso está publicado: o que você criar ou mudar aqui aparece para os alunos na hora." O aluno vê os módulos como estão, inclusive os em rascunho. Prefira preparar módulos novos antes de publicar.

## 4. Testar pelo link de teste

Na página do curso, clique em **Gerar link de teste**. O link abre o curso como o aluno vai ver, sem pagar e sem login.
- Mande o link só para quem vai revisar. Quem tem o link faz o curso inteiro e tira certificado.
- **Trocar** gera um link novo (o antigo deixa de abrir); **Desligar** apaga o link.

## 5. Preço, parcelas e cupons

Em **Venda no site**, na página do curso:
- **Preço do curso online:** o valor à vista (PIX ou cartão).
- **Parcelas no cartão (máx.):** de 1 a 12. Com 1, o curso é só à vista. Acima de 1, o aluno escolhe e paga os juros do Únicopag.

Em **Online → Cupons**:
- **Novo cupom:** código (ex.: LEILUCAS10), desconto em % ou em R$, curso (ou todos), validade e limite de usos.
- **Cupom de 100%:** libera o curso de graça (cortesia).
- **Link pronto para divulgar:** `/escola-digital/nome-do-curso?cupom=CÓDIGO`.
- Desative o cupom quando a campanha acabar. Depois da primeira compra com ele, o código e o tipo não mudam.

## 6. Desligar o link de teste

Antes de publicar, clique em **Desligar** no link de teste. Com o curso no site, o link de teste continua abrindo o curso e emitindo certificado sem pagamento.

## 7. Publicar

Clique em **Publicar no site**. Só funciona com:
- preço definido;
- pelo menos um módulo;
- todos os módulos validados.

Publicado, o curso entra na **Escola Digital** (`/escola-digital`), no sitemap e no Google; o curso presencial com versão online ganha um aviso com link para ela. O catálogo `/cursos` fica só com os presenciais.

### Escola Digital no site (ligar e desligar)

Em **Online → Cursos online**, no topo: **Escola Digital no site: Ligada / Desligada**. Começa desligada, e só liga com pelo menos um curso publicado.
- **Ligada:** a aba "Escola Digital" aparece no menu do site, com os cursos online publicados.
- **Desligada:** some do site para quem visita (menu, página e venda). Quem já comprou, recebeu vaga de escola ou cortesia continua estudando pela Minha conta e recebe o certificado.

**Tirar do site** esconde o curso do catálogo. Quem já comprou continua com acesso.

## 8. Acompanhar

- **Alunos do curso:** progresso, pagamento, cupom usado e certificado. Exporta planilha.
- **Online → Dúvidas:** responder as perguntas dos alunos. O aluno recebe e-mail.
- **Online → Escolas:** vendas em lote para escolas e empresas, gestores, convites e declaração.
- **Financeiro (presencial):** as vendas do online entram como as do presencial; os lotes, na conta "manual".

## Não faça

- **Publicar com o link de teste ligado.**
- **Desativar EAD e apagar conteúdo** num curso com alunos: o painel recusa enquanto houver matrícula, mas confira antes.
- **Voltar o deploy** para uma versão anterior ao EAD depois que existir uma turma online (veja `docs/ead/deploy.md`).
