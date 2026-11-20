// Controle Financeiro — API (Cloudflare Worker + Durable Object com SQLite)
import { DurableObject } from 'cloudflare:workers';
import { paraCentavos } from './valores.js';
import { ESTATICOS } from './estaticos.js';
import { enviarPush } from './push.js';
import { PLUGGY_BASE, clientePluggy, classificar, acharDuplicado, situacaoItem, nomeDaConta, categoriaDoPluggy } from './pluggy.js';

const CATEGORIAS = [
  'Mercado', 'Alimentação', 'Casa', 'Transporte', 'Saúde', 'Lazer',
  'Assinaturas', 'Compras', 'Educação', 'Salário', 'Outros', 'A classificar',
];
const CONTAS = ['Nubank', 'Inter', 'Dinheiro'];

// Palavras no nome do estabelecimento -> categoria (usado no Atalho do iPhone)
const REGRAS_CATEGORIA = [
  [/amazon|mercado ?livre|shopee|magalu|magazine|americanas|aliexpress|shein|renner|riachuelo/i, 'Compras'],
  [/ifood|rappi|restaur|lanch|pizz|burger|mc ?donald|bk |padaria|cafe|café|bar |gourmet|sushi|churrasc|aÇai|açaí|acai|sorvet|doceria|confeitaria|cantina|bistr/i, 'Alimentação'],
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
  // Diário do Atalho do iPhone: últimas chamadas (para descobrir falhas)
  `CREATE TABLE IF NOT EXISTS atalho_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quando TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ok INTEGER NOT NULL,
    resposta TEXT NOT NULL,
    corpo TEXT NOT NULL
  )`,
  // Aparelhos que recebem notificação de cada entrada/saída
  `CREATE TABLE IF NOT EXISTS push_inscricoes (
    endpoint  TEXT PRIMARY KEY,
    p256dh    TEXT NOT NULL,
    auth      TEXT NOT NULL,
    pessoa    TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // Meu Pluggy (Open Finance): credenciais por pessoa (o segredo nunca volta para a tela)
  `CREATE TABLE IF NOT EXISTS bancos (
    pessoa        TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    itens         TEXT NOT NULL DEFAULT '[]',   -- [{id, apelido}]
    ultimo_sync   TEXT,
    ultimo_erro   TEXT,
    ultimo_resumo TEXT
  )`,
  // Situação de cada conexão (item) do Pluggy
  `CREATE TABLE IF NOT EXISTS pluggy_itens (
    item_id      TEXT PRIMARY KEY,
    pessoa       TEXT NOT NULL,
    apelido      TEXT NOT NULL DEFAULT '',
    status       TEXT,
    situacao     TEXT,
    atualizado_em TEXT,
    contas       TEXT NOT NULL DEFAULT '[]',
    aviso_em     TEXT
  )`,
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
    // Migração: id da transação no banco (Open Finance), para não importar duas vezes
    try { ctx.storage.sql.exec(`ALTER TABLE transacoes ADD COLUMN externo_id TEXT`); } catch {}
    ctx.storage.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transacoes_externo ON transacoes(externo_id) WHERE externo_id IS NOT NULL`);
    this.db = bancoSql(ctx.storage.sql);
  }
  async fetch(req) {
    const url = new URL(req.url);
    // Sincronização agendada (só alcançável de dentro do Worker, não pela internet)
    if (url.pathname === '/__sincronizar') {
      return json(await sincronizarTodos({ ...this.env, DB: this.db }));
    }
    try {
      return await rotear(req, { ...this.env, DB: this.db }, url);
    } catch (e) {
      const msg = e.message || 'Erro interno';
      // O Atalho do iPhone recebe texto puro, pronto para virar notificação
      if (url.pathname === '/api/atalho') return texto(`⚠️ pagaAI não anotou: ${msg}`, e.status || 500);
      return json({ erro: msg }, e.status || 500);
    }
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return env.CASA.get(env.CASA.idFromName('casa')).fetch(req);
    return arquivoEstatico(url.pathname);
  },
  // Busca automática no Meu Pluggy (horários em [triggers] no wrangler.toml)
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(env.CASA.get(env.CASA.idFromName('casa')).fetch('https://interno/__sincronizar', { method: 'POST' }));
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
  if (pathname === '/api/atalho' && m === 'POST') return atalhoComDiario(req, env);

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
    await notificarLancamento(env, r);
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

  // ---------- Bancos (Meu Pluggy / Open Finance) ----------
  if (pathname === '/api/bancos' && m === 'GET') return json(await listarBancos(env));
  if (pathname === '/api/bancos/sincronizar' && m === 'POST') return json(await sincronizarTodos(env, { manual: true }));
  // Conectar pelo widget oficial da Pluggy: salva as chaves e devolve um token para abrir a janela
  const mConectar = pathname.match(/^\/api\/bancos\/([^/]+)\/conectar$/);
  if (mConectar && m === 'POST') return json(await tokenConexao(env, decodeURIComponent(mConectar[1]), await req.json().catch(() => ({}))));
  // A janela da Pluggy terminou: guarda o Item ID que ela devolveu e já busca os lançamentos
  const mItem = pathname.match(/^\/api\/bancos\/([^/]+)\/item$/);
  if (mItem && m === 'POST') return json(await adicionarItem(env, decodeURIComponent(mItem[1]), await req.json().catch(() => ({}))));
  const mBanco = pathname.match(/^\/api\/bancos\/([^/]+)$/);
  if (mBanco && m === 'PUT') return json(await salvarBanco(env, decodeURIComponent(mBanco[1]), await req.json().catch(() => ({}))));
  if (mBanco && m === 'DELETE') {
    const pessoa = decodeURIComponent(mBanco[1]);
    await env.DB.prepare(`DELETE FROM bancos WHERE pessoa=?`).bind(pessoa).run();
    await env.DB.prepare(`DELETE FROM pluggy_itens WHERE pessoa=?`).bind(pessoa).run();
    return json({ ok: true });
  }

  // ---------- Notificações (Web Push) ----------
  if (pathname === '/api/push/chave' && m === 'GET') {
    return json({ chave: env.VAPID_PUBLICA || null });
  }
  if (pathname === '/api/push/inscrever' && m === 'POST') {
    const b = await req.json().catch(() => ({}));
    const ep = String(b.endpoint || '');
    if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(ep) || !b.keys?.p256dh || !b.keys?.auth) throw erro(400, 'Inscrição inválida');
    const lista = pessoas(env);
    const pessoa = lista.includes(b.pessoa) ? b.pessoa : '';
    await env.DB.prepare(
      `INSERT INTO push_inscricoes (endpoint, p256dh, auth, pessoa) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, pessoa=excluded.pessoa`
    ).bind(ep, String(b.keys.p256dh), String(b.keys.auth), pessoa).run();
    return json({ ok: true });
  }
  if (pathname === '/api/push/remover' && m === 'POST') {
    const b = await req.json().catch(() => ({}));
    await env.DB.prepare(`DELETE FROM push_inscricoes WHERE endpoint=?`).bind(String(b.endpoint || '')).run();
    return json({ ok: true });
  }
  if (pathname === '/api/push/aparelhos' && m === 'GET') {
    const { results } = await env.DB.prepare(`SELECT endpoint, pessoa, criado_em FROM push_inscricoes ORDER BY criado_em`).all();
    return json(results.map((r) => ({ ...r, endpoint: undefined, servico: new URL(r.endpoint).hostname, fim: r.endpoint.slice(-12) })));
  }
  if (pathname === '/api/push/teste' && m === 'POST') {
    const b = await req.json().catch(() => ({}));
    const r = await notificar(env, {
      titulo: '🔔 pagaAI',
      corpo: 'Notificações ligadas! Vocês vão receber cada entrada e saída aqui.',
      tag: 'teste',
    }, b.endpoint ? String(b.endpoint) : null);
    return json(r);
  }

  if (pathname === '/api/atalho/log' && m === 'GET') {
    const { results } = await env.DB.prepare(`SELECT * FROM atalho_log ORDER BY id DESC LIMIT 15`).all();
    return json(results);
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
  if (tipo === 'divida') {
    const valor = paraCentavos(b.valor);
    if (!valor) throw erro(400, 'Informe o valor da parcela');
    if (!texto(b.nome)) throw erro(400, 'Informe o nome da dívida');
    const total = parseInt(b.total, 10);
    if (!(total >= 1 && total <= 240)) throw erro(400, 'Número de parcelas inválido');
    if (!/^\d{4}-\d{2}$/.test(b.inicio || '')) throw erro(400, 'Mês da 1ª parcela inválido');
    return { tipo, dados: {
      nome: texto(b.nome), valor, total, inicio: b.inicio, dia: dia(b.dia),
      pagamento: ['boleto', 'Nubank', 'Inter'].includes(b.pagamento) ? b.pagamento : 'boleto',
      categoria: CATEGORIAS.includes(b.categoria) ? b.categoria : 'Compras',
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

// Registra cada chamada do Atalho (sem a senha) e devolve a resposta normalmente
async function atalhoComDiario(req, env) {
  const corpoTxt = await req.text().catch(() => '');
  const tipo = req.headers.get('Content-Type') || '';
  let resposta, ok = 1, status = 201;
  try {
    resposta = await atalho(req, env, corpoTxt, tipo);
  } catch (e) {
    ok = 0; status = e.status || 500;
    resposta = `⚠️ pagaAI não anotou: ${e.message || 'Erro interno'}`;
  }
  try {
    // nomes dos cabeçalhos (sem valores) ajudam a achar erro de digitação no Atalho
    const cabecalhos = [...req.headers.keys()].filter((k) => !/^(cf-|x-forwarded|x-real-ip|accept-encoding|connection|host|content-length|cdn-loop)/i.test(k)).join(', ');
    await env.DB.prepare(`INSERT INTO atalho_log (ok, resposta, corpo) VALUES (?, ?, ?)`)
      .bind(ok, resposta, `[${tipo || 'sem tipo'}] [cabeçalhos: ${cabecalhos}] ${corpoTxt}`.slice(0, 1500)).run();
    await env.DB.prepare(`DELETE FROM atalho_log WHERE id NOT IN (SELECT id FROM atalho_log ORDER BY id DESC LIMIT 30)`).run();
  } catch {}
  return texto(resposta, status);
}

// Lê o corpo como JSON; se o Atalho mandar como formulário, também aceita
function lerCorpo(txt, tipo) {
  try { const j = JSON.parse(txt); if (j && typeof j === 'object') return j; } catch {}
  if (/form/i.test(tipo) || txt.includes('=')) {
    const f = Object.fromEntries(new URLSearchParams(txt));
    if (Object.keys(f).length) return f;
  }
  return null;
}

// Valor vindo do iPhone pode ser texto, número ou um objeto (ex.: cartão) — vira texto
function comoTexto(v) {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.nome ?? v.name ?? v.title ?? Object.values(v)[0] ?? '');
  return String(v);
}

// A quantia do Apple Pay nem sempre chega como texto simples: no crédito ela
// pode vir como objeto com moeda junto (ex.: { currency: 'BRL', amount: 45.9 }),
// e aí o primeiro campo do objeto é a moeda, não o número. Procura o primeiro
// pedaço que vira valor de verdade — e só nos campos de quantia, para nunca
// confundir com o número do cartão.
function acharValor(bru) {
  for (const k of ['valor', 'quantia', 'amount', 'total', 'preco']) {
    const v = bru[k];
    if (v == null) continue;
    if (typeof v !== 'object') {
      const c = paraCentavos(v);
      if (c) return c;
      continue;
    }
    for (const parte of Object.values(v)) {
      const c = paraCentavos(parte);
      if (c) return c;
    }
  }
  return 0;
}

async function atalho(req, env, corpoTxt, tipo) {
  // Tolerante ao corretor do iPhone: ignora acento ("maracujá"), maiúsculas, espaços e o "Bearer"
  const normalizar = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '');
  const certa = normalizar(env.SENHA);
  // Procura a senha no Authorization e em qualquer cabeçalho parecido ("Authorizaton", "Autorização"...)
  const candidatos = [];
  for (const [nome, valor] of req.headers) {
    if (/auth|autori|senha|token/i.test(nome)) candidatos.push(normalizar(valor).replace(/^bearer/, ''));
  }
  const auth = candidatos.find((c) => c && iguais(c, certa)) ?? candidatos[0] ?? '';
  if (!env.SENHA || !iguais(auth, certa)) {
    // Pista do que chegou (não revela a senha certa): tamanho, começo e fim
    const dica = auth ? `chegou "${auth.slice(0, 3)}…${auth.slice(-2)}", ${auth.length} letras` : 'cabeçalho Authorization vazio';
    throw erro(401, `Senha inválida (${dica})`);
  }

  const bruto = lerCorpo(corpoTxt, tipo);
  if (!bruto) throw erro(400, 'Corpo vazio ou inválido (confira se o Corpo da Solicitação é JSON)');
  // Aceita chaves com maiúscula, acento ou espaço ("Valor", "Cartão ") — o teclado do iPhone muda sozinho
  const chave = (k) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const bru = Object.fromEntries(Object.entries(bruto).map(([k, v]) => [chave(k), v]));
  const b = Object.fromEntries(Object.entries(bru).map(([k, v]) => [k, typeof v === 'number' ? v : comoTexto(v).trim()]));

  const valor = acharValor(bru);
  // Quando falha, a notificação precisa dizer o bastante para não exigir outro teste:
  // o que veio no campo (cru) e quais campos chegaram.
  if (!valor) {
    const cru = JSON.stringify(bru.valor ?? null).slice(0, 60);
    const campos = Object.keys(bru).join(', ') || 'nenhum';
    throw erro(400, `Valor inválido (chegou: ${cru} | campos: ${campos})`);
  }
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

  await notificarLancamento(env, r);
  return mensagem;
}

// ---------- Bancos: Meu Pluggy ----------

const somaDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

async function listarBancos(env) {
  const { results: bancos } = await env.DB.prepare(`SELECT pessoa, client_id, itens, ultimo_sync, ultimo_erro, ultimo_resumo FROM bancos`).all();
  const { results: itens } = await env.DB.prepare(`SELECT * FROM pluggy_itens`).all();
  return pessoas(env).map((pessoa) => {
    const b = bancos.find((x) => x.pessoa === pessoa);
    if (!b) return { pessoa, configurado: false };
    const lista = JSON.parse(b.itens || '[]');
    return {
      pessoa,
      configurado: true,
      clientIdFim: String(b.client_id).slice(-4),
      itens: lista.map((i) => {
        const r = itens.find((x) => x.item_id === i.id) || {};
        return { id: i.id, apelido: i.apelido, status: r.status || null, situacao: r.situacao ? JSON.parse(r.situacao) : null, atualizado_em: r.atualizado_em || null, contas: JSON.parse(r.contas || '[]') };
      }),
      ultimo_sync: b.ultimo_sync,
      ultimo_erro: b.ultimo_erro,
      ultimo_resumo: b.ultimo_resumo ? JSON.parse(b.ultimo_resumo) : null,
    };
  });
}

async function salvarBanco(env, pessoa, b) {
  if (!pessoas(env).includes(pessoa)) throw erro(400, 'Pessoa inválida');
  const atual = await env.DB.prepare(`SELECT * FROM bancos WHERE pessoa=?`).bind(pessoa).first();
  const clientId = String(b.clientId || '').trim();
  const clientSecret = String(b.clientSecret || '').trim() || atual?.client_secret || '';
  if (!clientId || !clientSecret) throw erro(400, 'Informe o Client ID e o Client Secret');
  const itens = (Array.isArray(b.itens) ? b.itens : [])
    .map((i) => ({ id: String(i.id || '').trim(), apelido: String(i.apelido || '').trim().slice(0, 30) }))
    .filter((i) => /^[A-Za-z0-9-]{8,64}$/.test(i.id))
    .slice(0, 5);
  if (!itens.length) throw erro(400, 'Informe pelo menos um Item ID (copiado do Dashboard da Pluggy)');

  // Testa antes de salvar: se o login falhar, nada é gravado
  await clientePluggy({ clientId, clientSecret }, env.PLUGGY_BASE || PLUGGY_BASE)
    .catch((e) => { throw erro(400, e.message); });
  await env.DB.prepare(
    `INSERT INTO bancos (pessoa, client_id, client_secret, itens) VALUES (?, ?, ?, ?)
     ON CONFLICT(pessoa) DO UPDATE SET client_id=excluded.client_id, client_secret=excluded.client_secret, itens=excluded.itens, ultimo_erro=NULL`
  ).bind(pessoa, clientId, clientSecret, JSON.stringify(itens)).run();
  await env.DB.prepare(`DELETE FROM pluggy_itens WHERE pessoa=? AND item_id NOT IN (${itens.map(() => '?').join(',')})`).bind(pessoa, ...itens.map((i) => i.id)).run();
  const resultado = await sincronizarPessoa(env, pessoa);
  return { ok: true, resultado };
}

async function salvarCredenciais(env, pessoa, clientId, clientSecret) {
  const base = env.PLUGGY_BASE || PLUGGY_BASE;
  await clientePluggy({ clientId, clientSecret }, base).catch((e) => { throw erro(400, e.message); });
  await env.DB.prepare(
    `INSERT INTO bancos (pessoa, client_id, client_secret, itens) VALUES (?, ?, ?, '[]')
     ON CONFLICT(pessoa) DO UPDATE SET client_id=excluded.client_id, client_secret=excluded.client_secret, ultimo_erro=NULL`
  ).bind(pessoa, clientId, clientSecret).run();
}

async function tokenConexao(env, pessoa, b) {
  if (!pessoas(env).includes(pessoa)) throw erro(400, 'Pessoa inválida');
  const atual = await env.DB.prepare(`SELECT * FROM bancos WHERE pessoa=?`).bind(pessoa).first();
  const clientId = String(b.clientId || '').trim() || atual?.client_id || '';
  const clientSecret = String(b.clientSecret || '').trim() || atual?.client_secret || '';
  if (!clientId || !clientSecret) throw erro(400, 'Informe o Client ID e o Client Secret');
  if (clientId !== atual?.client_id || clientSecret !== atual?.client_secret) await salvarCredenciais(env, pessoa, clientId, clientSecret);
  const cli = await clientePluggy({ clientId, clientSecret }, env.PLUGGY_BASE || PLUGGY_BASE);
  const accessToken = await cli.connectToken(pessoa).catch((e) => { throw erro(502, e.message); });
  return { accessToken };
}

async function adicionarItem(env, pessoa, b) {
  const cfg = await env.DB.prepare(`SELECT * FROM bancos WHERE pessoa=?`).bind(pessoa).first();
  if (!cfg) throw erro(400, 'Salve o Client ID e o Client Secret primeiro');
  const id = String(b.id || '').trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw erro(400, 'Item ID inválido');
  const itens = JSON.parse(cfg.itens || '[]');
  if (!itens.some((i) => i.id === id)) {
    if (itens.length >= 5) throw erro(400, 'O plano grátis aceita até 5 conexões');
    itens.push({ id, apelido: String(b.apelido || '').trim().slice(0, 30) });
    await env.DB.prepare(`UPDATE bancos SET itens=? WHERE pessoa=?`).bind(JSON.stringify(itens), pessoa).run();
  }
  return { ok: true, resultado: await sincronizarPessoa(env, pessoa) };
}

async function sincronizarTodos(env, { manual = false } = {}) {
  const { results } = await env.DB.prepare(`SELECT pessoa FROM bancos`).all();
  const saida = [];
  for (const { pessoa } of results) saida.push({ pessoa, ...(await sincronizarPessoa(env, pessoa, { manual })) });
  return saida;
}

async function sincronizarPessoa(env, pessoa, { manual = false } = {}) {
  const cfg = await env.DB.prepare(`SELECT * FROM bancos WHERE pessoa=?`).bind(pessoa).first();
  if (!cfg) return { erro: 'não configurado' };
  const hoje = hojeSP();
  const primeira = !cfg.ultimo_sync;
  // Primeira vez: desde o dia 1º do mês. Depois: últimos 20 dias (o banco manda com atraso)
  const dateFrom = primeira ? hoje.slice(0, 8) + '01' : somaDias(hoje, -20);
  const resumo = { importados: 0, ligados: 0, ignorados: 0, erros: [] };
  const novos = [];
  const itens = JSON.parse(cfg.itens || '[]');

  let cli;
  try {
    cli = await clientePluggy({ clientId: cfg.client_id, clientSecret: cfg.client_secret }, env.PLUGGY_BASE || PLUGGY_BASE);
  } catch (e) {
    resumo.erros.push(e.message);
  }

  for (const it of cli ? itens : []) {
    let apelido = it.apelido || 'Banco';
    try {
      const item = await cli.item(it.id);
      const sit = situacaoItem(item, hoje);
      const contas = await cli.contas(it.id).catch(() => []);
      if (!it.apelido && contas.length) {
        it.apelido = nomeDaConta(contas.find((c) => c.type !== 'CREDIT') || contas[0]);
        await env.DB.prepare(`UPDATE bancos SET itens=? WHERE pessoa=?`).bind(JSON.stringify(itens), pessoa).run();
      }
      apelido = it.apelido || apelido;
      const anterior = await env.DB.prepare(`SELECT aviso_em FROM pluggy_itens WHERE item_id=?`).bind(it.id).first();
      let avisoEm = anterior?.aviso_em || null;
      // Aviso de conexão parada ou vencendo: no máximo um por dia por banco
      if (sit.nivel !== 'ok' && avisoEm !== hoje) {
        await notificar(env, {
          titulo: sit.nivel === 'erro' ? `⚠️ ${apelido} (${pessoa}) parou de atualizar` : `🔔 ${apelido} (${pessoa}): ${sit.texto.toLowerCase()}`,
          corpo: 'Toque para renovar no Meu Pluggy e aprovar no app do banco. Leva uns 30 segundos.',
          tag: `banco-${it.id}`,
          url: 'https://meu.pluggy.ai',
        });
        avisoEm = hoje;
      }
      await env.DB.prepare(
        `INSERT INTO pluggy_itens (item_id, pessoa, apelido, status, situacao, atualizado_em, contas, aviso_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET pessoa=excluded.pessoa, apelido=excluded.apelido, status=excluded.status, situacao=excluded.situacao,
           atualizado_em=excluded.atualizado_em, contas=excluded.contas, aviso_em=excluded.aviso_em`
      ).bind(it.id, pessoa, apelido, sit.status, JSON.stringify(sit), item.lastUpdatedAt || null,
        JSON.stringify(contas.map((c) => ({ nome: nomeDaConta(c, apelido), tipo: c.type === 'CREDIT' ? 'Cartão' : 'Conta', final: String(c.number || '').replace(/\D/g, '').slice(-4) }))), avisoEm).run();
      if (sit.nivel === 'erro') continue;

      for (const conta of contas) {
        const nomeConta = nomeDaConta(conta, apelido);
        for (const t of await cli.transacoes(conta.id, { dateFrom })) {
          if (!t.id) continue;
          const ja = await env.DB.prepare(`SELECT id FROM transacoes WHERE externo_id=?`).bind(String(t.id)).first();
          if (ja) continue;
          const c = classificar(t, conta);
          if (!c.importar) { resumo.ignorados++; continue; }
          const nova = { tipo: c.tipo, valor: c.valor, data: c.data, conta: nomeConta };
          const { results: perto } = await env.DB.prepare(
            `SELECT id, tipo, valor, data, conta, externo_id FROM transacoes WHERE externo_id IS NULL AND data BETWEEN ? AND ?`
          ).bind(somaDias(c.data, -3), somaDias(c.data, 3)).all();
          const dup = acharDuplicado(nova, perto);
          if (dup) {
            await env.DB.prepare(`UPDATE transacoes SET externo_id=? WHERE id=?`).bind(String(t.id), dup.id).run();
            resumo.ligados++;
            continue;
          }
          let categoria = categoriaDoPluggy(c.categoriaPluggy) || categorizar(c.descricao);
          if (c.tipo === 'receita' && categoria === 'A classificar') categoria = 'Outros';
          const r = await env.DB.prepare(
            `INSERT INTO transacoes (data, valor, tipo, categoria, pessoa, conta, descricao, origem, externo_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'banco', ?) RETURNING *`
          ).bind(c.data, c.valor, c.tipo, categoria, pessoa, nomeConta, c.descricao, String(t.id)).first();
          resumo.importados++;
          novos.push(r);
        }
      }
    } catch (e) {
      resumo.erros.push(`${apelido}: ${e.message}`);
    }
  }

  await env.DB.prepare(`UPDATE bancos SET ultimo_sync=?, ultimo_erro=?, ultimo_resumo=? WHERE pessoa=?`)
    .bind(new Date().toISOString(), resumo.erros.join(' | ') || null, JSON.stringify(resumo), pessoa).run();

  // Notificações: na primeira vez, um resumo só; depois, cada lançamento (até 5) + resumo do resto
  if (primeira && resumo.importados + resumo.ligados > 0) {
    await notificar(env, {
      titulo: `🏦 Bancos de ${pessoa} conectados!`,
      corpo: `${resumo.importados} ${resumo.importados === 1 ? 'lançamento importado' : 'lançamentos importados'}${resumo.ligados ? ` e ${resumo.ligados} ${resumo.ligados === 1 ? 'que já estava no app foi reconhecido' : 'que já estavam no app foram reconhecidos'}` : ''}.`,
      tag: `banco-primeira-${pessoa}`,
    });
  } else if (!primeira) {
    for (const r of novos.slice(0, 5)) await notificarLancamento(env, r);
    if (novos.length > 5) {
      await notificar(env, { titulo: `🏦 +${novos.length - 5} lançamentos de ${pessoa}`, corpo: 'Vieram do banco agora. Abra o pagaAI para ver.', tag: `banco-lote-${pessoa}` });
    }
  }
  return { ...resumo, primeira, manual };
}

// ---------- Notificações ----------

// Avisa todos os aparelhos inscritos sobre um lançamento novo (entrada ou saída)
async function notificarLancamento(env, t) {
  try {
    const entrada = t.tipo === 'receita';
    const { total } = await env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) AS total FROM transacoes WHERE tipo=? AND substr(data,1,7) = ?`
    ).bind(entrada ? 'receita' : 'despesa', t.data.slice(0, 7)).first();
    const detalhes = [...new Set([t.descricao, t.categoria, t.pessoa, t.conta])]
      .filter((x) => x && x !== 'A classificar').join(' · ');
    const aviso = t.categoria === 'A classificar' ? '\nToque para escolher a categoria.' : '';
    await notificar(env, {
      titulo: entrada ? `💰 Entrada de ${reais(t.valor)}` : `💸 Saída de ${reais(t.valor)}`,
      corpo: `${detalhes}${aviso}\n${entrada ? 'Entradas' : 'Gastos'} de ${NOMES_MES[Number(t.data.slice(5, 7)) - 1]}: ${reais(total)}`,
      tag: `lancamento-${t.id}`,
    });
  } catch {}
}

// Envia para todos (ou só um endpoint). Inscrições vencidas (404/410) são apagadas.
async function notificar(env, dados, soEndpoint = null) {
  if (!env.VAPID_PUBLICA || !env.VAPID_PRIVADA) return { enviados: 0, erro: 'Notificações não configuradas no servidor' };
  const vapid = { vapidPrivadaJwk: JSON.parse(env.VAPID_PRIVADA), vapidPublica: env.VAPID_PUBLICA, contato: env.VAPID_CONTATO || 'https://controle-financeiro.desatasistemas.workers.dev' };
  const { results } = soEndpoint
    ? await env.DB.prepare(`SELECT * FROM push_inscricoes WHERE endpoint=?`).bind(soEndpoint).all()
    : await env.DB.prepare(`SELECT * FROM push_inscricoes`).all();
  const limite = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 5000))]);
  const res = await Promise.allSettled(results.map((i) => limite(enviarPush(i, dados, vapid))));
  let enviados = 0;
  const falhas = [];
  for (let k = 0; k < res.length; k++) {
    const st = res[k].status === 'fulfilled' ? res[k].value : 0;
    if (st >= 200 && st < 300) enviados++;
    else {
      falhas.push(res[k].status === 'fulfilled' ? `HTTP ${st}` : res[k].reason?.message || 'erro');
      if (st === 404 || st === 410) {
        await env.DB.prepare(`DELETE FROM push_inscricoes WHERE endpoint=?`).bind(results[k].endpoint).run();
      }
    }
  }
  return { enviados, aparelhos: results.length, falhas };
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

function texto(msg, status = 200) {
  return new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function json(dados, status = 200, headers = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
