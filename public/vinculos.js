// Vínculo entre um lançamento e uma conta prevista do planejador (conta fixa, dívida no boleto
// ou fatura de cartão). Funções puras, usadas no servidor e na tela.
// Testes: node scripts/testar-vinculos.mjs

const dias = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const ultimoDia = (ano, mes0) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
const isoDe = (ano, mes0, dia) => {
  const d = new Date(Date.UTC(ano, mes0, 1));
  const a = d.getUTCFullYear(), m = d.getUTCMonth();
  return `${a}-${String(m + 1).padStart(2, '0')}-${String(Math.min(dia, ultimoDia(a, m))).padStart(2, '0')}`;
};

// Dia de vencimento de cada tipo de item do plano
export const diaVencimento = (item) => (item.tipo === 'cartao' ? item.vencimento : item.dia);

// Nome amigável do item
export function nomeItem(item) {
  if (item.tipo === 'cartao') return `Fatura ${item.nome}`;
  return item.nome || 'Conta';
}

// A que mês o pagamento se refere: o vencimento mais próximo da data do pagamento
// (pagar a conta do dia 2 no dia 30 do mês anterior conta para o mês do dia 2).
export function mesReferencia(dataPagamento, diaVenc) {
  const a = +dataPagamento.slice(0, 4), m = +dataPagamento.slice(5, 7) - 1;
  let melhor = null;
  for (const desloc of [-1, 0, 1]) {
    const venc = isoDe(a, m + desloc, diaVenc);
    const dif = Math.abs(dias(venc) - dias(dataPagamento));
    if (!melhor || dif < melhor.dif) melhor = { venc, dif };
  }
  return melhor.venc.slice(0, 7);
}

// Itens do plano que podem receber pagamento (dívida só no boleto: no cartão ela já vai na fatura)
export function itensPagaveis(itensPlano) {
  return itensPlano.filter((i) => i.tipo === 'conta' || i.tipo === 'cartao' || (i.tipo === 'divida' && i.pagamento === 'boleto'));
}

const palavras = (s) => new Set(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !['pagamento', 'pgto', 'compra', 'conta', 'boleto', 'debito', 'credito', 'fatura', 'parcela', 'ltda'].includes(w)));

// Sugere a conta prevista que este gasto provavelmente paga (ou null).
// Regra: nome parecido e valor até 30% diferente; OU valor praticamente igual (2%),
// perto do vencimento (±5 dias) e não pago no crédito (conta fixa raramente é paga assim por acaso).
export function sugerirVinculo(tx, itensPlano, jaPagos = new Set()) {
  if (!tx || tx.tipo !== 'despesa' || !tx.data) return null;
  const pTx = palavras(tx.descricao);
  let melhor = null;
  for (const item of itensPagaveis(itensPlano)) {
    const venc = diaVencimento(item);
    if (!venc) continue;
    const ref = mesReferencia(tx.data, venc);
    if (jaPagos.has(`${item.id}:${ref}`)) continue;
    const vencIso = isoDe(+ref.slice(0, 4), +ref.slice(5, 7) - 1, venc);
    const distancia = Math.abs(dias(vencIso) - dias(tx.data));
    const previsto = item.valor || 0;
    const difValor = previsto ? Math.abs(tx.valor - previsto) / previsto : 1;
    const nomeBate = [...palavras(nomeItem(item))].some((w) => pTx.has(w)) ||
      (item.tipo === 'cartao' && pTx.has(String(item.nome || '').toLowerCase()) && /fatura/i.test(tx.descricao || ''));
    let pontos = 0;
    if (nomeBate && difValor <= 0.3 && distancia <= 15) pontos = 3 - difValor;
    else if (difValor <= 0.02 && distancia <= 5 && tx.meio !== 'credito') pontos = 1 - distancia / 10;
    if (pontos > 0 && (!melhor || pontos > melhor.pontos)) melhor = { item, mes: ref, pontos };
  }
  return melhor ? { id: melhor.item.id, mes: melhor.mes, nome: nomeItem(melhor.item) } : null;
}

// Situação de cada conta prevista no mês: paga, pendente ou atrasada
export function situacaoMes(itensPlano, pagamentos, mesISO, hojeISO) {
  return itensPagaveis(itensPlano).map((item) => {
    const venc = diaVencimento(item);
    const vencIso = isoDe(+mesISO.slice(0, 4), +mesISO.slice(5, 7) - 1, venc);
    const pags = pagamentos.filter((p) => p.plano_id === item.id && p.plano_mes === mesISO);
    const pago = pags.reduce((s, p) => s + p.valor, 0);
    let estado = 'pendente';
    if (pags.length) estado = 'paga';
    else if (hojeISO > vencIso) estado = 'atrasada';
    return { id: item.id, tipo: item.tipo, nome: nomeItem(item), venc: vencIso, previsto: item.valor || 0, pago, pagamentos: pags, estado,
      diasPara: dias(vencIso) - dias(hojeISO) };
  });
}
