// Controle Financeiro — API (Cloudflare Worker + D1)
// Os arquivos de /public são servidos automaticamente; aqui só chegam as rotas /api/*.

const CATEGORIAS = [
  'Mercado', 'Alimentação', 'Casa', 'Transporte', 'Saúde', 'Lazer',
  'Assinaturas', 'Compras', 'Educação', 'Salário', 'Outros', 'A classificar',
];
const CONTAS = ['Nubank', 'Inter', 'Dinheiro'];

// Palavras no nome do estabelecimento -> categoria (usado no Atalho do iPhone)
const REGRAS_CATEGORIA = [
  [/amazon|mercado ?livre|shopee|magalu|magazine|americanas|aliexpress|shein|renner|riachuelo/i, 'Compras'],
  [/ifood|rappi|restaur|lanch|pizz|burger|mc ?donald|bk |padaria|cafe|café|bar /i, 'Alimentação'],
  [/mercado|supermerc|atacad|assai|assaí|carrefour|\bextra\b|p[aã]o de a[cç]|hortifruti|sacol/i, 'Mercado'],
  [/uber|\b99\b|posto|shell|ipiranga|petrobras|estacion|metr[oô]|sem parar|veloe|cabify/i, 'Transporte'],
  [/farm|drog|raia|pacheco|pague menos|hospital|cl[ií]nica|laborat/i, 'Saúde'],
  [/netflix|spotify|prime ?video|disney|hbo|\bmax\b|youtube|apple\.com|icloud|google|deezer|globoplay/i, 'Assinaturas'],
  [/cinema|ingresso|steam|playstation|xbox|teatro/i, 'Lazer'],
];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (!url.pathname.startsWith('/api/')) return new Response('Não encontrado', { status: 404 });
      return await rotear(req, env, url);
    } catch (e) {
      return json({ erro: e.message || 'Erro interno' }, e.status || 500);
    }
  },
};

async function rotear(req, env, url) {
  const { pathname } = url;
  const m = req.method;

  if (pathname === '/api/login' && m === 'POST') return login(req, env);
  if (pathname === '/api/logout' && m === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  // Endpoint do Atalho do iPhone (autentica pelo cabeçalho Authorization: Bearer <SENHA>)
  if (pathname === '/api/atalho' && m === 'POST') return atalho(req, env);

  await exigirLogin(req, env);

  if (pathname === '/api/config' && m === 'GET') {
    return json({ pessoas: pessoas(env), categorias: CATEGORIAS, contas: CONTAS });
  }
  if (pathname === '/api/transacoes' && m === 'GET') {
    const mes = url.searchParams.get('mes') || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) throw erro(400, 'Mês inválido');
    const { results } = await env.DB.prepare(
      `SELECT * FROM transacoes WHERE substr(data,1,7) = ? ORDER BY data DESC, id DESC`
    ).bind(mes).all();
    return json(results);
  }
  if (pathname === '/api/transacoes' && m === 'POST') {
    const t = validar(await req.json(), env);
    const r = await env.DB.prepare(
      `INSERT INTO transacoes (data, valor, tipo, categoria, pessoa, conta, descricao, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'manual') RETURNING *`
    ).bind(t.data, t.valor, t.tipo, t.categoria, t.pessoa, t.conta, t.descricao).first();
    return json(r, 201);
  }
  const mId = pathname.match(/^\/api\/transacoes\/(\d+)$/);
  if (mId && m === 'PUT') {
    const t = validar(await req.json(), env);
    const r = await env.DB.prepare(
      `UPDATE transacoes SET data=?, valor=?, tipo=?, categoria=?, pessoa=?, conta=?, descricao=?
       WHERE id=? RETURNING *`
    ).bind(t.data, t.valor, t.tipo, t.categoria, t.pessoa, t.conta, t.descricao, Number(mId[1])).first();
    if (!r) throw erro(404, 'Lançamento não encontrado');
    return json(r);
  }
  if (mId && m === 'DELETE') {
    await env.DB.prepare(`DELETE FROM transacoes WHERE id=?`).bind(Number(mId[1])).run();
    return json({ ok: true });
  }
  throw erro(404, 'Rota não encontrada');
}

// ---------- Autenticação (senha única da casa) ----------

async function tokenSessao(env) {
  if (!env.SENHA) throw erro(500, 'Defina a senha com: npx wrangler secret put SENHA');
  const dados = new TextEncoder().encode('controle-financeiro:' + env.SENHA);
  const hash = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function iguais(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function cookie(valor, maxAge) {
  return `sessao=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function login(req, env) {
  const { senha } = await req.json().catch(() => ({}));
  if (!env.SENHA || typeof senha !== 'string' || !iguais(senha, env.SENHA)) {
    throw erro(401, 'Senha incorreta');
  }
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(await tokenSessao(env), 60 * 60 * 24 * 365) });
}

async function exigirLogin(req, env) {
  const c = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)sessao=([a-f0-9]+)/);
  if (!c || !iguais(c[1], await tokenSessao(env))) throw erro(401, 'Faça login');
}

// ---------- Atalho do iPhone ----------

async function atalho(req, env) {
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.SENHA || !iguais(auth, env.SENHA)) throw erro(401, 'Senha inválida');

  const b = await req.json().catch(() => null);
  if (!b) throw erro(400, 'Corpo JSON inválido');

  const valor = paraCentavos(b.valor);
  if (!valor) throw erro(400, 'Valor inválido');
  const estabelecimento = String(b.estabelecimento || '').trim().slice(0, 120);
  const lista = pessoas(env);
  const pessoa = lista.find((p) => p.toLowerCase() === String(b.pessoa || '').trim().toLowerCase()) || lista[0];
  const categoria = categorizar(estabelecimento);
  const conta = normalizarConta(b.cartao);
  const data = hojeSP();

  const r = await env.DB.prepare(
    `INSERT INTO transacoes (data, valor, tipo, categoria, pessoa, conta, descricao, origem)
     VALUES (?, ?, 'despesa', ?, ?, ?, ?, 'atalho') RETURNING *`
  ).bind(data, valor, categoria, pessoa, conta, estabelecimento).first();
  return json({ ok: true, id: r.id, categoria, valor: r.valor / 100 }, 201);
}

function categorizar(texto) {
  for (const [re, cat] of REGRAS_CATEGORIA) if (re.test(texto)) return cat;
  return 'A classificar';
}

function normalizarConta(cartao) {
  const c = String(cartao || '').toLowerCase();
  if (/\bnu\b|nubank/.test(c)) return 'Nubank';
  if (/inter/.test(c)) return 'Inter';
  return String(cartao || '').trim().slice(0, 40);
}

// ---------- Utilidades ----------

// Aceita 52.9, "52,90", "R$ 1.234,56", "R$52.90"
export function paraCentavos(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
  let s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Math.abs(parseFloat(s));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function hojeSP() {
  // Data de hoje no fuso de Brasília
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function pessoas(env) {
  return String(env.PESSOAS || 'Marido,Esposa').split(',').map((s) => s.trim()).filter(Boolean);
}

function validar(b, env) {
  if (!b || typeof b !== 'object') throw erro(400, 'Dados inválidos');
  const valor = paraCentavos(b.valor);
  if (!valor) throw erro(400, 'Informe um valor maior que zero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data || '')) throw erro(400, 'Data inválida');
  const tipo = b.tipo === 'receita' ? 'receita' : 'despesa';
  const categoria = CATEGORIAS.includes(b.categoria) ? b.categoria : 'Outros';
  const lista = pessoas(env);
  const pessoa = lista.includes(b.pessoa) ? b.pessoa : lista[0];
  return {
    valor, tipo, categoria, pessoa,
    data: b.data,
    conta: String(b.conta || '').slice(0, 40),
    descricao: String(b.descricao || '').trim().slice(0, 120),
  };
}

function erro(status, msg) {
  return Object.assign(new Error(msg), { status });
}

function json(dados, status = 200, headers = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
