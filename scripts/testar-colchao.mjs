// Testes do colchão: node scripts/testar-colchao.mjs
import assert from 'node:assert/strict';
import { nivelDoColchao, ritmoDaMeta } from '../public/colchao.js';

let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log('✓', nome); };
const R = (x) => Math.round(x * 100);

teste('níveis: colchonete, solteiro, casal, queen e king', () => {
  assert.equal(nivelDoColchao(0).nome, 'Colchonete');
  assert.equal(nivelDoColchao(R(999)).nome, 'Colchonete');
  assert.equal(nivelDoColchao(R(1000)).nome, 'Colchão de solteiro');
  assert.equal(nivelDoColchao(R(7000)).nome, 'Colchão de casal');
  assert.equal(nivelDoColchao(R(20000)).nome, 'Queen size');
  assert.equal(nivelDoColchao(R(50000)).nome, 'King size');
  const n = nivelDoColchao(R(3000));
  assert.equal(n.faltaProximo, R(2000));
  assert.equal(n.proximo.nome, 'Colchão de casal');
  assert.equal(n.progresso, 0.5);
  assert.equal(nivelDoColchao(R(50000)).proximo, null);
});

teste('meta com data: quanto guardar por mês', () => {
  // faltam 3000 até março: dez, jan, fev, mar = 4 meses → 750/mês
  const r = ritmoDaMeta({ meta: R(5000), saldo: R(2000), data_meta: '2027-03-20' }, '2026-12-05');
  assert.equal(r.falta, R(3000));
  assert.equal(r.meses, 4);
  assert.equal(r.porMes, R(750));
  // meta batida
  assert.equal(ritmoDaMeta({ meta: R(100), saldo: R(150) }, '2026-12-05').pronto, true);
  // sem data: só o que falta
  assert.equal(ritmoDaMeta({ meta: R(100), saldo: R(40) }, '2026-12-05').porMes, null);
  // sem meta
  assert.equal(ritmoDaMeta({ saldo: R(40) }, '2026-12-05'), null);
});

console.log(`\n${ok} testes do colchão passaram`);
