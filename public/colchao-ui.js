// Tela do Colchão (cofrinho): cartão no Início + folha com os colchões, guardar/tirar e histórico
import { $, fmt, esc, api, toast, mascote } from '/comum.js';
import { nivelDoColchao, ritmoDaMeta, frase } from '/colchao.js';

const EMOJIS = ['🛏️', '✈️', '🏖️', '🚗', '🏠', '🎓', '💍', '🎁', '🆘', '🐷', '👶', '🐶'];
let colchoes = [];
let config = null;
let aoMudar = () => {};
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mesAno = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '').replace(' de ', '/');
const centavosTxt = (c) => (c / 100).toFixed(2).replace('.', ',');
const total = () => colchoes.reduce((t, c) => t + c.saldo, 0);

export async function carregarColchao(cfg, mudou) {
  config = cfg; if (mudou) aoMudar = mudou;
  colchoes = await api('/api/colchoes').catch(() => []);
  renderMini();
  if ($('#dlg-colchao').open) renderFolha();
}

function renderMini() {
  const b = $('#card-colchao');
  b.hidden = false;
  const t = total();
  const n = nivelDoColchao(t);
  b.innerHTML = colchoes.length ? `
    ${mascote('colchao', 'colchao-mascote')}
    <span class="colchao-txt"><small>Colchão · ${esc(n.nome)}</small><b>${fmt(t)} guardados</b>
      <i class="colchao-barra"><i style="width:${Math.round(n.progresso * 100)}%"></i></i></span>
    <span class="colchao-seta">›</span>`
  : `${mascote('colchao', 'colchao-mascote')}
    <span class="colchao-txt"><small>Colchão</small><b>Guardar dinheiro debaixo do colchão</b><span class="sutil">Viagem, reserva, carro… crie o primeiro</span></span>
    <span class="colchao-seta">›</span>`;
  b.onclick = () => (colchoes.length ? abrirFolha() : editarColchao());
}

function abrirFolha() { renderFolha(); $('#dlg-colchao').showModal(); }

function renderFolha() {
  const t = total();
  const n = nivelDoColchao(t);
  $('#colchao-topo').innerHTML = `
    <div class="colchao-nivel">
      ${mascote('colchao', 'colchao-mascote-g')}
      <div><small>Vocês têm um</small><b>${n.emoji} ${esc(n.nome)}</b><span>${esc(n.frase)}</span></div>
    </div>
    <div class="colchao-total"><b>${fmt(t)}</b><span>guardados debaixo do colchão</span></div>
    ${n.proximo ? `<div class="colchao-prox"><i class="colchao-barra"><i style="width:${Math.round(n.progresso * 100)}%"></i></i>
      <small>Faltam <b>${fmt(n.faltaProximo)}</b> para virar ${esc(n.proximo.nome)} ${n.proximo.emoji}</small></div>` : ''}`;
  $('#colchao-lista').innerHTML = colchoes.map((c) => {
    const r = ritmoDaMeta(c, hoje());
    const pct = c.meta ? Math.min(100, Math.round((c.saldo / c.meta) * 100)) : null;
    const ritmo = !r ? '' : r.pronto ? '🎉 Meta batida!'
      : r.porMes ? (r.atrasado ? `Passou da data · faltam ${fmt(r.falta)}` : `Guarde ${fmt(r.porMes)}/mês até ${mesAno(c.data_meta)}`)
      : `Faltam ${fmt(r.falta)}`;
    const hist = c.movs.map((m) => `<li><span>${m.valor > 0 ? '⬆️' : '⬇️'} ${fmt(Math.abs(m.valor))}</span>
      <small>${m.data.slice(8, 10)}/${m.data.slice(5, 7)}${m.pessoa ? ' · ' + esc(m.pessoa) : ''}${m.nota ? ' · ' + esc(m.nota) : ''}</small>
      <button class="mov-x" data-apagar-mov="${m.id}" aria-label="Apagar movimento">×</button></li>`).join('');
    return `<div class="colchao-item">
      <button class="colchao-cab" data-editar-colchao="${c.id}">
        <span class="colchao-emoji">${esc(c.emoji)}</span>
        <span class="colchao-txt"><b>${esc(c.nome)}</b><small>${c.onde === 'banco' ? '🏦 numa caixinha do banco' : '💳 separado na conta'}${ritmo ? ' · ' + ritmo : ''}</small></span>
        <span class="colchao-valor"><b>${fmt(c.saldo)}</b>${c.meta ? `<small>de ${fmt(c.meta)}</small>` : ''}</span>
      </button>
      ${pct !== null ? `<i class="colchao-barra"><i style="width:${pct}%"></i></i>` : ''}
      <div class="colchao-acoes">
        <button class="btn-sec" data-mov="tirar" data-id="${c.id}" ${c.saldo <= 0 ? 'disabled' : ''}>− Tirar</button>
        <button class="btn-primario" data-mov="guardar" data-id="${c.id}">+ Guardar</button>
      </div>
      ${hist ? `<details class="colchao-hist"><summary>Histórico</summary><ul>${hist}</ul></details>` : ''}
    </div>`;
  }).join('');
  $('#colchao-lista').querySelectorAll('[data-mov]').forEach((b) => { b.onclick = () => movimentar(Number(b.dataset.id), b.dataset.mov); });
  $('#colchao-lista').querySelectorAll('[data-editar-colchao]').forEach((b) => {
    b.onclick = () => editarColchao(colchoes.find((c) => c.id === Number(b.dataset.editarColchao)));
  });
  $('#colchao-lista').querySelectorAll('[data-apagar-mov]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Apagar este movimento do histórico?')) return;
      await api('/api/colchoes/mov/' + b.dataset.apagarMov, { method: 'DELETE' });
      await atualizar();
    };
  });
}

async function atualizar() { await carregarColchao(config); aoMudar(); }

// Guardar / tirar
function movimentar(id, tipo) {
  const c = colchoes.find((x) => x.id === id);
  const f = $('#form-mov');
  f.dataset.id = id; f.dataset.tipo = tipo;
  $('#mov-titulo').textContent = tipo === 'guardar' ? `⬆️ Guardar no ${c.emoji} ${c.nome}` : `⬇️ Tirar do ${c.emoji} ${c.nome}`;
  $('#mov-sub').textContent = tipo === 'tirar' ? `Tem ${fmt(c.saldo)} nele.` : c.onde === 'banco' ? 'Lembre de mandar o dinheiro para a caixinha no app do banco.' : 'O dinheiro continua na conta, mas sai do “livre para gastar”.';
  f.valor.value = '';
  f.nota.value = '';
  $('#mov-pessoas').innerHTML = config.pessoas.map((p, i) => `<label><input type="radio" name="pessoa" value="${esc(p)}" ${(localStorage.getItem('cf_pessoa') || config.pessoas[0]) === p || (!localStorage.getItem('cf_pessoa') && !i) ? 'checked' : ''}><span>${esc(p)}</span></label>`).join('');
  $('#mov-erro').hidden = true;
  $('#mov-ok').textContent = tipo === 'guardar' ? 'Guardar' : 'Tirar';
  $('#dlg-mov').showModal();
  setTimeout(() => f.valor.focus(), 50);
}

// Novo / editar colchão
function editarColchao(c = null) {
  const f = $('#form-colchao');
  f.dataset.id = c?.id || '';
  $('#ed-titulo').textContent = c ? `${c.emoji} ${c.nome}` : '🛏️ Novo colchão';
  f.nome.value = c?.nome || '';
  f.meta.value = c?.meta ? centavosTxt(c.meta) : '';
  f.data_meta.value = c?.data_meta || '';
  f.onde.value = c?.onde || 'conta';
  $('#ed-emojis').innerHTML = EMOJIS.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${(c?.emoji || '🛏️') === e ? 'checked' : ''}><span>${e}</span></label>`).join('');
  $('#ed-excluir').hidden = !c;
  $('#ed-erro').hidden = true;
  $('#dlg-colchao-ed').showModal();
}

export function iniciarColchao() {
  $('#colchao-novo').onclick = () => editarColchao();
  $('#colchao-fechar').onclick = () => $('#dlg-colchao').close();
  for (const id of ['#dlg-colchao', '#dlg-mov', '#dlg-colchao-ed']) {
    $(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).close(); });
  }
  $('#mov-cancelar').onclick = () => $('#dlg-mov').close();
  $('#form-mov').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/colchoes/${f.dataset.id}/mov`, { method: 'POST', body: JSON.stringify({ tipo: f.dataset.tipo, valor: f.valor.value, pessoa: f.pessoa.value, nota: f.nota.value }) });
      $('#dlg-mov').close();
      toast(f.dataset.tipo === 'guardar' ? 'moeda' : 'preocupado', frase(f.dataset.tipo));
      await atualizar();
    } catch (err) { $('#mov-erro').textContent = err.message; $('#mov-erro').hidden = false; }
  });
  $('#ed-cancelar').onclick = () => $('#dlg-colchao-ed').close();
  $('#ed-excluir').onclick = async () => {
    const id = $('#form-colchao').dataset.id;
    const c = colchoes.find((x) => x.id === Number(id));
    if (!confirm(c?.saldo > 0 ? `Apagar o colchão “${c.nome}”? Os ${fmt(c.saldo)} guardados deixam de ser separados.` : 'Apagar este colchão?')) return;
    await api('/api/colchoes/' + id, { method: 'DELETE' });
    $('#dlg-colchao-ed').close();
    await atualizar();
    if (!colchoes.length) $('#dlg-colchao').close();
  };
  $('#form-colchao').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const dados = { nome: f.nome.value, emoji: f.emoji.value, meta: f.meta.value, data_meta: f.data_meta.value, onde: f.onde.value };
    try {
      const id = f.dataset.id;
      if (id) await api('/api/colchoes/' + id, { method: 'PUT', body: JSON.stringify(dados) });
      else await api('/api/colchoes', { method: 'POST', body: JSON.stringify(dados) });
      $('#dlg-colchao-ed').close();
      if (!id) toast('comemora', 'Colchão novo! Agora é só encher 🛏️');
      await atualizar();
      if (!$('#dlg-colchao').open) abrirFolha();
    } catch (err) { $('#ed-erro').textContent = err.message; $('#ed-erro').hidden = false; }
  });
}
