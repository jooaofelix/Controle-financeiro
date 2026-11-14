// Controle Financeiro — API (Cloudflare Worker + Durable Object com SQLite)
import { DurableObject } from 'cloudflare:workers';
import { paraCentavos } from './valores.js';
import { ESTATICOS } from './estaticos.js';

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

// Banco de dados: um Durable Object com SQLite (incluso no plano grátis).
// Todas as rotas /api/* rodam dentro dele, numa única instância "casa".
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS transacoes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    data       TEXT    NOT NULL,                    -- YYYY-MM-DD
    valor      INTEGER NOT NULL,                    -- centavos, sempre positivo
    tipo       TEXT    NOT NULL DEFAULT 'despesa',  -- 'despesa' | 'receita'
    categoria  TEXT    NOT NULL DEFAULT 'A classificar',
    pessoa     TEXT    NOT NULL,
    conta      TEXT    NOT NULL DEFAULT '',
    descricao  TEXT    NOT NULL DEFAULT '',
    origem     TEXT    NOT NULL DEFAULT 'manual',   -- 'manual' | 'atalho'
    criado_em  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_transacoes_data ON transacoes(data)`,
  // Planejador: salários, contas fixas, cartões e ajustes (dados em JSON)
  `CREATE TABLE IF NOT EXISTS plano (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo  TEXT NOT NULL,   -- 'renda' | 'conta' | 'cartao' | 'ajustes'
    dados TEXT NOT NULL
  )`,
];

// Adaptador com a mesma interface do D1 (prepare/bind/all/first/run)
function bancoSql(sql) {
  return {
    prepare(query) {
      let args = [];
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        all: async () => ({ results: sql.exec(query, ...args).toArray() }),
        first: async () => sql.exec(query, ...args).toArray()[0] ?? null,
        run: async () => { sql.exec(query, ...args); return { success: true }; },
      };
      return stmt;
    },
  };
}

export class Casa extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    for (const s of SCHEMA) ctx.storage.sql.exec(s);
    this.db = bancoSql(ctx.storage.sql);
  }
  async fetch(req) {
    const url = new URL(req.url);
    try {
      return await rotear(req, { ...this.env, DB: this.db }, url);
    } catch (e) {
      const msg = e.message || 'Erro interno';
      // `mensagem` é o texto pronto para a notificação do Atalho do iPhone
      return json({ erro: msg, mensagem: `⚠️ pagaAI não anotou: ${msg}` }, e.status || 500);
    }
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return env.CASA.get(env.CASA.idFromName('casa')).fetch(req);
    return arquivoEstatico(url.pathname);
  },
};

// ---------- Arquivos do app (HTML, CSS, JS, ícones) ----------
const binarios = {};
function arquivoEstatico(caminho) {
  const nome = caminho === '/' ? '/index.html' : caminho;
  const a = ESTATICOS[nome];
  if (!a) return new Response('Não encontrado', { status: 404 });
  let corpo = a.corpo;
  if (a.base64) corpo = binarios[nome] ??= Uint8Array.from(atob(a.corpo), (c) => c.charCodeAt(0));
  return new Response(corpo, {
    headers: {
      'Content-Type': a.tipo,
      // HTML/JS/CSS sempre revalidam (atualizações chegam na hora); ícones podem ficar em cache
      'Cache-Control': a.base64 ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

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

  // ---------- Planejador ----------
  if (pathname === '/api/plano' && m === 'GET') {
    const { results } = await env.DB.prepare(`SELECT * FROM plano ORDER BY id`).all();
    const itens = results.map((r) => ({ id: r.id, tipo: r.tipo, ...JSON.parse(r.dados) }));
    return json({ itens, gastoVariavel: await gastoVariavelMedio(env) });
  }
  if (pathname === '/api/plano' && m === 'POST') {
    const { tipo, dados } = validarPlano(await req.json());
    const r = await env.DB.prepare(`INSERT INTO plano (tipo, dados) VALUES (?, ?) RETURNING id`)
      .bind(tipo, JSON.stringify(dados)).first();
    return json({ id: r.id, tipo, ...dados }, 201);
  }
  const mPlano = pathname.match(/^\/api\/plano\/(\d+)$/);
  if (mPlano && m === 'PUT') {
    const { tipo, dados } = validarPlano(await req.json());
    const r = await env.DB.prepare(`UPDATE plano SET tipo=?, dados=? WHERE id=? RETURNING id`)
      .bind(tipo, JSON.stringify(dados), Number(mPlano[1])).first();
    if (!r) throw erro(404, 'Item não encontrado');
    return json({ id: r.id, tipo, ...dados });
  }
  if (mPlano && m === 'DELETE') {
    await env.DB.prepare(`DELETE FROM plano WHERE id=?`).bind(Number(mPlano[1])).run();
    return json({ ok: true });
  }
  throw erro(404, 'Rota não encontrada');
}

// Gasto do dia a dia (mercado, iFood, Uber...) = média dos 2 últimos meses fechados,
// sem contar Casa (aluguel/contas), que já entram como contas fixas no planejador.
async function gastoVariavelMedio(env) {
  const hoje = hojeSP();
  const [a, m] = hoje.slice(0, 7).split('-').map(Number);
  const mesStr = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const meses = [mesStr(new Date(Date.UTC(a, m - 2, 1))), mesStr(new Date(Date.UTC(a, m - 3, 1)))];
  const { results } = await env.DB.prepare(
    `SELECT substr(data,1,7) AS mes, SUM(valor) AS total FROM transacoes
     WHERE tipo='despesa' AND categoria NOT IN ('Casa','Assinaturas') AND substr(data,1,7) IN (?, ?)
     GROUP BY mes`
  ).bind(...meses).all();
  if (!results.length) return { porMes: 0, meses: 0 };
  return { porMes: Math.round(results.reduce((s, r) => s + r.total, 0) / results.length), meses: results.length };
}

function validarPlano(b) {
  const tipo = b?.tipo;
  const dia = (v) => Math.min(31, Math.max(1, parseInt(v, 10) || 1));
  const texto = (v, n = 60) => String(v ?? '').trim().slice(0, n);
  if (tipo === 'renda') {
    const valor = paraCentavos(b.valor);
    if (!valor) throw erro(400, 'Informe o valor');
    return { tipo, dados: { descricao: texto(b.descricao) || 'Salário', pessoa: texto(b.pessoa, 40), valor, dia: dia(b.dia) } };
  }
  if (tipo === 'conta') {
    const valor = paraCentavos(b.valor);
    if (!valor) throw erro(400, 'Informe o valor');
    if (!texto(b.nome)) throw erro(400, 'Informe o nome da conta');
    return { tipo, dados: {
      nome: texto(b.nome), valor, dia: dia(b.dia), flexivel: !!b.flexivel,
      categoria: CATEGORIAS.includes(b.categoria) ? b.categoria : 'Casa',
    } };
  }
  if (tipo === 'cartao') {
    if (!texto(b.nome)) throw erro(400, 'Informe o cartão');
    return { tipo, dados: {
      nome: texto(b.nome, 40), fechamento: dia(b.fechamento), vencimento: dia(b.vencimento),
      valor: paraCentavos(b.valor), flexivel: b.flexivel !== false,
    } };
  }
  if (tipo === 'ajustes') {
    return { tipo, dados: {
      saldoInicial: paraCentavosComSinal(b.saldoInicial),
      gastoVariavel: b.gastoVariavel === '' || b.gastoVariavel == null ? null : paraCentavos(b.gastoVariavel),
    } };
  }
  throw erro(400, 'Tipo inválido');
}

function paraCentavosComSinal(v) {
  const neg = /^\s*-/.test(String(v ?? ''));
  const c = paraCentavos(v);
  return neg ? -c : c;
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
  const auth = (req.headers.get('Authorization') || '').trim().replace(/^Bearer\s+/i, '').trim();
  if (!env.SENHA || !iguais(auth, env.SENHA)) throw erro(401, 'Senha inválida');

  const bruto = await req.json().catch(() => null);
  if (!bruto || typeof bruto !== 'object') throw erro(400, 'Corpo JSON inválido');
  // Aceita chaves com maiúscula, acento ou espaço ("Valor", "Cartão ") — o teclado do iPhone muda sozinho
  const chave = (k) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const b = Object.fromEntries(Object.entries(bruto).map(([k, v]) => [chave(k), typeof v === 'string' ? v.trim() : v]));

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

  // Texto pronto para a notificação no iPhone
  const { total } = await env.DB.prepare(
    `SELECT COALESCE(SUM(valor), 0) AS total FROM transacoes WHERE tipo='despesa' AND substr(data,1,7) = ?`
  ).bind(data.slice(0, 7)).first();
  const onde = estabelecimento ? ` em ${estabelecimento}` : '';
  const linha1 = categoria === 'A classificar'
    ? `📝 Anotado: ${reais(valor)}${onde}. Abra o pagaAI para escolher a categoria.`
    : `✅ Anotado: ${reais(valor)}${onde} (${categoria})`;
  const mensagem = `${linha1}\nGastos de ${NOMES_MES[Number(data.slice(5, 7)) - 1]}: ${reais(total)}`;

  return json({ ok: true, id: r.id, categoria, valor: r.valor / 100, mensagem }, 201);
}

const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const reais = (centavos) => 'R$ ' + (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
