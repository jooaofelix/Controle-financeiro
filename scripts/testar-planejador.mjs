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

// ---------- Dívidas parceladas ----------
const D = await import('../public/dividas.js');
const geladeira = { id: 1, nome: 'Geladeira', valor: R(250), total: 12, inicio: '2026-08', dia: 10, pagamento: 'boleto', categoria: 'Casa' };

teste('meses: soma e diferença com virada de ano', () => {
  assert.equal(D.somaMeses('2026-11', 3), '2027-02');
  assert.equal(D.somaMeses('2027-01', -2), '2026-11');
  assert.equal(D.mesesEntre('2026-08', '2027-07'), 11);
  assert.equal(D.mesAno('2027-03'), 'mar/27');
});

teste('parcela atual informada vira mês de início', () => {
  assert.equal(D.inicioDe(4, '2026-11-14'), '2026-08');
  assert.equal(D.inicioDe(1, '2026-11-14'), '2026-11');
});

teste('situação antes e depois do vencimento do mês', () => {
  const antes = D.situacao(geladeira, '2026-11-05');   // parcela 4 vence dia 10
  assert.equal(antes.pagas, 3);
  assert.equal(antes.restantes, 9);
  assert.equal(antes.valorRestante, R(2250));
  assert.equal(antes.fim, '2027-07');
  const depois = D.situacao(geladeira, '2026-11-10');
  assert.equal(depois.pagas, 4);
  assert.ok(depois.ativaNoMes);
});

teste('dívida quitada e dívida que ainda não começou', () => {
  const q = D.situacao(geladeira, '2027-07-20');
  assert.ok(q.quitada);
  assert.equal(q.restantes, 0);
  const futura = D.situacao({ ...geladeira, inicio: '2027-01' }, '2026-11-14');
  assert.equal(futura.pagas, 0);
  assert.equal(futura.restantes, 12);
  assert.ok(!futura.ativaNoMes);
});

teste('vencimento dia 31 em mês curto conta como vencido no último dia', () => {
  const d = { ...geladeira, dia: 31, inicio: '2027-02' };
  assert.equal(D.situacao(d, '2027-02-28').pagas, 1);
});

teste('resumo: total restante, por mês, próxima a acabar e meses seguintes', () => {
  const celular = { id: 2, nome: 'Celular', valor: R(150), total: 10, inicio: '2026-06', dia: 5, pagamento: 'Nubank', categoria: 'Compras' };
  const r = D.resumoDividas([geladeira, celular], '2026-11-14');
  assert.equal(r.abertas, 2);
  assert.equal(r.porMes, R(400));
  assert.equal(r.proxima.nome, 'Celular');            // termina em mar/27, antes da geladeira
  assert.equal(r.proxima.sit.fim, '2027-03');
  assert.equal(r.totalRestante, R(250) * 8 + R(150) * 4);
  assert.equal(r.proximosMeses[4].mes, '2027-03');
  assert.equal(r.proximosMeses[4].total, R(400));
  assert.equal(r.proximosMeses[5].total, R(250));     // abr/27: só a geladeira
});

teste('boleto vira conta no planejador; cartão soma na fatura', () => {
  const celular = { id: 2, nome: 'Celular', valor: R(150), total: 10, inicio: '2026-06', dia: 5, pagamento: 'Nubank' };
  const contas = D.contasDoMes([geladeira, celular], '2026-11');
  assert.equal(contas.length, 1);
  assert.equal(contas[0].nome, 'Geladeira 4/12');
  assert.equal(contas[0].flexivel, false);
  assert.equal(D.parcelasNoCartao([geladeira, celular], 'Nubank', '2026-11'), R(150));
  assert.equal(D.parcelasNoCartao([geladeira, celular], 'Nubank', '2027-04'), 0);
});

console.log(`${ok} testes passaram no total (com dívidas)`);
