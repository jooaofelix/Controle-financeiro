// Testes do vínculo gasto ↔ conta prevista: node scripts/testar-vinculos.mjs
import assert from 'node:assert/strict';
import { mesReferencia, sugerirVinculo, situacaoMes, itensPagaveis } from '../public/vinculos.js';

let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log('✓', nome); };
const R = (x) => Math.round(x * 100);
const plano = [
  { id: 1, tipo: 'conta', nome: 'Luz Enel', valor: R(230), dia: 15 },
  { id: 2, tipo: 'conta', nome: 'Internet', valor: R(120), dia: 2 },
  { id: 3, tipo: 'conta', nome: 'Netflix', valor: R(55.9), dia: 12 },
  { id: 4, tipo: 'cartao', nome: 'Nubank', fechamento: 26, vencimento: 3, valor: R(2500) },
  { id: 5, tipo: 'divida', nome: 'Geladeira', valor: R(250), dia: 16, pagamento: 'boleto', total: 12, inicio: '2026-08' },
  { id: 6, tipo: 'divida', nome: 'Celular', valor: R(150), dia: 5, pagamento: 'Nubank', total: 10, inicio: '2026-06' },
  { id: 7, tipo: 'renda', pessoa: 'Marido', valor: R(6500), dia: 5 },
];
const gasto = (o) => ({ tipo: 'despesa', meio: 'boleto', ...o });

teste('mês de referência: pagar no fim do mês a conta do dia 2 conta para o mês seguinte', () => {
  assert.equal(mesReferencia('2026-11-30', 2), '2026-12');
  assert.equal(mesReferencia('2026-11-14', 15), '2026-11');
  assert.equal(mesReferencia('2026-12-03', 2), '2026-12');
  assert.equal(mesReferencia('2027-01-01', 31), '2026-12'); // virada de ano e mês curto
});

teste('só contas fixas, faturas e dívidas no boleto recebem pagamento', () => {
  assert.deepEqual(itensPagaveis(plano).map((i) => i.id), [1, 2, 3, 4, 5]);
});

teste('nome parecido + valor próximo vincula (boleto da Enel → Luz Enel)', () => {
  const s = sugerirVinculo(gasto({ descricao: 'Pagamento de boleto - ENEL DISTRIBUICAO', valor: R(241.37), data: '2026-11-14' }), plano);
  assert.equal(s.id, 1);
  assert.equal(s.mes, '2026-11');
});

teste('assinatura no crédito vincula pelo nome (NETFLIX.COM → Netflix)', () => {
  const s = sugerirVinculo(gasto({ descricao: 'NETFLIX.COM', valor: R(55.9), data: '2026-11-12', meio: 'credito' }), plano);
  assert.equal(s.id, 3);
});

teste('valor igual perto do vencimento vincula mesmo sem nome (Pix de R$ 120 no dia 2)', () => {
  const s = sugerirVinculo(gasto({ descricao: 'Pix enviado - FULANO TELECOM', valor: R(120), data: '2026-12-02', meio: 'pix' }), plano);
  assert.equal(s.id, 2);
  assert.equal(s.mes, '2026-12');
});

teste('mesmo valor no crédito, sem nome parecido, NÃO vincula (Uber de R$ 120 no dia 2)', () => {
  assert.equal(sugerirVinculo(gasto({ descricao: 'UBER TRIP', valor: R(120), data: '2026-12-02', meio: 'credito' }), plano), null);
});

teste('valor muito diferente ou longe do vencimento não vincula', () => {
  assert.equal(sugerirVinculo(gasto({ descricao: 'ENEL', valor: R(900), data: '2026-11-14' }), plano), null);
  assert.equal(sugerirVinculo(gasto({ descricao: 'Pix', valor: R(120), data: '2026-11-20', meio: 'pix' }), plano), null);
});

teste('conta já paga no mês não recebe segundo vínculo automático', () => {
  const s = sugerirVinculo(gasto({ descricao: 'ENEL', valor: R(230), data: '2026-11-15' }), plano, new Set(['1:2026-11']));
  assert.equal(s, null);
});

teste('pagamento de fatura vincula ao cartão', () => {
  const s = sugerirVinculo(gasto({ descricao: 'Pagamento de fatura Nubank', valor: R(2380), data: '2026-12-03', meio: 'debito' }), plano);
  assert.equal(s.id, 4);
  assert.equal(s.nome, 'Fatura Nubank');
});

teste('entrada nunca vincula a conta', () => {
  assert.equal(sugerirVinculo({ tipo: 'receita', descricao: 'ENEL', valor: R(230), data: '2026-11-15' }, plano), null);
});

teste('situação do mês: paga, atrasada e pendente', () => {
  const pagos = [{ plano_id: 1, plano_mes: '2026-11', valor: R(241.37), data: '2026-11-14' }];
  const s = situacaoMes(plano, pagos, '2026-11', '2026-11-20');
  const por = Object.fromEntries(s.map((x) => [x.id, x]));
  assert.equal(por[1].estado, 'paga');
  assert.equal(por[1].pago, R(241.37));
  assert.equal(por[2].estado, 'atrasada'); // venceu dia 2 sem pagamento
  assert.equal(por[5].estado, 'atrasada'); // geladeira venceu dia 16
  const s2 = situacaoMes(plano, [], '2026-11', '2026-11-10');
  assert.equal(s2.find((x) => x.id === 3).estado, 'pendente');
  assert.equal(s2.find((x) => x.id === 3).diasPara, 2);
});

console.log(`\n${ok} testes de vínculo passaram`);
