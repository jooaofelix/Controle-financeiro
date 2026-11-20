import {
  $, fmt, esc, api, aoDeslogar, CATS, cat, corCat, marcaDe, iconeMarca, iconeCategoria, MARCAS, mascote, toast, MEIOS,
} from '/comum.js';
import { contasDoMes, parcelaDoMes } from '/dividas.js';
import { sugerirVinculo, situacaoMes, itensPagaveis, nomeItem } from '/vinculos.js';
import { registrarSW, bannerInicio } from '/notificacoes.js';
import { abrirPlano } from '/plano.js';

const MARCA_CONTA = { Nubank: 'nubank', Inter: 'inter' };

let config = null;
let mes = hojeLocal().slice(0, 7);
let transacoes = [];
let totalMesAnterior = 0;
let itensPlano = [];
let pagamentosPlano = []; // gastos já vinculados a contas previstas (meses próximos)
let vinculoManual = false; // a pessoa escolheu o vínculo no formulário (não sobrescrever com sugestão)
let filtroCat = null;
let editandoId = null;

// ---------- Login ----------
aoDeslogar(mostrarLogin);
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
  montarFormulario();
  await carregar();
  await registrarSW();
  bannerInicio(() => {
    mostrarAba('plano');
    setTimeout(() => $('#card-notif')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
  });
}

function mesDeslocado(base, delta) {
  const [a, m] = base.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nomeMes(ym, opts = { month: 'long' }) {
  const [a, m] = ym.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', opts).replace('.', '');
}

async function carregar() {
  const ano = mes.slice(0, 4) !== hojeLocal().slice(0, 4) ? ' ' + mes.slice(2, 4) : '';
  $('#mes-titulo').textContent = maiuscula(nomeMes(mes, { month: 'short' })) + ano;
  $('#hero-rotulo').textContent = 'Gasto em ' + nomeMes(mes);
  const [atual, anterior, plano] = await Promise.all([
    api('/api/transacoes?mes=' + mes),
    api('/api/transacoes?mes=' + mesDeslocado(mes, -1)).catch(() => []),
    api('/api/plano').catch(() => ({ itens: [] })),
  ]);
  transacoes = atual;
  itensPlano = plano.itens;
  pagamentosPlano = plano.pagamentos || [];
  totalMesAnterior = soma(anterior.filter((t) => t.tipo === 'despesa'));
  render();
}

$('#mes-ant').onclick = () => { mes = mesDeslocado(mes, -1); filtroCat = null; carregar(); };
$('#mes-prox').onclick = () => { mes = mesDeslocado(mes, 1); filtroCat = null; carregar(); };

// ---------- Ícones ----------
function iconeTransacao(t, classe = '') {
  const m = marcaDe(t.descricao);
  return m ? iconeMarca(m, classe) : iconeCategoria(t.categoria, classe);
}

// ---------- Render ----------
function render() {
  const gastos = transacoes.filter((t) => t.tipo === 'despesa');
  const totalG = soma(gastos);
  const totalR = soma(transacoes.filter((t) => t.tipo === 'receita'));

  $('#total-gastos').textContent = fmt(totalG);
  $('#total-gastos').classList.toggle('longo', fmt(totalG).length > 12);
  $('#total-receitas').textContent = fmt(totalR);
  $('#saldo').textContent = fmt(totalR - totalG);

  // Comparativo com o mês anterior + humor do mascote
  const comp = $('#comparativo');
  let pose = totalG ? 'joinha' : 'celular';
  if (totalMesAnterior > 0 && totalG > 0) {
    const p = Math.round(((totalG - totalMesAnterior) / totalMesAnterior) * 100);
    comp.textContent = `${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${Math.abs(p)}% vs ${nomeMes(mesDeslocado(mes, -1), { month: 'short' })}`;
    comp.hidden = false;
    pose = p <= -5 ? 'comemora' : p >= 10 ? 'preocupado' : 'oculos';
  } else comp.hidden = true;
  if (totalR > 0 && totalR - totalG < 0) pose = 'preocupado';
  $('#hero-mascote').innerHTML = mascote(pose, 'contorno');

  // Por pessoa
  $('#por-pessoa').innerHTML = config.pessoas.map((p) => `
    <div class="pessoa">
      <span class="avatar">${esc(p.charAt(0).toUpperCase())}</span>
      <div><small>${esc(p)}</small><b>${fmt(soma(gastos.filter((t) => t.pessoa === p)))}</b></div>
    </div>`).join('');

  // A classificar
  const pend = gastos.filter((t) => t.categoria === 'A classificar');
  const aviso = $('#aviso-classificar');
  aviso.hidden = pend.length === 0;
  aviso.innerHTML = `${mascote('pensando')}<span><b>${pend.length} ${pend.length === 1 ? 'gasto chegou' : 'gastos chegaram'} do iPhone sem categoria.</b> Toque para classificar.</span>`;
  aviso.onclick = () => pend[0] && abrirForm(pend[0]);

  renderProximas();
  renderCategorias(gastos, totalG);
  renderComoPagaram(gastos, totalG);
  renderLista();
}

// Gastos do mês por forma de pagamento; crédito separado por cartão
function renderComoPagaram(gastos, totalG) {
  const sec = $('#como-pagaram');
  sec.hidden = !gastos.length;
  if (!gastos.length) return;
  const grupos = {};
  for (const t of gastos) {
    const k = t.meio || '';
    (grupos[k] ||= { total: 0, contas: {} }).total += t.valor;
    if (k === 'credito') grupos[k].contas[t.conta || 'Cartão'] = (grupos[k].contas[t.conta || 'Cartão'] || 0) + t.valor;
  }
  const ordem = [...Object.keys(MEIOS), ''];
  const semInfo = grupos['']?.total || 0;
  $('#como-pagaram-sub').textContent = semInfo ? `${fmt(semInfo)} sem forma informada` : '';
  $('#como-pagaram-lista').innerHTML = ordem.filter((k) => grupos[k]).map((k) => {
    const g = grupos[k];
    const m = MEIOS[k] || { e: '❔', n: 'Não informado' };
    const sub = k === 'credito'
      ? Object.entries(g.contas).map(([c, v]) => `${esc(c)} ${fmt(v)}`).join(' · ')
      : k === '' ? 'Compras do iPhone ficam aqui até o banco confirmar' : '';
    const p = totalG ? Math.round((g.total / totalG) * 100) : 0;
    return `<div class="meio-linha">
      <span class="icone icone-p" style="--c:var(--c-outros)">${m.e}</span>
      <span class="meio-txt"><b>${m.n}</b>${sub ? `<small>${sub}</small>` : ''}</span>
      <span class="meio-val"><b>${fmt(g.total)}</b><small>${p}%</small></span>
    </div>`;
  }).join('');
}

// Contas previstas ativas no mês (dívida só enquanto tiver parcela naquele mês)
function pagaveisNoMes(ym) {
  return itensPagaveis(itensPlano).filter((i) => i.tipo !== 'divida' || (parcelaDoMes(i, ym) >= 1 && parcelaDoMes(i, ym) <= i.total))
    .filter((i) => i.tipo !== 'cartao' || i.valor > 0);
}
const proxMes = (ym) => { const [a, m] = ym.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; };

// Contas e faturas que vencem nos próximos 7 dias (do planejador)
function renderProximas() {
  const card = $('#proximas');
  const hojeISO = hojeLocal();
  const ym = hojeISO.slice(0, 7);
  if (mes !== ym) { card.hidden = true; return; }
  const doMes = situacaoMes(pagaveisNoMes(ym), pagamentosPlano, ym, hojeISO);
  const seguinte = situacaoMes(pagaveisNoMes(proxMes(ym)), pagamentosPlano, proxMes(ym), hojeISO);
  const atrasadas = doMes.filter((c) => c.estado === 'atrasada');
  const breve = [...doMes, ...seguinte].filter((c) => c.estado === 'pendente' && c.diasPara >= 0 && c.diasPara <= 7)
    .sort((x, y) => x.diasPara - y.diasPara);
  const lista = [...atrasadas, ...breve];
  const pagas = doMes.filter((c) => c.estado === 'paga').length;
  card.hidden = !lista.length && !doMes.length;
  if (card.hidden) return;
  $('#proximas-total').textContent = lista.length ? fmt(lista.reduce((s, c) => s + c.previsto, 0)) : '';
  const item = (id) => itensPlano.find((i) => i.id === id) || {};
  const resumo = doMes.length ? `<p class="prox-resumo">✅ ${pagas} de ${doMes.length} contas do mês pagas</p>` : '';
  $('#proximas-lista').innerHTML = lista.map((c) => {
    const it = item(c.id);
    const m = marcaDe(c.nome);
    const ic = m ? iconeMarca(m, 'icone-p') : iconeCategoria(it.categoria || 'Casa', 'icone-p');
    const dia = Number(c.venc.slice(8, 10));
    const quando = c.estado === 'atrasada' ? `<b class="negativo">venceu dia ${dia} · sem pagamento</b>`
      : c.diasPara === 0 ? '<b class="negativo">vence hoje</b>' : c.diasPara === 1 ? '<b>amanhã</b>' : `dia ${dia} · em ${c.diasPara} dias`;
    return `<div class="prox-item ${c.estado}">${ic}<span>${esc(c.nome)}<small>${quando}</small></span><b>${fmt(c.previsto)}</b></div>`;
  }).join('') + (lista.length ? '' : '<p class="vazio">Nada vencendo nos próximos 7 dias. 🎉</p>') + resumo;
}

function renderCategorias(gastos, totalG) {
  const porCat = {};
  for (const t of gastos) porCat[t.categoria] = (porCat[t.categoria] || 0) + t.valor;
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  $('#qtd-categorias').textContent = cats.length ? `${cats.length} ${cats.length === 1 ? 'categoria' : 'categorias'}` : '';

  // Barra segmentada: categorias sem cor própria viram um único bloco cinza no fim
  const porCor = {};
  for (const [nome, v] of cats) porCor[cat(nome).c] = (porCor[cat(nome).c] || 0) + v;
  const barra = $('#barra-categorias');
  barra.innerHTML = Object.entries(porCor)
    .sort((a, b) => (a[0] === 'outros') - (b[0] === 'outros') || b[1] - a[1])
    .map(([k, v]) => `<i style="flex:${v};background:var(--c-${k})"></i>`).join('');
  barra.setAttribute('aria-label', cats.map(([n, v]) => `${n} ${pct(v, totalG)}%`).join(', '));
  barra.hidden = !cats.length;

  $('#grade-categorias').innerHTML = cats.length
    ? cats.map(([nome, v]) => `
        <button class="cat-card ${filtroCat === nome ? 'ativo' : ''}" style="--c:${corCat(nome)}" data-cat="${esc(nome)}">
          ${iconeCategoria(nome)}
          <span class="nome">${esc(nome)}</span>
          <span class="valor">${fmt(v)}</span>
          <span class="pct"><i style="--p:${pct(v, totalG)}%"></i>${pct(v, totalG)}%</span>
        </button>`).join('')
    : `<div class="vazio-mascote">${mascote('celular')}<p><b>Nenhum gasto neste mês ainda.</b><br>Toque no <b>+</b> ou faça uma compra com Apple Pay — o Atalho do iPhone anota sozinho.</p></div>`;

  document.querySelectorAll('.cat-card').forEach((b) => {
    b.onclick = () => {
      filtroCat = filtroCat === b.dataset.cat ? null : b.dataset.cat;
      render();
    };
  });
}

function renderLista() {
  const filtro = $('#filtro-ativo');
  filtro.hidden = !filtroCat;
  if (filtroCat) {
    filtro.textContent = `${cat(filtroCat).e} ${filtroCat}  ✕`;
    filtro.onclick = () => { filtroCat = null; render(); };
  }
  const itens = filtroCat ? transacoes.filter((t) => t.categoria === filtroCat) : transacoes;
  const lista = $('#lista');
  lista.innerHTML = '';
  if (!itens.length) {
    lista.innerHTML = '<p class="vazio" style="padding:8px 6px">Nada por aqui ainda.</p>';
    return;
  }
  let grupo = null;
  let diaAtual = '';
  for (const t of itens) {
    if (t.data !== diaAtual) {
      diaAtual = t.data;
      const h = document.createElement('div');
      h.className = 'dia';
      h.textContent = rotuloDia(t.data);
      grupo = document.createElement('div');
      grupo.className = 'grupo';
      lista.append(h, grupo);
    }
    const b = document.createElement('button');
    b.className = 'item';
    const nomeCat = t.categoria === 'A classificar'
      ? '<span class="tag-classificar">A classificar</span>'
      : esc(t.categoria);
    const receita = t.tipo === 'receita';
    const vinc = t.plano_id ? itensPlano.find((i) => i.id === t.plano_id) : null;
    b.innerHTML = `
      ${iconeTransacao(t)}
      <span class="meio">
        <span class="desc">${esc(t.descricao || t.categoria)}</span>
        <span class="meta">${MEIOS[t.meio] ? `<span title="${MEIOS[t.meio].n}">${MEIOS[t.meio].e}</span> ` : ''}${vinc ? `<b class="vinc">🔗 ${esc(nomeItem(vinc))}</b> · ` : ''}${nomeCat} · ${esc(t.pessoa)}${t.conta ? ' · ' + esc(t.conta) : ''}${t.origem === 'atalho' ? ' · iPhone' : t.origem === 'banco' ? ' · 🏦' : ''}</span>
      </span>
      <span class="valor ${receita ? 'positivo' : ''}">${receita ? '+' : '−'} ${fmt(t.valor)}</span>`;
    b.onclick = () => abrirForm(t);
    grupo.append(b);
  }
}

// ---------- Formulário ----------
function montarFormulario() {
  $('#chips-categoria').innerHTML = config.categorias
    .filter((c) => c !== 'A classificar')
    .map((c) => `<label><input type="radio" name="categoria" value="${esc(c)}">
      <span style="--c:${corCat(c)}"><em>${cat(c).e}</em>${esc(c)}</span></label>`).join('');
  $('#chips-pessoa').innerHTML = config.pessoas
    .map((p) => `<label><input type="radio" name="pessoa" value="${esc(p)}"><span>${esc(p)}</span></label>`).join('');
  $('#chips-conta').innerHTML = config.contas.map((c) => {
    const m = MARCA_CONTA[c] && MARCAS.find((x) => x.id === MARCA_CONTA[c]);
    const ic = m ? iconeMarca(m) : `<span class="icone" style="--c:var(--c-casa)">💵</span>`;
    return `<label><input type="radio" name="conta" value="${esc(c)}"><span>${ic}${esc(c)}</span></label>`;
  }).join('');

  $('#chips-meio').innerHTML = Object.entries(MEIOS)
    .map(([k, m]) => `<label><input type="radio" name="meio" value="${k}"><span><span class="icone" style="--c:var(--c-outros)">${m.e}</span>${m.n}</span></label>`).join('');

  $('#form').descricao.addEventListener('input', atualizarIconeDesc);
  for (const ev of ['input', 'change']) $('#form').addEventListener(ev, (e) => {
    if (e.target.name === 'plano_id') { vinculoManual = true; $('#vinculo-dica').textContent = ''; return; }
    sugerirNoForm();
  });
  $('#chips-categoria').addEventListener('change', atualizarIconeDesc);
}

function atualizarIconeDesc() {
  const f = $('#form');
  const m = marcaDe(f.descricao.value);
  const html = m ? iconeMarca(m, 'icone-p') : iconeCategoria(f.categoria.value || 'Outros', 'icone-p');
  $('#desc-icone').outerHTML = html.replace('<span class="icone', '<span id="desc-icone" class="icone');
}

function montarVinculo(t) {
  const sel = $('#sel-vinculo');
  const opcoes = itensPagaveis(itensPlano);
  $('#campo-vinculo').hidden = !opcoes.length;
  const grupos = { conta: 'Contas fixas', divida: 'Dívidas no boleto', cartao: 'Faturas de cartão' };
  sel.innerHTML = '<option value="">— nenhuma —</option>' + Object.entries(grupos).map(([tipo, rot]) => {
    const its = opcoes.filter((i) => i.tipo === tipo);
    return its.length ? `<optgroup label="${rot}">${its.map((i) => `<option value="${i.id}">${esc(nomeItem(i))} · ${fmt(i.valor || 0)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  sel.value = t?.plano_id ? String(t.plano_id) : '';
  $('#vinculo-dica').textContent = '';
}

// Sugere a conta prevista enquanto a pessoa preenche (só se ela não escolheu nada à mão)
function sugerirNoForm() {
  if (vinculoManual || $('#campo-vinculo').hidden) return;
  const f = $('#form');
  const valor = Math.round(parseFloat(String(f.valor.value).replace(/\./g, '').replace(',', '.')) * 100) || 0;
  const tx = { tipo: f.tipo.value, valor, data: f.data.value, descricao: f.descricao.value, meio: f.meio.value };
  const pagos = new Set(pagamentosPlano.filter((p) => p.id !== editandoId).map((p) => `${p.plano_id}:${p.plano_mes}`));
  const s = valor && tx.data ? sugerirVinculo(tx, itensPlano, pagos) : null;
  $('#sel-vinculo').value = s ? String(s.id) : '';
  $('#vinculo-dica').textContent = s ? '· sugerido' : '';
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
  marcar('pessoa', t?.pessoa || lsGet('pessoa') || config.pessoas[0]);
  marcar('conta', t?.conta || lsGet('conta') || '');
  marcar('meio', t ? (t.meio || '') : (lsGet('meio') || ''));
  montarVinculo(t);
  vinculoManual = !!t; // ao editar, mantém o vínculo que já existe
  f.data.value = t?.data || hojeLocal();
  atualizarIconeDesc();
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
    meio: f.meio.value || '',
    plano_id: f.plano_id.value ? Number(f.plano_id.value) : null,
    data: f.data.value,
  };
  try {
    if (editandoId) await api('/api/transacoes/' + editandoId, { method: 'PUT', body: JSON.stringify(dados) });
    else await api('/api/transacoes', { method: 'POST', body: JSON.stringify(dados) });
    lsSet('pessoa', dados.pessoa);
    lsSet('conta', dados.conta);
    lsSet('meio', dados.meio);
    $('#dlg').close();
    toast(editandoId ? 'joinha' : 'recibo', editandoId ? 'Lançamento atualizado!' : 'Anotado!');
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
function pct(v, total) { return total ? Math.round((v / total) * 100) : 0; }
function soma(lista) { return lista.reduce((s, t) => s + t.valor, 0); }
function maiuscula(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
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
  return maiuscula(dt.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }).replace('.', ''));
}
function lsGet(k) { try { return localStorage.getItem('cf_' + k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem('cf_' + k, v); } catch {} }

// ---------- Abas ----------
const abas = document.querySelectorAll('[data-aba]');
abas.forEach((b) => { b.onclick = () => mostrarAba(b.dataset.aba); });
function mostrarAba(aba) {
  $('#pagina-inicio').hidden = aba !== 'inicio';
  $('#pagina-plano').hidden = aba !== 'plano';
  abas.forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  window.scrollTo(0, 0);
  if (aba === 'plano') abrirPlano(config).catch(() => {});
  else carregar();
}

iniciar();
