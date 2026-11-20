// Previsão do saldo real até o fim do mês, a partir do saldo de hoje nas contas.
// Só entra o que ainda falta: salários que não caíram, contas não pagas e o dia a dia restante.
// Testes: node scripts/testar-projecao.mjs
import { situacaoMes, itensPagaveis } from './vinculos.js';
import { parcelaDoMes } from './dividas.js';
import { diaDoSalario } from './diasuteis.js';

const ultimoDiaMes = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();

export function projetarMes({ saldoAgora, hojeISO, itens, pagamentos = [], gastoVariavelMensal = 0 }) {
  const ym = hojeISO.slice(0, 7);
  const hoje = +hojeISO.slice(8, 10);
  const fimMes = ultimoDiaMes(ym);
  const eventos = []; // { dia, valor, nome, tipo }

  // Salários que ainda vão cair este mês (o de hoje ou antes já está no saldo)
  for (const r of itens.filter((i) => i.tipo === 'renda')) {
    const dia = Math.min(diaDoSalario(r, ym), fimMes);
    if (dia > hoje) eventos.push({ dia, valor: r.valor, nome: r.descricao || `Salário ${r.pessoa || ''}`.trim(), tipo: 'renda' });
  }

  // Contas previstas ainda não pagas (dívida só se tiver parcela neste mês); atrasada = paga hoje
  const pagaveis = itensPagaveis(itens).filter((i) => i.tipo !== 'divida' || (parcelaDoMes(i, ym) >= 1 && parcelaDoMes(i, ym) <= i.total))
    .filter((i) => i.tipo !== 'cartao' || i.valor > 0);
  for (const s of situacaoMes(pagaveis, pagamentos, ym, hojeISO)) {
    if (s.estado === 'paga') continue;
    const dia = s.estado === 'atrasada' ? hoje : +s.venc.slice(8, 10);
    eventos.push({ dia, valor: -s.previsto, nome: s.nome, tipo: s.estado === 'atrasada' ? 'atrasada' : 'conta' });
  }

  // Dia a dia: média diária vezes os dias que faltam (hoje incluso)
  const porDia = gastoVariavelMensal / 30;
  const saldos = {};
  let s = saldoAgora, min = saldoAgora, diaMin = hoje;
  for (let d = hoje; d <= fimMes; d++) {
    for (const e of eventos.filter((x) => x.dia === d)) s += e.valor;
    s -= porDia;
    saldos[d] = Math.round(s);
    if (saldos[d] < min) { min = saldos[d]; diaMin = d; }
  }
  const soma = (f) => eventos.filter(f).reduce((t, e) => t + e.valor, 0);
  return {
    saldoAgora,
    fim: saldos[fimMes] ?? saldoAgora,
    min: Math.round(min),
    diaMin,
    saldos,
    eventos: eventos.sort((a, b) => a.dia - b.dia),
    aReceber: soma((e) => e.valor > 0),
    aPagar: Math.abs(soma((e) => e.valor < 0)),
    diaADia: Math.round(porDia * (fimMes - hoje + 1)),
    diasRestantes: fimMes - hoje + 1,
  };
}
