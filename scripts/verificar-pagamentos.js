// Uso, na RAIZ do projeto (no Render: aba Shell do serviço da escola):
//   node scripts/verificar-pagamentos.js "Nome da Aluna"
//   node scripts/verificar-pagamentos.js email@exemplo.com
//
// Só LÊ: não muda nada no banco nem na Únicopag. Mostra, para a pessoa:
//   1. as contas na escola (pelo nome ou e-mail), as matrículas e os pagamentos de cada uma;
//   2. as transações nas duas contas da Únicopag (escola e instituição) com o mesmo e-mail,
//      CPF ou nome;
//   3. os sinais de pagamento em dobro:
//      - dois pagamentos PAGO do mesmo tipo na mesma matrícula;
//      - taxa paga na escola e também na instituição (matrícula rápida);
//      - duas transações pagas na Únicopag com o mesmo valor.

require('dotenv').config();
const prisma = require('../src/db');
const unicopag = require('../src/lib/unicopag');

const busca = process.argv.slice(2).join(' ').trim();
if (!busca) {
  console.error('Informe o nome ou o e-mail. Ex.: node scripts/verificar-pagamentos.js "Maria da Silva"');
  process.exit(1);
}

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const brl = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dt = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
const PAGO_GATEWAY = ['paid', 'pago', 'success', 'captured', 'approved', 'authorized'];

(async () => {
  const ehEmail = busca.includes('@');
  const palavras = semAcento(busca).split(/\s+/).filter(Boolean);

  // 1) Contas na escola. O nome é comparado sem acento e palavra por palavra.
  let usuarios;
  if (ehEmail) {
    usuarios = await prisma.usuario.findMany({ where: { email: { equals: busca.toLowerCase(), mode: 'insensitive' } } });
  } else {
    const candidatos = await prisma.usuario.findMany({
      where: { AND: palavras.slice(0, 1).map((p) => ({ nome: { contains: p, mode: 'insensitive' } })) },
    });
    usuarios = candidatos.filter((u) => palavras.every((p) => semAcento(u.nome).includes(p)));
    if (!usuarios.length) usuarios = candidatos.filter((u) => palavras.filter((p) => semAcento(u.nome).includes(p)).length >= 2);
  }

  const alertas = [];
  console.log(`\n=== Escola: ${usuarios.length} conta(s) para "${busca}" ===`);
  const emails = new Set(ehEmail ? [busca.toLowerCase()] : []);
  const docs = new Set();
  for (const u of usuarios) {
    if (u.email) emails.add(u.email.toLowerCase());
    if (u.cpfCnpj) docs.add(u.cpfCnpj);
    console.log(`\n• ${u.nome} <${u.email}> · conta criada em ${dt(u.criadoEm)}`);
    const matriculas = await prisma.matricula.findMany({
      where: { alunoId: u.id },
      include: { turma: { include: { curso: true } }, pagamentos: { orderBy: { criadoEm: 'asc' } } },
      orderBy: { criadoEm: 'asc' },
    });
    if (!matriculas.length) console.log('  (sem matrículas)');
    for (const m of matriculas) {
      console.log(`  Matrícula ${m.id.slice(0, 8)} · ${m.turma.curso.nome} · turma ${dt(m.turma.inicioPrevisto).slice(0, 10)} · ${m.plano} · ${m.statusPagamento} · total ${brl(m.valorCurso)} · taxa ${brl(m.valorTaxaMatricula)}${m.taxaConfirmada ? ' (confirmada)' : ''}`);
      for (const p of m.pagamentos) {
        console.log(`    - ${p.tipo.padEnd(5)} ${brl(p.valor).padStart(12)} · ${p.status.padEnd(9)} · ${p.metodo} · ${p.gateway || 'sem gateway'} · ${p.gatewayRef || '—'} · ${dt(p.criadoEm)} · ${p.gatewayStatus || ''}`);
      }
      for (const tipo of ['TAXA', 'CURSO']) {
        const pagos = m.pagamentos.filter((p) => p.tipo === tipo && p.status === 'PAGO');
        if (pagos.length > 1) alertas.push(`${u.nome}: ${pagos.length} pagamentos de ${tipo} PAGO na matrícula ${m.id.slice(0, 8)} (${pagos.map((p) => brl(p.valor) + ' ' + (p.gateway || '')).join(' + ')})`);
      }
      const taxaEscola = m.pagamentos.find((p) => p.tipo === 'TAXA' && p.status === 'PAGO' && p.gateway !== 'unicopag-2' && p.gateway !== 'manual');
      const taxaInst = m.pagamentos.find((p) => p.tipo === 'TAXA' && p.status === 'PAGO' && p.gateway === 'unicopag-2');
      if (taxaEscola && taxaInst) alertas.push(`${u.nome}: taxa paga na escola (${brl(taxaEscola.valor)}) E na instituição (${brl(taxaInst.valor)}) na matrícula ${m.id.slice(0, 8)}`);
    }
    const rapidas = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'matricularapida:' }, valor: { contains: u.id } } });
    for (const r of rapidas) console.log(`  Matrícula rápida ligada: ${r.chave} → ${r.valor.slice(0, 200)}`);
  }

  // 2) Únicopag: as duas contas, pelo e-mail, CPF ou nome.
  for (const contaId of ['principal', 'segunda']) {
    const c = unicopag.conta(contaId);
    console.log(`\n=== Únicopag · ${c.nome} (${contaId}) ===`);
    if (!c.token) { console.log('  (sem chave neste serviço)'); continue; }
    const r = await unicopag.listarTransacoes(contaId, { forcar: true });
    if (!r.ok) { console.log(`  (não foi possível ler: ${r.erro})`); continue; }
    const achadas = r.lista.filter((t) => (t.email && emails.has(t.email))
      || (t.documento && docs.has(t.documento))
      || (!ehEmail && t.nome && palavras.every((p) => semAcento(t.nome).includes(p))));
    if (!achadas.length) console.log('  (nenhuma transação)');
    for (const t of achadas) {
      console.log(`  - ${brl(t.valor).padStart(12)} (total ${brl(t.valorTotal)}) · ${t.status} · ${t.metodo}${t.parcelas > 1 ? ' ' + t.parcelas + 'x' : ''} · ${t.hash} · criada ${dt(t.criadoEm)} · ${t.nome || ''} <${t.email || ''}> · ${t.titulo || ''}`);
    }
    const pagas = achadas.filter((t) => PAGO_GATEWAY.includes(t.status));
    const porValor = {};
    for (const t of pagas) (porValor[t.valor] = porValor[t.valor] || []).push(t);
    for (const [valor, ts] of Object.entries(porValor)) {
      if (ts.length > 1) alertas.push(`Únicopag ${contaId}: ${ts.length} transações PAGAS de ${brl(valor)} (${ts.map((t) => t.hash).join(', ')})`);
    }
  }

  console.log('\n=== Resultado ===');
  if (!alertas.length) console.log('Nenhum sinal de pagamento em dobro.');
  else alertas.forEach((a) => console.log('⚠️  ' + a));
  console.log('');
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
