// Testes dos dias úteis: node scripts/testar-diasuteis.mjs
import assert from 'node:assert/strict';
import { enesimoDiaUtil, ehDiaUtil, diaDoSalario, feriados } from '../public/diasuteis.js';

let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log('✓', nome); };

teste('5º dia útil de cada mês (fim de semana e feriado não contam)', () => {
  assert.equal(enesimoDiaUtil('2026-12', 5), 7);  // 1 ter, 2, 3, 4, 7 seg
  assert.equal(enesimoDiaUtil('2026-11', 5), 9);  // 2/11 feriado: 3,4,5,6,9
  assert.equal(enesimoDiaUtil('2027-01', 5), 8);  // 1/1 feriado (sex): 4,5,6,7,8
  assert.equal(enesimoDiaUtil('2026-09', 5), 8);  // 7/9 feriado (seg): 1,2,3,4,8
});

teste('feriados móveis: Carnaval, Sexta-feira Santa e Corpus Christi', () => {
  const f = feriados(2026);
  for (const d of ['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04']) assert.ok(f.has(d), d);
  assert.equal(ehDiaUtil('2026-02-18'), true); // Quarta de Cinzas: banco abre (à tarde)
  assert.equal(ehDiaUtil('2026-02-16'), false); // segunda de Carnaval: banco fechado
});

teste('salário fixo ou por dia útil', () => {
  assert.equal(diaDoSalario({ dia: 10 }, '2026-12'), 10);
  assert.equal(diaDoSalario({ dia: 5, diaUtil: 5 }, '2026-12'), 7);
});

console.log(`\n${ok} testes de dias úteis passaram`);
