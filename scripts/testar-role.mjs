// Testes do parceiro do rolê: node scripts/testar-role.mjs
import assert from 'node:assert/strict';
import { parceiroDoRole } from '../public/role.js';

let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log('✓', nome); };
const R = (x) => Math.round(x * 100);
const itens = [
  { id: 1, tipo: 'renda', pessoa: 'Marido', valor: R(4000), dia: 5 },
  { id: 3, tipo: 'conta', nome: 'Aluguel', valor: R(1800), dia: 10 },
  { id: 4, tipo: 'conta', nome: 'Luz', valor: R(200), dia: 28 },
];
const pagos = [{ plano_id: 3, plano_mes: '2026-11', valor: R(1800), data: '2026-11-10' }]; // aluguel de novembro pago

teste('fim de semana: o que sobra depois de separar as contas até o salário', () => {
  // hoje 20/11, saldo 3000; até o salário (05/12) vence a luz (200); dia a dia 30/dia fora do período
  const r = parceiroDoRole({ saldoAgora: R(3000), hojeISO: '2026-11-20', de: '2026-11-21', ate: '2026-11-22', itens, pagamentos: pagos, gastoVariavelMensal: R(900) });
  assert.equal(r.limite, '2026-12-04');
  assert.equal(r.salario.data, '2026-12-05');
  // dias fora do período de 20/11 a 04/12: 15 - 2 = 13 dias × 30 = 390; contas: 200
  assert.equal(r.livre, R(3000 - 200 - 390));
  assert.equal(r.dias, 2);
  assert.equal(r.porDia, Math.floor(r.livre / 2));
  assert.equal(r.diaADiaNormal, R(60));
});

teste('conta que vence depois do salário não segura o dinheiro do rolê', () => {
  // até o salário de 05/12 o aluguel de 10/12 não conta
  const r = parceiroDoRole({ saldoAgora: R(1000), hojeISO: '2026-11-29', de: '2026-11-29', ate: '2026-12-04', itens, pagamentos: [...pagos, { plano_id: 4, plano_mes: '2026-11', valor: R(200), data: '2026-11-28' }] });
  assert.equal(r.livre, R(1000));
  assert.ok(!r.contas.some((c) => c.nome === 'Aluguel'));
});

teste('salário no meio do período: dá para gastar mais, mas por igual (o começo é o aperto)', () => {
  // saldo 100, período 01/12 a 10/12, salário 05/12 (4000), aluguel 10/12 (1800); próximo salário 05/01
  const r = parceiroDoRole({ saldoAgora: R(100), hojeISO: '2026-12-01', de: '2026-12-01', ate: '2026-12-10', itens });
  // dias 1-4: k/10 do valor gasto com só 100 na conta → livre ≤ 100*10/4 = 250
  assert.equal(r.livre, R(250));
  assert.equal(r.aperto, '2026-12-04');
});

teste('sem folga: valor negativo e reserva respeitada', () => {
  const r = parceiroDoRole({ saldoAgora: R(150), hojeISO: '2026-11-20', de: '2026-11-21', ate: '2026-11-22', itens, pagamentos: pagos });
  assert.equal(r.livre, R(-50)); // a luz (200) não cabe
  const c = parceiroDoRole({ saldoAgora: R(3000), hojeISO: '2026-11-20', de: '2026-11-21', ate: '2026-11-22', itens, pagamentos: pagos, reserva: R(500) });
  assert.equal(c.livre, R(3000 - 200 - 500));
});

teste('conta atrasada (não paga) é separada hoje', () => {
  const r = parceiroDoRole({ saldoAgora: R(3000), hojeISO: '2026-11-20', de: '2026-11-21', ate: '2026-11-22', itens });
  assert.equal(r.livre, R(3000 - 1800 - 200));
  assert.equal(r.contas[0].tipo, 'atrasada');
});

console.log(`\n${ok} testes do parceiro do rolê passaram`);
