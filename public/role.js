// Parceiro do rolê: quanto dá para gastar de um dia até outro sem faltar dinheiro para as contas
// até o próximo salário. Testes: node scripts/testar-role.mjs
//
// Como calcula: simula o saldo dia a dia, de hoje até a véspera do primeiro salário depois do período,
// com salários, contas ainda não pagas e o gasto do dia a dia nos dias FORA do período.
// Dentro do período o dinheiro é "livre" (inclui mercado, iFood, passeio...), gasto por igual a cada dia.
// O valor livre é o maior que mantém o saldo acima da reserva em todos os dias até o salário.
import { situacaoMes } from './vinculos.js';
import { parcelaDoMes } from './dividas.js';
import { diaDoSalario } from './diasuteis.js';

const DIA = 86400000;
const t = (iso) => Date.parse(iso + 'T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
export const somaDias = (d, n) => iso(t(d) + n * DIA);
const ultimoDia = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const mesSeguinte = (ym) => iso(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 1)).slice(0, 7);

// Salários e contas a pagar entre hoje e 'ate' (inclusive), cada um com sua data
export function eventosAte({ hojeISO, ate, itens, pagamentos = [] }) {
  const eventos = [];
  for (let ym = hojeISO.slice(0, 7); ym <= ate.slice(0, 7); ym = mesSeguinte(ym)) {
    for (const r of itens.filter((i) => i.tipo === 'renda')) {
      const data = `${ym}-${String(Math.min(diaDoSalario(r, ym), ultimoDia(ym))).padStart(2, '0')}`;
      // o salário de hoje ou antes já está no saldo
      if (data > hojeISO && data <= ate) eventos.push({ data, valor: r.valor, nome: r.descricao && r.descricao !== 'Salário' ? r.descricao : `Salário ${r.pessoa || ''}`.trim(), tipo: 'renda' });
    }
    const pagaveis = itens.filter((i) => i.tipo !== 'divida' || (parcelaDoMes(i, ym) >= 1 && parcelaDoMes(i, ym) <= i.total))
      .filter((i) => i.tipo !== 'cartao' || i.valor > 0);
    for (const s of situacaoMes(pagaveis, pagamentos, ym, hojeISO)) {
      if (s.estado === 'paga') continue;
      const data = s.estado === 'atrasada' ? hojeISO : s.venc;
      if (data <= ate) eventos.push({ data, valor: -s.previsto, nome: s.nome, tipo: s.estado === 'atrasada' ? 'atrasada' : 'conta' });
    }
  }
  return eventos.sort((a, b) => a.data.localeCompare(b.data));
}

export function parceiroDoRole({ saldoAgora, hojeISO, de, ate, itens, pagamentos = [], gastoVariavelMensal = 0, reserva = 0 }) {
  if (de < hojeISO) de = hojeISO;
  if (ate < de) ate = de;
  const porDia = gastoVariavelMensal / 30;
  // até quando o dinheiro precisa durar: véspera do primeiro salário depois do período (no máx. 62 dias)
  const longe = eventosAte({ hojeISO, ate: somaDias(ate, 62), itens, pagamentos });
  const salario = longe.find((e) => e.tipo === 'renda' && e.data > ate);
  const limite = salario ? somaDias(salario.data, -1) : ate;
  const eventos = longe.filter((e) => e.data <= limite);

  const N = Math.round((t(ate) - t(de)) / DIA) + 1;
  let s = saldoAgora;
  let livre = Infinity;
  let aperto = null; // dia que limita o valor
  for (let d = hojeISO, k = 0; d <= limite; d = somaDias(d, 1)) {
    for (const e of eventos.filter((x) => x.data === d)) s += e.valor;
    const dentro = d >= de && d <= ate;
    if (dentro) k++; else s -= porDia;
    // gastando livre/N por dia no período, o saldo do dia d fica s - livre*k/N
    const max = k ? ((s - reserva) * N) / k : (s - reserva >= 0 ? Infinity : s - reserva);
    if (max < livre) { livre = max; aperto = d; }
  }
  if (livre === Infinity) livre = s - reserva;
  livre = Math.floor(livre / 100) * 100; // em reais inteiros
  const doPeriodo = (f) => eventos.filter((e) => e.data >= hojeISO && e.data <= limite && f(e));
  return {
    de, ate, dias: N, limite, salario: salario || null,
    livre,
    porDia: Math.floor(livre / N / 100) * 100,
    diaADiaNormal: Math.round(porDia * N),        // o que vocês já gastam normalmente nesses dias
    extra: Math.floor((livre - porDia * N) / 100) * 100,        // o que sobra além do dia a dia normal
    aperto,
    contas: doPeriodo((e) => e.valor < 0),
    salarios: doPeriodo((e) => e.valor > 0),
  };
}
