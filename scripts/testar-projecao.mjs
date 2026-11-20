// Testes da previsão com saldo real: node scripts/testar-projecao.mjs
import assert from 'node:assert/strict';
import { projetarMes } from '../public/projecao.js';

let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log('✓', nome); };
const R = (x) => Math.round(x * 100);
const itens = [
  { id: 1, tipo: 'renda', pessoa: 'Marido', valor: R(4000), dia: 5 },
  { id: 2, tipo: 'renda', pessoa: 'Esposa', valor: R(3280), dia: 25 },
  { id: 3, tipo: 'conta', nome: 'Aluguel', valor: R(1800), dia: 10 },
  { id: 4, tipo: 'conta', nome: 'Internet', valor: R(120), dia: 2 },
  { id: 5, tipo: 'conta', nome: 'Luz', valor: R(230), dia: 28 },
  { id: 6, tipo: 'cartao', nome: 'Inter', fechamento: 20, vencimento: 27, valor: R(1500) },
  { id: 7, tipo: 'divida', nome: 'Geladeira', valor: R(250), dia: 16, pagamento: 'boleto', total: 12, inicio: '2026-08' },
  { id: 8, tipo: 'divida', nome: 'TV', valor: R(100), dia: 22, pagamento: 'boleto', total: 3, inicio: '2026-06' }, // já quitada
];
const pagos = [
  { plano_id: 3, plano_mes: '2026-11', valor: R(1800), data: '2026-11-10' },
  { plano_id: 7, plano_mes: '2026-11', valor: R(250), data: '2026-11-16' },
];

teste('só entra o que ainda falta: salário futuro, contas não pagas, dia a dia restante', () => {
  const p = projetarMes({ saldoAgora: R(2000), hojeISO: '2026-11-20', itens, pagamentos: pagos, gastoVariavelMensal: R(3000) });
  // a receber: só o salário do dia 25 (o do dia 5 já está no saldo)
  assert.equal(p.aReceber, R(3280));
  // a pagar: internet atrasada (120) + luz (230) + fatura (1500); aluguel e geladeira pagos; TV quitada
  assert.equal(p.aPagar, R(1850));
  assert.equal(p.diasRestantes, 11); // 20 a 30 de novembro
  assert.equal(p.diaADia, R(1100));  // 100/dia
  assert.equal(p.fim, R(2000 + 3280 - 1850 - 1100));
});

teste('conta atrasada sem pagamento entra como paga hoje', () => {
  const p = projetarMes({ saldoAgora: R(2000), hojeISO: '2026-11-20', itens, pagamentos: pagos });
  const internet = p.eventos.find((e) => e.nome === 'Internet');
  assert.equal(internet.dia, 20);
  assert.equal(internet.tipo, 'atrasada');
});

teste('menor saldo e dia: antes do salário cair', () => {
  const p = projetarMes({ saldoAgora: R(500), hojeISO: '2026-11-20', itens, pagamentos: pagos, gastoVariavelMensal: R(3000) });
  // 500 -120 (internet hoje) -100*5 (20..24) = -120 no dia 24; salário entra dia 25
  assert.equal(p.diaMin, 24);
  assert.equal(p.min, R(-120));
});

teste('com tudo pago e sem salário a receber, só o dia a dia mexe', () => {
  const tudoPago = [3, 4, 5, 6, 7].map((id) => ({ plano_id: id, plano_mes: '2026-11', valor: 1, data: '2026-11-01' }));
  const p = projetarMes({ saldoAgora: R(1000), hojeISO: '2026-11-26', itens, pagamentos: tudoPago, gastoVariavelMensal: R(600) });
  assert.equal(p.aPagar, 0);
  assert.equal(p.aReceber, 0);
  assert.equal(p.fim, R(1000 - 20 * 5)); // dias 26..30
});

console.log(`\n${ok} testes de previsão passaram`);
