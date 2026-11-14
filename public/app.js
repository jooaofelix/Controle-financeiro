const $ = (s) => document.querySelector(s);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (centavos) => brl.format(centavos / 100);

let config = null;
let mes = hojeLocal().slice(0, 7);
let transacoes = [];
let editandoId = null;

// ---------- API ----------
async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
    credentials: 'same-origin',
  });
  if (r.status === 401 && caminho !== '/api/login') {
    mostrarLogin();
    throw new Error('Faça login');
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Erro ' + r.status);
  return dados;
}

// ---------- Login ----------
function mostrarLogin() {
  $('#tela-app').hidden = true;
  $('#tela-login').hidden = false;
  $('#senha').focus();
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#erro-login').hidden = true;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ senha: $('#senha').value }) });
    $('#senha').value = '';
    await iniciar();
  } catch (err) {
    $('#erro-login').textContent = err.message;
    $('#erro-login').hidden = false;
  }
});

// ---------- Inicialização ----------
async function iniciar() {
  try {
    config = await api('/api/config');
  } catch {
    return; // 401 já levou para o login
  }
  $('#tela-login').hidden = true;
  $('#tela-app').hidden = false;
  montarChips();
  await carregar();
}

async function carregar() {
  const [a, m] = mes.split('-').map(Number);
  $('#mes-titulo').textContent = maiuscula(new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  transacoes = await api('/api/transacoes?mes=' + mes);
  render();
}

function mudarMes(delta) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  carregar();
}
$('#mes-ant').onclick = () => mudarMes(-1);
$('#mes-prox').onclick = () => mudarMes(1);

// ---------- Render ----------
function render() {
  const gastos = transacoes.filter((t) => t.tipo === 'despesa');
  const totalG = soma(gastos);
  const totalR = soma(transacoes.filter((t) => t.tipo === 'receita'));
  const saldo = totalR - totalG;

  $('#total-gastos').textContent = fmt(totalG);
  $('#total-receitas').textContent = fmt(totalR);
  $('#saldo').textContent = fmt(saldo);
  $('#saldo').className = saldo < 0 ? 'negativo' : 'positivo';

  // Por pessoa
  $('#por-pessoa').innerHTML = config.pessoas
    .map((p) => `<span>${esc(p)}: <b>${fmt(soma(gastos.filter((t) => t.pessoa === p)))}</b></span>`)
    .join('');

  // A classificar
  const pend = gastos.filter((t) => t.categoria === 'A classificar');
  const aviso = $('#aviso-classificar');
  aviso.hidden = pend.length === 0;
  aviso.textContent = `⚠️ ${pend.length} ${pend.length === 1 ? 'gasto' : 'gastos'} do iPhone sem categoria — toque para classificar`;
  aviso.onclick = () => pend[0] && abrirForm(pend[0]);

  // Por categoria
  const porCat = {};
  for (const t of gastos) porCat[t.categoria] = (porCat[t.categoria] || 0) + t.valor;
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  $('#por-categoria').innerHTML = cats.length
    ? cats.map(([c, v]) => `
        <div class="barra-linha">
          <span>${esc(c)}</span><b>${fmt(v)}</b>
          <div class="barra"><i style="width:${Math.max(2, (v / max) * 100)}%"></i></div>
        </div>`).join('')
    : '<p class="vazio">Nenhum gasto neste mês ainda.</p>';

  // Lista agrupada por dia
  const lista = $('#lista');
  lista.innerHTML = '';
  if (!transacoes.length) {
    lista.innerHTML = '<p class="vazio" style="padding:0 4px">Toque em + para lançar o primeiro gasto.</p>';
    return;
  }
  let diaAtual = '';
  for (const t of transacoes) {
    if (t.data !== diaAtual) {
      diaAtual = t.data;
      const h = document.createElement('div');
      h.className = 'dia';
      h.textContent = rotuloDia(t.data);
      lista.append(h);
    }
    const b = document.createElement('button');
    b.className = 'item';
    const cat = t.categoria === 'A classificar' ? `<span class="tag-classificar">A classificar</span>` : esc(t.categoria);
    b.innerHTML = `
      <span class="desc">${esc(t.descricao || t.categoria)}</span>
      <span class="valor ${t.tipo === 'receita' ? 'positivo' : ''}">${t.tipo === 'receita' ? '+' : '−'} ${fmt(t.valor)}</span>
      <span class="meta">${cat} · ${esc(t.pessoa)}${t.conta ? ' · ' + esc(t.conta) : ''}${t.origem === 'atalho' ? ' · iPhone' : ''}</span>`;
    b.onclick = () => abrirForm(t);
    lista.append(b);
  }
}

// ---------- Formulário ----------
function montarChips() {
  const chips = (id, nome, itens) => {
    $(id).innerHTML = itens
      .map((v) => `<label><input type="radio" name="${nome}" value="${esc(v)}"><span>${esc(v)}</span></label>`)
      .join('');
  };
  chips('#chips-categoria', 'categoria', config.categorias.filter((c) => c !== 'A classificar'));
  chips('#chips-pessoa', 'pessoa', config.pessoas);
  chips('#chips-conta', 'conta', config.contas);
}

function marcar(nome, valor) {
  const el = [...document.getElementsByName(nome)].find((i) => i.value === valor);
  if (el) el.checked = true;
  else document.getElementsByName(nome).forEach((i) => (i.checked = false));
}

function abrirForm(t = null) {
  const f = $('#form');
  editandoId = t?.id ?? null;
  $('#erro-form').hidden = true;
  $('#btn-excluir').hidden = !t;
  marcar('tipo', t?.tipo || 'despesa');
  f.valor.value = t ? (t.valor / 100).toFixed(2).replace('.', ',') : '';
  f.descricao.value = t?.descricao || '';
  marcar('categoria', t?.categoria || '');
  marcar('pessoa', t?.pessoa || localStorageGet('pessoa') || config.pessoas[0]);
  marcar('conta', t?.conta || localStorageGet('conta') || '');
  f.data.value = t?.data || hojeLocal();
  $('#dlg').showModal();
  if (!t) setTimeout(() => f.valor.focus(), 50);
}

$('#btn-novo').onclick = () => abrirForm();
$('#btn-cancelar').onclick = () => $('#dlg').close();
$('#dlg').addEventListener('click', (e) => { if (e.target === $('#dlg')) $('#dlg').close(); });

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const dados = {
    tipo: f.tipo.value,
    valor: f.valor.value,
    descricao: f.descricao.value,
    categoria: f.categoria.value || 'Outros',
    pessoa: f.pessoa.value,
    conta: f.conta.value,
    data: f.data.value,
  };
  try {
    if (editandoId) await api('/api/transacoes/' + editandoId, { method: 'PUT', body: JSON.stringify(dados) });
    else await api('/api/transacoes', { method: 'POST', body: JSON.stringify(dados) });
    localStorageSet('pessoa', dados.pessoa);
    localStorageSet('conta', dados.conta);
    $('#dlg').close();
    if (dados.data.slice(0, 7) !== mes) mes = dados.data.slice(0, 7);
    await carregar();
  } catch (err) {
    $('#erro-form').textContent = err.message;
    $('#erro-form').hidden = false;
  }
});

$('#btn-excluir').onclick = async () => {
  if (!editandoId || !confirm('Excluir este lançamento?')) return;
  await api('/api/transacoes/' + editandoId, { method: 'DELETE' });
  $('#dlg').close();
  await carregar();
};

// ---------- Utilidades ----------
function maiuscula(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function soma(lista) { return lista.reduce((s, t) => s + t.valor, 0); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rotuloDia(iso) {
  if (iso === hojeLocal()) return 'Hoje';
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  if (dt.toDateString() === ontem.toDateString()) return 'Ontem';
  return maiuscula(dt.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }));
}
function localStorageGet(k) { try { return localStorage.getItem('cf_' + k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem('cf_' + k, v); } catch {} }

iniciar();
