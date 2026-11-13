# Turma só vira Concluída no dia seguinte à última aula — desenho curto

**Intenção (do Matheus):** a turma Confirmada só pode virar Concluída um dia depois do dia da aula (a última), nunca com base no dia em que virou Confirmada. Marcar Confirmada antes já fecha as inscrições (o site só aceita Aberta); a ideia de um status FECHADA foi descartada.

**Hoje:** `concluir-turmas.js` já conclui sozinho a Confirmada no dia seguinte à última aula (sem aula, vale o início), no horário de Brasília. Mas o formulário da turma deixa escolher "Concluída" a qualquer momento.

**Abordagens consideradas**
1. Recusar o salvamento com erro e a data a partir da qual pode.
2. **Escolhida:** aceitar e agendar: se "Concluída" for escolhida antes da hora, a turma é salva como **Confirmada** e a mensagem diz o dia em que ela vira Concluída sozinha. Ninguém fica travado e a turma nunca aparece concluída antes do curso.
3. Esconder a opção do menu: a pessoa não entenderia por quê.

**Regra:** último dia = maior data entre as aulas do formulário (sem aulas, o início previsto). Pode concluir só se último dia < hoje (Brasília) — a mesma regra da conclusão automática. Vale para criar e editar turma, para todos os papéis (inclusive o assistente, que só preenche o formulário).

**Mensagem:** "Turma salva como Confirmada: ela vira Concluída sozinha em DD/MM/AAAA, o dia seguinte à última aula."
**Dica no formulário**, abaixo do status: "Concluída só a partir do dia seguinte à última aula — o sistema conclui sozinho."

**Fora do escopo:** Aberta, Confirmada, Congelada e Cancelada continuam livres; a conclusão automática não muda.
