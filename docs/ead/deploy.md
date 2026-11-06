# Deploy do EAD (curso online)

Roteiro para colocar no ar o curso online. São as etapas 1 a 8, do PR final `ead-lancamento` → `main`.

## Antes

1. **Faça backup do banco de produção** (dump completo) e guarde-o fora do servidor.
2. **Confira a tabela `_prisma_migrations` em produção.**
   - O histórico de `prisma/migrations` não bate com o `schema.prisma` antigo (há colunas que nenhuma migração cria; veja o PR #92).
   - Em produção, rode:
     ```sql
     SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name;
     ```
   - Confira que todas as migrações **anteriores** ao EAD já constam como aplicadas. As únicas pendentes devem ser as 6 do EAD, nesta ordem:
     1. `20261105120000_ead_estrutura`: conteúdo do curso online e a turma ONLINE.
     2. `20261106120000_ead_aluno`: progresso do aluno.
     3. `20261107120000_ead_venda`: preço e publicação do curso online.
     4. `20261108120000_ead_duvidas`: dúvidas por aula e curso só online.
     5. `20261109120000_ead_lote`: escolas, lotes e vagas.
     6. `20261110120000_ead_cupom`: cupons e parcelas.
   - Se aparecer outra migração pendente, **pare** e confira antes de seguir.
   - Todas as migrações do EAD só **acrescentam** tabelas e colunas. O `scripts/checar-migracao-ead.js` confere isso.

## Deploy

3. `npx prisma migrate deploy`: aplica as 6 migrações.
4. **Variáveis de ambiente:** as de sempre (`DATABASE_URL`, `APP_URL`, Únicopag, e-mail). O EAD não pede nenhuma nova.
5. Faça o deploy da aplicação (o mesmo processo de hoje).

## Depois

6. **Confira:**
   - o site abre;
   - `/cursos` mostra os cursos de sempre;
   - o painel abre e o seletor **Online** aparece para contas DEV;
   - o Financeiro abre com os mesmos números de antes.
7. **Desligue os links de teste** de todo curso que for publicado. O link de teste abre o curso e emite certificado sem pagamento.
8. **Publique** pelo passo a passo em `docs/ead/como-publicar-um-curso.md`.

## Atenção

- **Não volte o deploy** para uma versão anterior ao EAD depois que existir uma turma ONLINE. O Prisma antigo não conhece o status `ONLINE` e quebra as consultas de turma (o mesmo já acontece com `EM_ESPERA`).
- **As etapas usam transações interativas.** Faça o deploy do pacote inteiro, não de partes.
- **Se algo der errado antes de existir turma ONLINE:** volte o deploy e restaure o backup. As tabelas novas podem ficar; o código antigo não as usa.
