import {
  $, fmt, esc, api, aoDeslogar, CATS, cat, corCat, marcaDe, iconeMarca, iconeCategoria, MARCAS, mascote, toast, MEIOS,
} from '/comum.js';
import { contasDoMes, parcelaDoMes } from '/dividas.js';
import { sugerirVinculo, situacaoMes, itensPagaveis, nomeItem } from '/vinculos.js';
import { registrarSW, bannerInicio } from '/notificacoes.js';
import { abrirPlano } from '/plano.js';
import { parceiroDoRole, somaDias } from '/role.js';
import { carregarColchao, iniciarColchao } from '/colchao-ui.js';

const MARCA_CONTA = { Nubank: 'nubank', Inter: 'inter' };

let config = null;
let mes = hojeLocal().slice(0, 7);
let transacoes = [];
let totalMesAnterior = 0;
let itensPlano = [];
let pagamentosPlano = []; // gastos já vinculados a contas previstas (meses próximos)
let vinculoManual = false; // a pessoa escolheu o vínculo no formulário (não sobrescrever com sugestão)
let filtroCat = null;
let filtroTipo = null;
let saldosContas = [];
let gastoVariavelMes = 0;
let verPagas = false; // Contas do mês: mostrar também as já pagas // 'receita' | 'transferencia' — tocar em Entradas / Entre contas
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
  iniciarColchao();
  await carregar();
  await registrarSW();
  bannerInicio(() => {
    mostrarAba('mais');
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
  // Período fechado do mês: tudo com data de 01 até o último dia conta neste mês (inclusive salário)
  const ultimo = new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0).getDate();
  $('#hero-rotulo').innerHTML = `Gasto em ${nomeMes(mes)} <small class="hero-periodo">01/${mes.slice(5, 7)} a ${ultimo}/${mes.slice(5, 7)}</small>`;
  const [atual, anterior, plano, sal] = await Promise.all([
    api('/api/transacoes?mes=' + mes),
    api('/api/transacoes?mes=' + mesDeslocado(mes, -1)).catch(() => []),
    api('/api/plano').catch(() => ({ itens: [] })),
    api('/api/saldos').catch(() => []),
  ]);
  saldosContas = sal;
  const ajustes = (plano.itens || []).find((i) => i.tipo === 'ajustes') || {};
  gastoVariavelMes = ajustes.gastoVariavel ?? plano.gastoVariavel?.porMes ?? 0;
  transacoes = atual;
  carregarRepetidos();
  // guardar/tirar do colchão muda o saldo livre: recarrega o Início
  carregarColchao(config, () => carregar());
  itensPlano = plano.itens;
  pagamentosPlano = plano.pagamentos || [];
  totalMesAnterior = soma(anterior.filter((t) => t.tipo === 'despesa'));
  render();
}

$('#mes-ant').onclick = () => { mes = mesDeslocado(mes, -1); filtroCat = null; filtroTipo = null; carregar(); };
$('#mes-prox').onclick = () => { mes = mesDeslocado(mes, 1); filtroCat = null; filtroTipo = null; carregar(); };
$('#btn-entradas').onclick = () => filtrarTipo('receita');
$('#entre-contas').onclick = () => filtrarTipo('transferencia');
function filtrarTipo(tipo) {
  filtroTipo = filtroTipo === tipo ? null : tipo;
  filtroCat = null;
  render();
  if (filtroTipo) document.querySelector('.lista-titulo').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
  $('#btn-entradas').classList.toggle('ativo', filtroTipo === 'receita');
  const entre = transacoes.filter((t) => t.tipo === 'transferencia');
  const bEntre = $('#entre-contas');
  bEntre.hidden = !entre.length;
  bEntre.classList.toggle('ativo', filtroTipo === 'transferencia');
  // cada Pix entre vocês aparece duas vezes (saiu de um, entrou no outro): conta só uma
  const movido = soma(entre.filter((t) => !t.par_id || t.tipo_original !== 'receita'));
  bEntre.textContent = `🔁 ${fmt(movido)} passaram entre contas de vocês · fora das contas ›`;

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
  renderRole();
  renderCategorias(gastos, totalG);
  renderComoPagaram(gastos, totalG);
  renderLista();
}

// Gastos do mês por forma de pagamento; crédito separado por cartão
function renderComoPagaram(gastos, totalG) {
  if (!gastos.length) {
    $('#como-pagaram-sub').textContent = '';
    $('#como-pagaram-lista').innerHTML = '<p class="vazio">Nenhum gasto neste mês.</p>';
    return;
  }
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
// Lista de contas do mês com check: atrasadas, próximas e pagas (toque na bolinha para marcar)
function renderProximas() {
  const card = $('#proximas');
  const hojeISO = hojeLocal();
  const ym = hojeISO.slice(0, 7);
  if (mes !== ym) { card.hidden = true; return; }
  const doMes = situacaoMes(pagaveisNoMes(ym), pagamentosPlano, ym, hojeISO).map((c) => ({ ...c, mes: ym }));
  // contas do mês que vem que vencem nos próximos 7 dias (ex.: hoje é 28 e a internet vence dia 2)
  const seguinte = situacaoMes(pagaveisNoMes(proxMes(ym)), pagamentosPlano, proxMes(ym), hojeISO)
    .filter((c) => c.estado !== 'paga' && c.diasPara <= 7).map((c) => ({ ...c, mes: proxMes(ym) }));
  const ordem = { atrasada: 0, pendente: 1, paga: 2 };
  const todas = [...doMes, ...seguinte].sort((x, y) => ordem[x.estado] - ordem[y.estado] || x.diasPara - y.diasPara);
  card.hidden = !todas.length;
  if (card.hidden) return;
  // as já pagas ficam recolhidas (toque em "ver" para abrir)
  const nPagas = todas.filter((c) => c.estado === 'paga').length;
  const lista = verPagas ? todas : todas.filter((c) => c.estado !== 'paga');
  const bPagas = $('#proximas-pagas');
  bPagas.hidden = !nPagas;
  bPagas.textContent = verPagas ? 'Esconder as pagas ▴' : `✓ ${nPagas} ${nPagas === 1 ? 'paga' : 'pagas'} · ver ▾`;
  bPagas.onclick = () => { verPagas = !verPagas; renderProximas(); };

  const pagas = doMes.filter((c) => c.estado === 'paga').length;
  const falta = doMes.filter((c) => c.estado !== 'paga').reduce((s, c) => s + c.previsto, 0);
  $('#proximas-total').innerHTML = `<b>${pagas} de ${doMes.length} pagas</b>${falta ? ` · faltam ${fmt(falta)}` : ' · tudo pago 🎉'}`;
  $('#proximas-barra').style.width = (doMes.length ? Math.round((pagas / doMes.length) * 100) : 0) + '%';

  const item = (id) => itensPlano.find((i) => i.id === id) || {};
  const br = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  $('#proximas-lista').innerHTML = lista.map((c) => {
    const it = item(c.id);
    const m = marcaDe(c.nome);
    const ic = m ? iconeMarca(m, 'icone-p') : iconeCategoria(it.categoria || 'Casa', 'icone-p');
    const dia = Number(c.venc.slice(8, 10));
    const p = c.pagamentos[0];
    const quando = c.estado === 'paga'
      ? (p?.marcada && p.origem === 'manual' ? 'marcada como paga' : `paga em ${br(p.data)}${c.pago !== c.previsto ? ' · ' + fmt(c.pago) : ''}`)
      : c.estado === 'atrasada' ? `<b class="negativo">venceu dia ${dia}</b>`
      : c.diasPara === 0 ? '<b class="negativo">vence hoje</b>' : c.diasPara === 1 ? '<b>vence amanhã</b>' : `dia ${dia} · em ${c.diasPara} dias`;
    const porLancamento = c.estado === 'paga' && c.pagamentos.some((x) => !x.marcada);
    return `<div class="prox-item ${c.estado}">
      <button class="check ${c.estado === 'paga' ? 'on' : ''}" data-check="${c.id}" data-mes="${c.mes}" data-lanc="${porLancamento ? esc(p?.descricao || 'um lançamento') : ''}"
        aria-label="${c.estado === 'paga' ? 'Desmarcar' : 'Marcar'} ${esc(c.nome)} como paga">${c.estado === 'paga' ? '✓' : ''}</button>
      ${ic}<span>${esc(c.nome)}<small>${quando}</small></span><b>${fmt(c.previsto)}</b></div>`;
  }).join('');

  $('#proximas-lista').querySelectorAll('[data-check]').forEach((btn) => {
    btn.onclick = async () => {
      const { check: id, mes: m, lanc } = btn.dataset;
      if (lanc) { toast('pensando', `Paga pelo lançamento “${lanc}”. Para desfazer, edite esse lançamento.`); return; }
      const marcar = !btn.classList.contains('on');
      btn.classList.toggle('on', marcar); btn.textContent = marcar ? '✓' : ''; // resposta imediata
      try {
        if (marcar) await api(`/api/plano/${id}/paga`, { method: 'POST', body: JSON.stringify({ mes: m }) });
        else await api(`/api/plano/${id}/paga?mes=${m}`, { method: 'DELETE' });
        if (marcar) toast('recibo', 'Conta paga! ✅');
        await carregar();
      } catch (e) { toast('preocupado', e.message); await carregar(); }
    };
  });
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
  filtro.hidden = !filtroCat && !filtroTipo;
  if (filtroCat) {
    filtro.textContent = `${cat(filtroCat).e} ${filtroCat}  ✕`;
    filtro.onclick = () => { filtroCat = null; render(); };
  } else if (filtroTipo) {
    filtro.textContent = `${filtroTipo === 'receita' ? '💰 Só entradas' : '🔁 Entre contas'}  ✕`;
    filtro.onclick = () => { filtroTipo = null; render(); };
  }
  const itens = filtroCat ? transacoes.filter((t) => t.categoria === filtroCat && t.tipo === 'despesa')
    : filtroTipo ? transacoes.filter((t) => t.tipo === filtroTipo) : transacoes;
  const lista = $('#lista');
  lista.innerHTML = '';
  if (!itens.length) {
    lista.innerHTML = '<p class="vazio" style="padding:8px 6px">Nada por aqui ainda.</p>';
    return;
  }
  if (filtroTipo === 'receita') {
    const dica = document.createElement('p');
    dica.className = 'dica-lista';
    dica.textContent = 'Alguma não é dinheiro novo (Pix entre vocês, de outra conta sua)? Toque nela e escolha "🔁 Entre contas".';
    lista.append(dica);
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
    const entre = t.tipo === 'transferencia';
    const vinc = t.plano_id ? itensPlano.find((i) => i.id === t.plano_id) : null;
    b.innerHTML = `
      ${iconeTransacao(t)}
      <span class="meio">
        <span class="desc">${esc(t.descricao || t.categoria)}</span>
        <span class="meta">${MEIOS[t.meio] ? `<span title="${MEIOS[t.meio].n}">${MEIOS[t.meio].e}</span> ` : ''}${vinc ? `<b class="vinc">🔗 ${esc(nomeItem(vinc))}</b> · ` : ''}${nomeCat} · ${esc(t.pessoa)}${t.conta ? ' · ' + esc(t.conta) : ''}${t.origem === 'atalho' ? ' · iPhone' : t.origem === 'banco' ? ' · 🏦' : ''}</span>
      </span>
      <span class="valor ${receita ? 'positivo' : entre ? 'neutro' : ''}">${entre ? '🔁' : receita ? '+' : '−'} ${fmt(t.valor)}</span>`;
    if (entre) b.classList.add('item-entre');
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
  $('#form').addEventListener('change', (e) => { if (e.target.name === 'tipo') atualizarTipoForm(); });
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
  atualizarTipoForm();
  f.data.value = t?.data || hojeLocal();
  atualizarIconeDesc();
  $('#dlg').showModal();
  if (!t) setTimeout(() => f.valor.focus(), 50);
}

// "Entre contas" não tem categoria nem conta prevista: esconde o que não se aplica
function atualizarTipoForm() {
  const entre = $('#form').tipo.value === 'transferencia';
  $('#dica-entre').hidden = !entre;
  $('#chips-categoria').hidden = entre;
  $('#chips-categoria').previousElementSibling.hidden = entre;
  if (entre) { $('#campo-vinculo').hidden = true; $('#sel-vinculo').value = ''; }
  else $('#campo-vinculo').hidden = !itensPagaveis(itensPlano).length;
}

// ---------- Parceiro do rolê ----------
const br = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
function periodoRole(preset, hoje) {
  if (preset === 'fds') {
    const sem = new Date(hoje + 'T12:00:00Z').getUTCDay(); // 0 dom … 6 sáb
    if (sem === 0) return [hoje, hoje];
    const sab = somaDias(hoje, 6 - sem);
    return [sem === 6 ? hoje : sexOuSab(hoje, sem, sab), somaDias(sab, 1)];
  }
  if (preset === 'salario') {
    const r = calcularRole(hoje, hoje);
    return [hoje, r?.limite || hoje];
  }
  return [lsGet('role_de') || hoje, lsGet('role_ate') || somaDias(hoje, 7)];
}
// sexta à noite já é rolê: a partir de sexta conta sexta, sábado e domingo
function sexOuSab(hoje, sem, sab) { return sem === 5 ? hoje : sab; }
function calcularRole(de, ate) {
  if (!saldosContas.length) return null;
  const reserva = Math.round((parseFloat(String(lsGet('role_reserva') || '0').replace(/\./g, '').replace(',', '.')) || 0) * 100);
  return parceiroDoRole({
    saldoAgora: saldosContas.reduce((t, x) => t + x.valor, 0), hojeISO: hojeLocal(), de, ate,
    itens: itensPlano, pagamentos: pagamentosPlano, gastoVariavelMensal: gastoVariavelMes, reserva,
  });
}
function renderRole(presetNovo) {
  const card = $('#card-role');
  const hoje = hojeLocal();
  card.hidden = mes !== hoje.slice(0, 7);
  if (card.hidden) return;
  const res = $('#role-resultado');
  if (!saldosContas.length) {
    $('#role-mascote').innerHTML = mascote('pensando', 'role-mascote');
    $('#role-atalhos').hidden = true; card.querySelector('.role-datas').hidden = true;
    res.innerHTML = '<p class="sutil role-dica">Para saber quanto dá para gastar eu preciso do saldo das contas. Conecte o banco ou informe o saldo na aba 🏦 Bancos.</p>';
    return;
  }
  $('#role-atalhos').hidden = false; card.querySelector('.role-datas').hidden = false;
  const preset = presetNovo || lsGet('role_preset') || 'fds';
  marcar('rolep', preset);
  let [de, ate] = periodoRole(preset, hoje);
  if (presetNovo === undefined && preset === 'livre') { de = $('#role-de').value || de; ate = $('#role-ate').value || ate; }
  if (de < hoje) de = hoje;
  if (ate < de) ate = de;
  $('#role-de').value = de; $('#role-ate').value = ate; $('#role-de').min = hoje; $('#role-ate').min = de;
  const r = calcularRole(de, ate);
  const ok = r.livre > 0;
  $('#role-mascote').innerHTML = mascote(ok ? 'role' : 'preocupado', 'role-mascote' + (ok ? ' role-festa' : ''));
  const periodo = r.dias === 1 ? `em ${de === hoje ? 'hoje' : br(de)}` : `de ${br(de)} a ${br(ate)} (${r.dias} dias)`;
  const separado = r.contas.reduce((t, c) => t - c.valor, 0);
  res.innerHTML = ok ? `
    <div class="role-valor"><b>${fmt(r.livre)}</b><span>livres para gastar ${periodo}</span></div>
    ${r.dias > 1 ? `<p class="role-linha">≈ <b>${fmt(r.porDia)}</b> por dia</p>` : ''}
    ${r.diaADiaNormal > 0 ? `<p class="role-linha">${r.extra > 0
      ? `Tirando o dia a dia normal (~${fmt(r.diaADiaNormal)}), sobram <b>${fmt(r.extra)}</b> só para o rolê 🎉`
      : `Dá só para o dia a dia normal (~${fmt(r.diaADiaNormal)}). Rolê extra fica apertado 😬`}</p>` : ''}
    <details class="role-como"><summary>Como calculei</summary>
      <p>Saldo agora: <b>${fmt(saldosContas.reduce((t, x) => t + x.valor, 0))}</b>${r.salarios.length ? ` · entra até ${br(r.limite)}: ${r.salarios.map((s) => `${esc(s.nome)} ${fmt(s.valor)} (${br(s.data)})`).join(', ')}` : ''}</p>
      <p>Separei <b>${fmt(separado)}</b> para as contas até ${br(r.limite)}${r.salario ? `, véspera do próximo salário (${br(r.salario.data)})` : ''}${r.contas.length ? ': ' + r.contas.map((c) => `${esc(c.nome)} ${fmt(-c.valor)} (${c.tipo === 'atrasada' ? 'atrasada' : br(c.data)})`).join(', ') : ''}.</p>
      <p>Fora do período conto o dia a dia normal (${fmt(Math.round(gastoVariavelMes / 30))}/dia). No período, o valor livre já inclui mercado, iFood, passeio…</p>
      <label class="role-reserva">Guardar sempre uma reserva de R$ <input id="role-reserva" inputmode="decimal" placeholder="0,00" value="${esc(lsGet('role_reserva') || '')}"></label>
    </details>`
  : `<div class="role-valor ruim"><b>${fmt(r.livre)}</b><span>${periodo}: não tem folga 😬</span></div>
    <p class="role-linha">Com as contas até ${br(r.limite)}${r.salario ? ` (antes do salário de ${br(r.salario.data)})` : ''}, o saldo ${r.aperto ? `aperta no dia ${br(r.aperto)}` : 'não fecha'}. Melhor segurar os gastos.</p>`;
  const inp = $('#role-reserva');
  if (inp) inp.onchange = () => { lsSet('role_reserva', inp.value.trim()); renderRole(); };
}
$('#role-atalhos').addEventListener('change', (e) => { lsSet('role_preset', e.target.value); renderRole(e.target.value); });
for (const id of ['#role-de', '#role-ate']) {
  $(id).addEventListener('change', () => {
    lsSet('role_preset', 'livre'); lsSet('role_de', $('#role-de').value); lsSet('role_ate', $('#role-ate').value);
    renderRole();
  });
}

// ---------- Repetidos ----------
let repetidos = [];
async function carregarRepetidos() {
  repetidos = await api('/api/repetidos').catch(() => []);
  const av = $('#aviso-repetidos');
  av.hidden = !repetidos.length;
  av.innerHTML = `${mascote('pensando')}<span><b>${repetidos.length} ${repetidos.length === 1 ? 'lançamento parece repetido' : 'lançamentos parecem repetidos'}.</b> Toque para revisar.</span>`;
  av.onclick = abrirRepetidos;
  if ($('#dlg-rep').open) renderRepetidos();
}
function linhaRep(t, rotulo) {
  const sinal = (t.tipo_original || t.tipo) === 'receita' ? '+' : '−';
  const origem = t.origem === 'banco' ? '🏦 banco' : t.origem === 'atalho' ? '📱 iPhone' : '✍️ à mão';
  const [a, m, d] = t.data.split('-');
  return `<div class="rep-linha"><small>${rotulo}</small><b>${esc(t.descricao || t.categoria)}</b>
    <span>${sinal} ${fmt(t.valor)} · ${d}/${m} · ${esc(t.pessoa)}${t.conta ? ' · ' + esc(t.conta) : ''} · ${origem}</span></div>`;
}
function renderRepetidos() {
  $('#rep-todos').hidden = repetidos.length < 2;
  $('#rep-todos').textContent = `Apagar todas as ${repetidos.length} cópias`;
  $('#rep-lista').innerHTML = repetidos.length ? repetidos.map((r, k) => `
    <div class="rep-item ${r.certeza}">
      <p class="rep-motivo">${r.certeza === 'alta' ? '🔴' : '🟡'} ${esc(r.motivo)}</p>
      ${linhaRep(r.manterT, r.juntar ? 'Fica (ligado ao banco)' : 'Fica')}
      ${linhaRep(r.apagarT, 'Sai (cópia)')}
      <div class="rep-acoes">
        <button class="btn-sec" data-ign="${k}">Não é repetido</button>
        <button class="btn-primario" data-res="${k}">Apagar a cópia</button>
      </div>
    </div>`).join('') : '<p class="vazio">Tudo certo, nada repetido. 🎉</p>';
  $('#rep-lista').querySelectorAll('[data-res]').forEach((b) => { b.onclick = () => resolverRep([repetidos[b.dataset.res]]); });
  $('#rep-lista').querySelectorAll('[data-ign]').forEach((b) => {
    b.onclick = async () => {
      const r = repetidos[b.dataset.ign];
      await api('/api/repetidos/ignorar', { method: 'POST', body: JSON.stringify({ manter: r.manter, apagar: r.apagar }) });
      await carregarRepetidos();
    };
  });
}
async function resolverRep(lista) {
  for (const r of lista) {
    await api('/api/repetidos/resolver', { method: 'POST', body: JSON.stringify({ manter: r.manter, apagar: r.apagar }) }).catch(() => {});
  }
  toast('joinha', lista.length === 1 ? 'Cópia apagada!' : `${lista.length} cópias apagadas!`);
  await carregar();
  await carregarRepetidos();
  if (!repetidos.length) $('#dlg-rep').close();
}
function abrirRepetidos() { renderRepetidos(); $('#dlg-rep').showModal(); }
$('#rep-fechar').onclick = () => $('#dlg-rep').close();
$('#rep-todos').onclick = () => { if (confirm(`Apagar as ${repetidos.length} cópias? Fica um de cada.`)) resolverRep([...repetidos]); };
$('#dlg-rep').addEventListener('click', (e) => { if (e.target === $('#dlg-rep')) $('#dlg-rep').close(); });

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
  for (const p of ['inicio', 'plano', 'bancos', 'mais']) $('#pagina-' + p).hidden = aba !== p;
  abas.forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  window.scrollTo(0, 0);
  lsSet('aba', aba);
  if (aba === 'inicio') carregar();
  else abrirPlano(config).catch(() => {});
}

// Início: "Para onde foi" e "Como pagaram" em abas no mesmo cartão
function mostrarVisao(v) {
  $('#visao-cat').hidden = v !== 'cat';
  $('#como-pagaram').hidden = v !== 'meio';
  marcar('visao', v);
  lsSet('visao', v);
}
$('#visao-gastos').addEventListener('change', (e) => mostrarVisao(e.target.value));
mostrarVisao(lsGet('visao') === 'meio' ? 'meio' : 'cat');

$('#btn-sair').onclick = async () => {
  if (!confirm('Sair do pagaAI neste aparelho?')) return;
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
};

iniciar();
