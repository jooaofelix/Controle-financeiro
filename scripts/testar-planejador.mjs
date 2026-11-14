// Testes do planejador: node scripts/testar-planejador.mjs
import assert from 'node:assert/strict';
import { planejar, simular } from '../public/planejador.js';

const R = (reais) => Math.round(reais * 100);
let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log('✓', nome); };

teste('saldo simples: salário dia 5, aluguel dia 10', () => {
  const s = simular({ rendas: [{ valor: R(5000), dia: 5 }], contas: [{ id: 1, nome: 'Aluguel', valor: R(2000), dia: 10 }], cartoes: [], saldoInicial: 0, gastoVariavel: 0 });
  assert.equal(s.saldos[4], 0);
  assert.equal(s.saldos[5], R(5000));
  assert.equal(s.fim, R(3000));
});

teste('conta flexível antes do salário é movida para depois', () => {
  const r = planejar({
    rendas: [{ valor: R(5000), dia: 5 }],
    contas: [{ id: 1, nome: 'Internet', valor: R(120), dia: 1, flexivel: true }],
    cartoes: [], saldoInicial: 0, gastoVariavel: 0,
  });
  assert.equal(r.sugestoes.length, 1);
  const s = r.sugestoes[0];
  assert.equal(s.de, 1);
  assert.ok(s.para >= 6 && s.para <= 10, 'deve ir para 1–5 dias após o salário, foi ' + s.para);
  assert.ok(s.minDepois > s.minAntes);
  assert.equal(r.alertas[0].nivel, 'critico'); // hoje fica negativo
});

teste('conta não-flexível nunca é sugerida', () => {
  const r = planejar({
    rendas: [{ valor: R(5000), dia: 5 }],
    contas: [{ id: 1, nome: 'Aluguel', valor: R(2000), dia: 1, flexivel: false }],
    cartoes: [], saldoInicial: 0, gastoVariavel: 0,
  });
  assert.equal(r.sugestoes.length, 0);
  assert.equal(r.antesSalario.length, 1);
});

teste('conta já bem posicionada não gera sugestão', () => {
  const r = planejar({
    rendas: [{ valor: R(5000), dia: 5 }],
    contas: [{ id: 1, nome: 'Luz', valor: R(200), dia: 7, flexivel: true }],
    cartoes: [], saldoInicial: 0, gastoVariavel: 0,
  });
  assert.equal(r.sugestoes.length, 0);
  assert.equal(r.alertas.length, 0);
});

teste('dois salários: fatura grande vai para depois do salário maior', () => {
  const r = planejar({
    rendas: [{ valor: R(6500), dia: 5 }, { valor: R(4800), dia: 20 }],
    contas: [{ id: 1, nome: 'Aluguel', valor: R(1800), dia: 10, flexivel: false }],
    cartoes: [{ id: 2, nome: 'Nubank', fechamento: 26, vencimento: 3, valor: R(3500), flexivel: true }],
    saldoInicial: R(500), gastoVariavel: R(2000),
  });
  const s = r.sugestoes.find((x) => x.tipo === 'cartao');
  assert.ok(s, 'deveria sugerir mudar a fatura');
  assert.ok(s.para >= 6 && s.para <= 10, 'fatura deveria ir para depois do dia 5, foi ' + s.para);
  const c = r.cartoes[0];
  assert.equal((c.vencimento - c.fechamento + 30) % 30, 7, 'fechamento acompanha o vencimento (7 dias antes)');
  assert.equal(c.melhorDiaCompra, c.fechamento + 1);
  assert.ok(r.final.min >= r.base.min);
  console.log('   ', JSON.stringify(r.sugestoes.map(s => [s.nome, s.de, s.para, s.minAntes/100, s.minDepois/100])), 'compra dia', c.melhorDiaCompra);
});

teste('melhor dia de compra com virada de mês', () => {
  const r = planejar({ rendas: [], contas: [], cartoes: [{ id: 1, nome: 'Inter', fechamento: 30, vencimento: 7, valor: 0, flexivel: true }], saldoInicial: 0, gastoVariavel: 0 });
  assert.equal(r.cartoes[0].melhorDiaCompra, 1);
  assert.equal(r.cartoes[0].prazo, 36);
});

teste('renda menor que gastos gera alerta de corte', () => {
  const r = planejar({ rendas: [{ valor: R(3000), dia: 5 }], contas: [{ id: 1, nome: 'Aluguel', valor: R(2500), dia: 6 }], cartoes: [], saldoInicial: 0, gastoVariavel: R(1000) });
  assert.ok(r.resumo.sobra < 0);
  assert.ok(r.alertas.some((a) => a.texto.includes('cortar')));
});

console.log(`\n${ok} testes passaram`);

// Conversão de valores do servidor
const { paraCentavos } = await import('../src/valores.js');
teste('valores em reais', () => {
  assert.equal(paraCentavos('1.800'), 180000);
  assert.equal(paraCentavos('1.800,50'), 180050);
  assert.equal(paraCentavos('R$ 52,90'), 5290);
  assert.equal(paraCentavos('52.90'), 5290);
  assert.equal(paraCentavos('52.9'), 5290);
  assert.equal(paraCentavos(189.5), 18950);
  assert.equal(paraCentavos('1.234.567'), 123456700);
  assert.equal(paraCentavos('abc'), 0);
});
teste('ganho pequeno (R$ 3) não vira sugestão', () => {
  // Pior dia hoje: dia 4 (conta antes do salário). Movendo a conta, o pior dia passa a ser o 30,
  // só R$ 3 melhor — não vale pedir para a empresa trocar a data.
  const plano = {
    rendas: [{ valor: R(2603), dia: 5 }],
    contas: [{ id: 1, nome: 'Internet', valor: R(500), dia: 1, flexivel: true }],
    cartoes: [], saldoInicial: R(1000), gastoVariavel: R(3000),
  };
  const r = planejar(plano);
  assert.equal(r.sugestoes.length, 0);
});
console.log(`${ok} testes passaram no total`);
