# Como publicar um curso online

Guia para quem usa o painel. O EAD aparece só para contas **DEV**, no seletor **Online** do topo do painel.

## 1. Criar o curso

O curso online pode nascer de dois jeitos:

- **A partir de um curso do presencial:** em **Online → Cursos online**, clique em **Ativar EAD** no curso. O curso presencial continua igual.
- **Curso só online:** em **Online → Cursos online → Criar curso só online**. Preencha nome, descrição, carga horária e foto. Esse curso não aparece no presencial (nem no painel, nem no site).

O endereço do curso no site é o nome dele: `/online/nome-do-curso`. Se você renomear o curso, o endereço muda junto. Os links antigos continuam abrindo.

## 2. Escrever o conteúdo

Na página do curso (**Abrir**):

1. **Novo módulo:**
   - título;
   - minutos estimados;
   - texto de abertura;
   - marque "final" no módulo "Juntando tudo", que abre só depois dos outros.
2. Em cada módulo, **Novo tópico**, e em cada tópico:
   - **+ Nova tela:** o conteúdo da aula (texto, imagem ou vídeo, revisão, alerta e dica);
   - **+ Nova pergunta:** enunciado, alternativas (uma correta) e o porquê.
3. **Novo cenário** (no módulo final): uma situação com decisões e opções; a opção certa explica o porquê.

Regras que o aluno vai encontrar:
- **Teste rápido:** 3 perguntas por tópico, com nota mínima de 80%.
- **Pré-teste ("Já sei isso"):** aparece quando o módulo tem pelo menos 8 perguntas.
- **Os 7 primeiros dias:** os módulos abrem em sequência. Depois disso, o aluno escolhe a ordem.

## 3. Validar

Cada módulo nasce em **rascunho**. Quando a área técnica revisar o conteúdo, clique em **Validar módulo**. Mexeu num módulo validado? Ele volta a rascunho até ser validado de novo.

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
- **Link pronto para divulgar:** `/online/nome-do-curso?cupom=CÓDIGO`.
- Desative o cupom quando a campanha acabar. Depois da primeira compra com ele, o código e o tipo não mudam.

## 6. Desligar o link de teste

Antes de publicar, clique em **Desligar** no link de teste. Com o curso no site, o link de teste continua abrindo o curso e emitindo certificado sem pagamento.

## 7. Publicar

Clique em **Publicar no site**. Só funciona com:
- preço definido;
- pelo menos um módulo;
- todos os módulos validados.

Publicado, o curso entra no catálogo `/cursos` (o curso só online) ou na página do curso presencial (a caixa "Também 100% online"), no sitemap e no Google.

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
