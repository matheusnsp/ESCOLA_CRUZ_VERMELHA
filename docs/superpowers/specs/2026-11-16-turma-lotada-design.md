# Turma lotada vira Confirmada sozinha — desenho curto

**Pedido (Matheus):** quando a turma bater o limite de alunos, vira Confirmada automaticamente, ou seja, novas inscrições bloqueadas.
**Decidido com ele:** o limite é o campo "Vagas" de cada turma (padrão 30), não um 30 fixo.

**Hoje:** o site não bloqueia por lotação; "Vagas" só aparece na tela e no Mover da Matrícula rápida.

**Regra:** turma **Aberta** cujas inscrições com a taxa paga e valendo (PAGO, PARCELADO, PENDENTE) chegam ao número de vagas vira **Confirmada** — a mesma conta da barrinha "18 de 30 vagas". Confirmada some do site, não aceita inscrição nem encaixe na Matrícula rápida.

**Quando confere:** junto da confirmação da meia-noite (`atualizarStatusTurmas` em `lib/concluir-turmas.js`), que roda antes de cada nova inscrição no site (POST), de hora em hora, ao abrir a lista de Turmas e no resumo do site.

**Calls do Claude:** quem começou a inscrição e não pagou não ocupa vaga; se alguém sair, a turma continua Confirmada (a secretaria reabre como Aberta; se ainda estiver cheia, fecha de novo); duas pessoas pagando no mesmo instante podem passar 1 da conta (não há trava no pagamento).

**Fora do escopo:** congelada/cancelada/concluída não mudam; nenhuma mudança no checkout.

## Aviso no painel (pedido seguinte do Matheus)
Ao fechar por lotação, a turma guarda `lotouEm` (lib/extras). O Painel (topo) e o resumo da turma mostram: "A turma de <curso> · dd/mm lotou (N vagas) e fechou sozinha para novas inscrições. Para continuar vendendo o curso, abra uma nova turma." com o botão **Abrir nova turma** (`/turmas/nova?curso=<id>`). Só para quem cria turma. O aviso some sozinho quando o curso ganha outra turma Aberta e futura, quando a turma é reaberta ou quando ela começa.
