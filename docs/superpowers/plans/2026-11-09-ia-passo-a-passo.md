# Criar curso com IA passo a passo — plano

> Execução inline (superpowers:executing-plans). Spec: `docs/superpowers/specs/2026-11-09-ia-passo-a-passo.md`.

**Goal:** a IA propõe o curso a partir de uma ideia; a pessoa confere em 4 passos.
**Architecture:** novos status `PROPOSTA_GERANDO/PROPOSTA_PRONTA/ERRO_PROPOSTA` na mesma tabela e na mesma fila; proposta em `pedido.proposta`; as views ganham a barra de passos e o formulário da proposta.

## Global Constraints
- Sem migração.
- CSP sem JS inline.
- Faixas da proposta: carga 1–600, módulos 2–12, parcelas 1–12, preço 0–10000.
- Mensagens em português.

## Review Focus
1. Proposta pronta e a pessoa abre a lista: uma 2ª geração é recusada (EM_ANDAMENTO).
2. Confirmar proposta com nome de curso que já existe: volta com o erro e mantém o que foi digitado.
3. Serviço reiniciado durante `PROPOSTA_GERANDO`: a varredura retoma.
4. Cancelar na proposta: nada é criado no curso.
5. Destino "existente": a proposta não pede nome/preço e confirma sem eles.

### Task 1: Lib e fila
**Files:**
- `src/lib/ead-ia-esquema.js`: `ESQUEMA_PROPOSTA`, `validarProposta(json) -> {ok, proposta}|{ok:false, erro}`.
- `src/lib/ead-ia.js`:
  - `criarGeracao` passa a criar em `PROPOSTA_GERANDO`;
  - novas `gerarProposta(id, {cliente})`, `pedirOutraProposta(id, ator) -> {ok}|{ok:false,erro}`, `confirmarProposta(id, pedidoNovo, ator)` e `voltarParaProposta(id, ator)`;
  - `EM_ANDAMENTO` e `cancelar` ampliados.
- `src/lib/ead-ia-fila.js`: `passo` faz `PROPOSTA_GERANDO` primeiro.
- `test/helpers/ia-falso.js`: `propostaBoa()`.

**Test:** `test/ead-ia-proposta.test.js`; ajustar `test/ead-ia.test.js` e `test/ead-ia-fila.test.js`, onde criam a geração já no roteiro.

### Task 2: Rotas e telas
**Files:**
- `src/routes/ead.js`:
  - `/ead/ia/novo`: só a ideia, o material e o destino;
  - novas `POST /ead/ia/:id/proposta` (confirmar), `/proposta-de-novo` e `/voltar-proposta`;
  - `lerPedidoIa` reaproveitado na confirmação.
- `src/views/admin/ead/ia-form.ejs` (passo 1) e `ia-geracao.ejs` (barra de passos, proposta, "próximos passos").
- `ia-lista.ejs`: rótulos dos status novos.
- CSS em `src/public/ead-admin.css`.

**Test:** `test/ead-ia-painel.test.js` (ajustar o fluxo) e novos casos de rota.

### Task 3: Ciclo pela interface, documentação e revisão
- `docs/ead/como-publicar-um-curso.md`: o passo a passo.
- Prints do ciclo com o Claude falso.
- Revisão final e PR.
