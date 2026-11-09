# Criar curso com IA: passo a passo (a IA propõe, a pessoa confere)

Data: 09/11/2026 · Base: `main` (etapa 9 e Escola Digital no ar)

## Objetivo

Hoje o "Criar curso com IA" pede tudo num formulário grande. O Matheus quer que a IA construa e vá guiando: a pessoa diz a ideia e a IA preenche o resto. Escolhida a opção **B, passo a passo** (09/11).

## Os 4 passos (barra no topo: 1 Ideia · 2 Proposta · 3 Roteiro · 4 Escrita)

1. **Ideia** (`GET/POST /ead/ia/novo`).
   - **Campo:** "O que você quer ensinar, e para quem?", de 10 a 1000 caracteres.
   - **Opcional:** material (até 3 PDF/Word, 20 MB, mais texto colado), como hoje.
   - **Destino:** curso novo (padrão) ou um curso online existente.
   - **Botão "Gerar proposta":** cria a geração com status `PROPOSTA_GERANDO`. Valem o teto e a chave, como hoje.
2. **Proposta** (`/ead/ia/:id`, status `PROPOSTA_PRONTA`).
   - **O que a IA devolve:** nome, descrição, carga horária, público, tema, número de módulos (2 a 12), preço sugerido, parcelas (1 a 12), observações e uma frase do porquê de três sugestões (carga horária, módulos e preço).
   - **Formulário:** já preenchido e editável. Em curso existente não aparecem nome, descrição, carga horária, preço nem parcelas.
   - **"Gerar roteiro":** confere com as mesmas regras de hoje (nome único, carga, preço…), grava no pedido e passa a `ROTEIRO_GERANDO`.
   - **"Pedir outra proposta":** volta a `PROPOSTA_GERANDO`, conta no teto.
   - **Erro da IA:** `ERRO_PROPOSTA`, com "Tentar de novo".
3. **Roteiro:** o editor de hoje (`ROTEIRO_PRONTO`), mais **"← Voltar à proposta"**, que volta a `PROPOSTA_PRONTA` e mantém a proposta.
4. **Escrita:** como hoje. Na conclusão, o painel **"Próximos passos"** traz:
   - revisar e validar cada módulo (links);
   - conferir preço e capa na página do curso;
   - publicar e, se for a primeira vez, ligar a Escola Digital.

## Regras

- **Custo:** o custo da proposta soma na geração e no teto, como os outros passos.
- **Fila:** a proposta é trabalho da fila (`PROPOSTA_GERANDO` vem antes do roteiro), com a mesma marca entre serviços.
- **Andamento:** "Cancelar" vale em `PROPOSTA_*` também. `EM_ANDAMENTO` inclui `PROPOSTA_GERANDO` e `PROPOSTA_PRONTA` (só uma geração por pessoa, como hoje).
- **Resposta da IA conferida:** números fora da faixa são ajustados (carga de 1 a 600, módulos de 2 a 12, parcelas de 1 a 12, preço de 0 a 10000). Nome e tema vazios viram erro da proposta.
- **Sem migração:** `status` é texto e a proposta fica em `pedido.proposta` (JSON).
- **Gerações antigas:** as que já passaram da proposta seguem iguais. O roteiro usa `pedido.tema`, `publico`, `nModulos` e `observacoes`, que a confirmação da proposta preenche.

## Testes

- **Lib:** proposta com o cliente falso; proposta inválida vira erro; ajuste das faixas; confirmar grava o pedido e passa ao roteiro; voltar do roteiro para a proposta; pedir outra proposta.
- **Fila:** faz a proposta antes do roteiro.
- **Rotas:** passo 1 cria a geração; a página da proposta mostra os campos preenchidos; confirmar com nome de curso já usado volta com o erro e os valores; "próximos passos" na conclusão.
- **Ciclo pela interface** com o Claude falso.
- **Revisão final independente** e PR sem merge.
