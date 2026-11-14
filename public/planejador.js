// Planejador de contas — simula o saldo dia a dia e sugere os melhores vencimentos.
// Funções puras (sem DOM), para poder testar com: node scripts/testar-planejador.mjs
//
// Modelo: mês de 30 dias. Valores em centavos.
//   rendas:  [{ valor, dia, descricao, pessoa }]
//   contas:  [{ id, nome, valor, dia, flexivel }]          flexivel = dá para mudar o vencimento
//   cartoes: [{ id, nome, fechamento, vencimento, valor, flexivel }]  valor = fatura média
//   saldoInicial: quanto costuma ter na conta no dia 1
//   gastoVariavel: gasto do dia a dia no mês (mercado, iFood...), espalhado igualmente

export const DIAS = 30;
const ULTIMO_DIA_ESCOLHIVEL = 28; // empresas raramente oferecem vencimento depois do dia 28
const dia30 = (d) => Math.min(DIAS, Math.max(1, d | 0));

export function eventos(p) {
  const ev = [];
  for (const r of p.rendas) ev.push({ dia: dia30(r.dia), valor: r.valor, nome: r.descricao || 'Salário', tipo: 'renda', ref: r });
  for (const c of p.contas) ev.push({ dia: dia30(c.dia), valor: -c.valor, nome: c.nome, tipo: 'conta', ref: c });
  for (const c of p.cartoes) {
    if (c.valor > 0) ev.push({ dia: dia30(c.vencimento), valor: -c.valor, nome: 'Fatura ' + c.nome, tipo: 'cartao', ref: c });
  }
  return ev;
}

export function simular(p) {
  const porDia = Array.from({ length: DIAS + 1 }, () => []);
  for (const e of eventos(p)) porDia[e.dia].push(e);
  const variavelDia = (p.gastoVariavel || 0) / DIAS;
  const saldos = [p.saldoInicial || 0]; // saldos[d] = saldo no fim do dia d
  let s = p.saldoInicial || 0;
  let min = Infinity;
  let diaMin = 1;
  for (let d = 1; d <= DIAS; d++) {
    for (const e of porDia[d]) s += e.valor;
    s -= variavelDia;
    saldos[d] = Math.round(s);
    if (saldos[d] < min) { min = saldos[d]; diaMin = d; }
  }
  return { saldos, porDia, min, diaMin, fim: saldos[DIAS] };
}

// Quantos dias depois do salário mais próximo (0 = no mesmo dia)
function diasAposSalario(d, diasSalario) {
  if (!diasSalario.length) return 3;
  return Math.min(...diasSalario.map((s) => (d - s + DIAS) % DIAS));
}

// Preferência: de 1 a 5 dias depois de cair um salário (folga se o pagamento atrasar)
function penalidade(d, diasSalario) {
  const x = diasAposSalario(d, diasSalario);
  if (x === 0) return 2;
  if (x <= 5) return 0;
  return x - 5;
}

function comDia(p, item, d) {
  const mover = (lista) => lista.map((x) => {
    if (x !== item) return x;
    if ('vencimento' in x) {
      const offset = (x.vencimento - x.fechamento + DIAS) % DIAS; // fechamento acompanha o vencimento
      return { ...x, vencimento: d, fechamento: ((d - offset - 1 + DIAS) % DIAS) + 1 };
    }
    return { ...x, dia: d };
  });
  return { ...p, contas: mover(p.contas), cartoes: mover(p.cartoes) };
}

export function planejar(plano) {
  const base = simular(plano);
  const diasSalario = plano.rendas.map((r) => dia30(r.dia));
  let atual = plano;
  let simAtual = base;
  const sugestoes = [];

  const flexiveis = [
    ...plano.contas.filter((c) => c.flexivel),
    ...plano.cartoes.filter((c) => c.flexivel && c.valor > 0),
  ].sort((a, b) => b.valor - a.valor);

  // Só vale sugerir se o menor saldo do mês melhorar de verdade
  const ganhoMinimo = (item) => Math.max(2000, Math.round(item.valor * 0.05));

  for (const original of flexiveis) {
    const item = [...atual.contas, ...atual.cartoes].find((x) => x.id === original.id && ('vencimento' in x) === ('vencimento' in original));
    const diaAtual = 'vencimento' in item ? item.vencimento : item.dia;
    let melhor = { dia: diaAtual, min: simAtual.min, pen: penalidade(diaAtual, diasSalario) };
    for (let d = 1; d <= ULTIMO_DIA_ESCOLHIVEL; d++) {
      if (d === diaAtual) continue;
      const sim = simular(comDia(atual, item, d));
      const pen = penalidade(d, diasSalario);
      if (sim.min > melhor.min + 100 || (Math.abs(sim.min - melhor.min) <= 100 && pen < melhor.pen && sim.min >= simAtual.min + 100)) {
        melhor = { dia: d, min: sim.min, pen };
      }
    }
    if (melhor.dia !== diaAtual && melhor.min >= simAtual.min + ganhoMinimo(item)) {
      const novo = comDia(atual, item, melhor.dia);
      const simNovo = simular(novo);
      sugestoes.push({
        item: original,
        tipo: 'vencimento' in item ? 'cartao' : 'conta',
        nome: 'vencimento' in item ? 'Fatura ' + item.nome : item.nome,
        de: diaAtual,
        para: melhor.dia,
        minAntes: simAtual.min,
        minDepois: simNovo.min,
      });
      atual = novo;
      simAtual = simNovo;
    }
  }

  // Melhor dia de compra no cartão: o dia seguinte ao fechamento da fatura
  const cartoes = atual.cartoes.map((c) => {
    const melhorDiaCompra = (c.fechamento % DIAS) + 1;
    const prazo = DIAS - 1 + ((c.vencimento - c.fechamento + DIAS) % DIAS);
    return { ...c, melhorDiaCompra, prazo };
  });

  const alertas = [];
  const negativos = base.saldos.slice(1).filter((s) => s < 0).length;
  if (negativos) {
    alertas.push({
      nivel: 'critico',
      texto: `Com os vencimentos de hoje, o saldo fica negativo em ${negativos} ${negativos === 1 ? 'dia' : 'dias'} do mês (pior dia: ${base.diaMin}).`,
    });
  }
  const totalRendas = plano.rendas.reduce((s, r) => s + r.valor, 0);
  const totalFixas = plano.contas.reduce((s, c) => s + c.valor, 0) + plano.cartoes.reduce((s, c) => s + (c.valor || 0), 0);
  const sobra = totalRendas - totalFixas - (plano.gastoVariavel || 0);
  if (totalRendas && sobra < 0) {
    alertas.push({ nivel: 'critico', texto: 'Os gastos previstos passam da renda do mês — mudar datas não resolve, é preciso cortar gastos.' });
  }
  const antesSalario = diasSalario.length
    ? plano.contas.filter((c) => dia30(c.dia) < Math.min(...diasSalario))
    : [];

  return {
    base,
    final: simAtual,
    planoFinal: atual,
    sugestoes,
    cartoes,
    alertas,
    antesSalario,
    resumo: { totalRendas, totalFixas, gastoVariavel: plano.gastoVariavel || 0, sobra },
  };
}
