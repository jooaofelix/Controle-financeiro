// Dívidas parceladas — funções puras (sem DOM), testadas em scripts/testar-planejador.mjs
//
// Uma dívida guarda: { nome, valor (parcela, centavos), total (nº de parcelas),
//   inicio: 'YYYY-MM' (mês da 1ª parcela), dia (vencimento), pagamento: 'boleto'|'Nubank'|'Inter', categoria }
// A parcela de cada mês é calculada a partir do início — o app "anda" sozinho todo mês.

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function somaMeses(ym, n) {
  const [a, m] = ym.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function mesesEntre(de, ate) {
  const [a1, m1] = de.split('-').map(Number);
  const [a2, m2] = ate.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

export const mesAno = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;

const ultimoDiaDoMes = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();

// Número da parcela que vence no mês `ym` (pode ser < 1 ou > total)
export const parcelaDoMes = (d, ym) => mesesEntre(d.inicio, ym) + 1;

// Mês da 1ª parcela, sabendo qual parcela vence no mês de hoje
export const inicioDe = (parcelaAtual, hojeISO) => somaMeses(hojeISO.slice(0, 7), -(Math.max(1, parcelaAtual) - 1));

export function situacao(d, hojeISO) {
  const ym = hojeISO.slice(0, 7);
  const diaHoje = Number(hojeISO.slice(8, 10));
  const n = parcelaDoMes(d, ym);
  const venceuEsteMes = diaHoje >= Math.min(d.dia, ultimoDiaDoMes(ym));
  const pagas = Math.max(0, Math.min(d.total, venceuEsteMes ? n : n - 1));
  const restantes = d.total - pagas;
  return {
    pagas,
    restantes,
    valorRestante: restantes * d.valor,
    ativaNoMes: n >= 1 && n <= d.total, // tem parcela vencendo neste mês
    parcelaDoMes: n,
    fim: somaMeses(d.inicio, d.total - 1), // mês da última parcela
    quitada: pagas >= d.total,
    progresso: d.total ? pagas / d.total : 1,
  };
}

export function resumoDividas(dividas, hojeISO) {
  const comSit = dividas.map((d) => ({ ...d, sit: situacao(d, hojeISO) }));
  const abertas = comSit.filter((d) => !d.sit.quitada);
  const totalRestante = abertas.reduce((s, d) => s + d.sit.valorRestante, 0);
  const porMes = comSit.filter((d) => d.sit.ativaNoMes).reduce((s, d) => s + d.valor, 0);
  const proxima = abertas
    .filter((d) => d.sit.parcelaDoMes >= 1)
    .sort((a, b) => a.sit.fim.localeCompare(b.sit.fim) || b.valor - a.valor)[0] || null;
  // Quanto as parcelas somam em cada um dos próximos meses
  const ym = hojeISO.slice(0, 7);
  const proximosMeses = Array.from({ length: 6 }, (_, i) => {
    const m = somaMeses(ym, i);
    return { mes: m, total: dividas.filter((d) => { const n = parcelaDoMes(d, m); return n >= 1 && n <= d.total; }).reduce((s, d) => s + d.valor, 0) };
  });
  return { itens: comSit, abertas: abertas.length, totalRestante, porMes, proxima, proximosMeses };
}

// Parcelas de boleto/débito que vencem no mês: entram no planejador como contas fixas
export function contasDoMes(dividas, ym) {
  return dividas
    .filter((d) => d.pagamento === 'boleto')
    .map((d) => ({ d, n: parcelaDoMes(d, ym) }))
    .filter(({ d, n }) => n >= 1 && n <= d.total)
    .map(({ d, n }) => ({
      id: d.id, tipo: 'conta', divida: true, flexivel: false,
      nome: `${d.nome} ${n}/${d.total}`, valor: d.valor, dia: d.dia, categoria: d.categoria,
    }));
}

// Quanto das parcelas cai em cada cartão neste mês
export function parcelasNoCartao(dividas, cartao, ym) {
  return dividas
    .filter((d) => d.pagamento === cartao)
    .filter((d) => { const n = parcelaDoMes(d, ym); return n >= 1 && n <= d.total; })
    .reduce((s, d) => s + d.valor, 0);
}
