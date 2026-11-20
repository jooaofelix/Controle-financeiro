// Integração com o Meu Pluggy (Open Finance, plano pessoal gratuito).
// Detalhes da API do plano pessoal (verificados por terceiros, out/2026):
//  - POST /auth {clientId, clientSecret} -> {apiKey}; usar header X-API-KEY
//  - GET /items lista NÃO funciona no plano pessoal: o usuário informa os Item IDs
//  - GET /items/{id}, GET /accounts?itemId=, GET /v2/transactions?accountId=&dateFrom=&dateTo=
//  - /v2/transactions pagina com {results, next}; `next` é uma query string pronta
//  - Conta corrente: amount < 0 é saída. Cartão: amount > 0 é compra, < 0 é pagamento/estorno
//  - Item fica LOGIN_ERROR/OUTDATED quando o consentimento vence (renova-se no Meu Pluggy)

export const PLUGGY_BASE = 'https://api.pluggy.ai';

// Código do banco (COMPE) -> nome usado no app
const BANCOS = { '260': 'Nubank', '077': 'Inter', '77': 'Inter' };

export function nomeDaConta(conta, apelidoItem = '') {
  const compe = String(conta?.bankData?.transferNumber || '').split('/')[0];
  if (BANCOS[compe]) return BANCOS[compe];
  const txt = `${apelidoItem} ${conta?.marketingName || ''} ${conta?.name || ''}`.toLowerCase();
  if (/\bnu\b|nubank|nu pagamentos/.test(txt)) return 'Nubank';
  if (/inter/.test(txt)) return 'Inter';
  return (apelidoItem || conta?.marketingName || conta?.name || 'Banco').slice(0, 40);
}

// Categorias do Pluggy (em inglês) -> categorias do app
const MAPA_CATEGORIAS = [
  [/grocer|supermarket/i, 'Mercado'],
  [/eating out|restaurant|food|delivery|bakery|coffee|bar\b/i, 'Alimentação'],
  [/transport|taxi|ride|gas station|fuel|parking|toll|public transport|vehicle|automotive/i, 'Transporte'],
  [/health|pharmac|drugstore|hospital|clinic|dentist|doctor|medical|gym|fitness/i, 'Saúde'],
  [/leisure|entertainment|ticket|cinema|games|travel|hotel|airline|tourism/i, 'Lazer'],
  [/digital service|streaming|subscription|telecom|internet|mobile|software/i, 'Assinaturas'],
  [/shopping|clothing|electronics|online|department store|marketplace/i, 'Compras'],
  [/housing|rent|utilities|electricity|water|condominium|home|gas bill/i, 'Casa'],
  [/education|school|course|university|books/i, 'Educação'],
  [/salary|payroll|wage|income|proceeds/i, 'Salário'],
];
export function categoriaDoPluggy(cat) {
  for (const [re, nossa] of MAPA_CATEGORIAS) if (re.test(cat || '')) return nossa;
  return null;
}

// Movimentações que NÃO são gasto nem renda e por isso não entram:
//  - pagamento da fatura do cartão (as compras já entram uma a uma pelo cartão)
//  - transferência entre contas do mesmo titular / do casal, aplicações e resgates
const IGNORAR_CATEGORIA = /credit card payment|same person|same ownership|own account|investment|savings|automatic investment/i;
const IGNORAR_DESCRICAO = /pagamento (de |da )?fatura|pgto fatura|fatura do cart|pagamento recebido|aplica[cç][aã]o|resgate|caixinha|rdb|cdb|poupan[cç]a|transfer[eê]ncia entre contas|mesma titularidade/i;

// Forma de pagamento: 'credito' | 'debito' | 'pix' | 'boleto' | 'transferencia' | '' (desconhecida)
export function meioDoPluggy(t, conta) {
  if (conta?.type === 'CREDIT') return 'credito';
  const pm = String(t?.paymentData?.paymentMethod || '').toUpperCase();
  if (pm === 'PIX') return 'pix';
  if (pm === 'BOLETO') return 'boleto';
  if (['TED', 'DOC', 'TEF', 'TRANSFER'].includes(pm)) return 'transferencia';
  const d = String(t?.description || '').toLowerCase();
  if (/\bpix\b/.test(d)) return 'pix';
  if (/d[eé]bito|compra no cart|compra cart|compra com cart/.test(d)) return 'debito';
  if (/boleto|pagamento de (conta|t[ií]tulo)|conv[eê]nio|tributo|concession/.test(d)) return 'boleto';
  if (/\bted\b|\bdoc\b|transfer/.test(d)) return 'transferencia';
  return '';
}

// Pagamento da fatura do cartão (não é gasto, mas marca a fatura como paga no planejador)
export function ehPagamentoFatura(t) {
  return /credit card payment/i.test(t?.category || '') ||
    /pagamento (de |da )?fatura|pgto fatura|fatura do cart|pagamento de cart[aã]o/i.test(String(t?.description || ''));
}

// Decide o que fazer com uma transação do Pluggy.
// Devolve { importar: false, motivo } ou { importar: true, tipo, valor, data, descricao, categoriaPluggy, cartao }
export function classificar(t, conta) {
  if (!t || typeof t.amount !== 'number' || !t.date) return { importar: false, motivo: 'dados incompletos' };
  if (t.status === 'PENDING') return { importar: false, motivo: 'pendente (entra quando o banco confirmar)' };
  const cartao = conta?.type === 'CREDIT';
  const descricao = String(t.description || t.descriptionRaw || '').replace(/\s+/g, ' ').trim();
  if (IGNORAR_CATEGORIA.test(t.category || '') || IGNORAR_DESCRICAO.test(descricao)) {
    return { importar: false, motivo: 'pagamento de fatura / transferência própria / aplicação' };
  }
  let tipo;
  if (cartao) {
    if (t.amount <= 0) return { importar: false, motivo: 'pagamento ou estorno no cartão' };
    tipo = 'despesa';
  } else {
    if (t.amount === 0) return { importar: false, motivo: 'valor zero' };
    tipo = t.amount < 0 ? 'despesa' : 'receita';
  }
  // Data de verdade do gasto: no cartão o banco pode mandar a data em que entrou na fatura;
  // a compra aconteceu em purchaseDate. Parceladas ficam no mês de cada parcela (data da fatura).
  const parcelas = Number(t.creditCardMetadata?.totalInstallments || 0);
  const compra = t.creditCardMetadata?.purchaseDate;
  let data = String(t.date).slice(0, 10);
  if (cartao && compra && !(parcelas > 1)) data = String(compra).slice(0, 10);
  const sufixo = cartao && parcelas > 1 && !/\d+\s*\/\s*\d+/.test(descricao) ? ` (parcelado em ${parcelas}x)` : '';
  return {
    importar: true,
    tipo,
    valor: Math.round(Math.abs(t.amount) * 100),
    data,
    descricao: (descricao.slice(0, 120 - sufixo.length) + sufixo).trim(),
    categoriaPluggy: t.category || '',
    meio: meioDoPluggy(t, conta),
    parcelas,
    cartao,
  };
}

// Procura um lançamento já existente (Apple Pay ou manual) que seja a mesma movimentação:
// mesmo tipo e valor, até 3 dias de diferença e, se os dois tiverem conta, a mesma conta.
export function acharDuplicado(nova, existentes) {
  const dia = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
  let melhor = null;
  for (const e of existentes) {
    if (e.externo_id || e.tipo !== nova.tipo || e.valor !== nova.valor) continue;
    if (nova.conta && e.conta && nova.conta !== e.conta) continue;
    const dif = Math.abs(dia(e.data) - dia(nova.data));
    if (dif > 3) continue;
    if (!melhor || dif < melhor.dif) melhor = { e, dif };
  }
  return melhor ? melhor.e : null;
}

// Situação de uma conexão (item) para o app e para os avisos
const OK = new Set(['UPDATED', 'UPDATING', 'CREATED']);
export function situacaoItem(item, hojeISO) {
  const status = item?.status || 'DESCONHECIDO';
  const expira = item?.consentExpiresAt || item?.consent?.expiresAt || null;
  let diasParaVencer = null;
  if (expira) {
    diasParaVencer = Math.ceil((Date.parse(expira) - Date.parse(hojeISO + 'T00:00:00Z')) / 86400000);
  }
  if (!OK.has(status)) return { nivel: 'erro', status, expira, diasParaVencer, texto: 'Conexão parou — precisa renovar no Meu Pluggy' };
  if (diasParaVencer != null && diasParaVencer <= 7) {
    return { nivel: 'aviso', status, expira, diasParaVencer, texto: diasParaVencer <= 0 ? 'Autorização venceu — renove no Meu Pluggy' : `Autorização vence em ${diasParaVencer} ${diasParaVencer === 1 ? 'dia' : 'dias'}` };
  }
  return { nivel: 'ok', status, expira, diasParaVencer, texto: 'Funcionando' };
}

// ---------- Cliente HTTP ----------
export async function clientePluggy({ clientId, clientSecret }, base = PLUGGY_BASE) {
  const r = await fetch(base + '/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  const auth = await r.json().catch(() => ({}));
  if (!auth.apiKey) throw new Error(`Login no Pluggy falhou (HTTP ${r.status}). Confira o Client ID e o Client Secret.`);
  const headers = { 'X-API-KEY': auth.apiKey };

  async function get(caminho) {
    const res = await fetch(base + caminho, { headers });
    const txt = await res.text();
    let j = null;
    try { j = JSON.parse(txt); } catch {}
    if (res.status !== 200) throw new Error(`Pluggy ${caminho.split('?')[0]} respondeu ${res.status}: ${txt.slice(0, 160)}`);
    return j;
  }

  async function transacoes(accountId, { dateFrom, dateTo } = {}) {
    const faixa = (dateFrom ? `&dateFrom=${dateFrom}` : '') + (dateTo ? `&dateTo=${dateTo}` : '');
    const linhas = [];
    let next = null, paginas = 0;
    do {
      const url = next ? `/v2/transactions${next}${faixa}` : `/v2/transactions?accountId=${encodeURIComponent(accountId)}${faixa}`;
      const p = await get(url);
      linhas.push(...(p.results || []));
      next = p.next || null;
    } while (next && ++paginas < 50);
    return linhas;
  }

  // Token de uso único para abrir o widget oficial Pluggy Connect no navegador (vale ~30 min)
  async function connectToken(clientUserId) {
    const res = await fetch(base + '/connect_token', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ clientUserId }),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.accessToken) throw new Error(`Pluggy não liberou a conexão (HTTP ${res.status}): ${JSON.stringify(j).slice(0, 160)}`);
    return j.accessToken;
  }

  return {
    connectToken,
    item: (id) => get(`/items/${encodeURIComponent(id)}`),
    contas: async (itemId) => (await get(`/accounts?itemId=${encodeURIComponent(itemId)}`)).results || [],
    transacoes,
  };
}
