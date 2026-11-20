// Cartão "Bancos (Open Finance)": conectar o Meu Pluggy de cada pessoa e ver a situação
import { $, api, esc, toast } from "/comum.js";

let config = null;
let editando = null; // pessoa sendo configurada

const dataHora = (iso) => iso
  ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—';

export async function cartaoBancos(cfg) {
  config = cfg;
  const el = $('#bancos-conteudo');
  if (!el) return;
  let lista;
  try { lista = await api('/api/bancos'); } catch { el.innerHTML = '<p class="erro">Não consegui carregar.</p>'; return; }

  el.innerHTML = lista.map((b) => {
    if (editando === b.pessoa) return formulario(b);
    if (!b.configurado) {
      return `<div class="banco-pessoa">
        <div class="bp-topo"><b>${esc(b.pessoa)}</b><span class="tag-cinza">não conectado</span></div>
        <button class="btn-sec btn-largo" data-conectar="${esc(b.pessoa)}">🏦 Conectar bancos de ${esc(b.pessoa)}</button>
      </div>`;
    }
    const r = b.ultimo_resumo;
    return `<div class="banco-pessoa">
      <div class="bp-topo"><b>${esc(b.pessoa)}</b><span class="sutil">busca: ${dataHora(b.ultimo_sync)}</span></div>
      ${b.itens.map((i) => {
        const s = i.situacao || { nivel: 'aviso', texto: 'Ainda não verificado' };
        const icone = s.nivel === 'ok' ? '✅' : s.nivel === 'aviso' ? '⏳' : '⚠️';
        const contas = i.contas.map((c) => `${esc(c.nome)} ${esc(c.tipo.toLowerCase())}${c.final ? ' ••' + esc(c.final) : ''}`).join(' · ');
        return `<div class="banco-item ${s.nivel}">
          <span>${icone}</span>
          <div><b>${esc(i.apelido || 'Banco')}</b><small>${esc(s.texto)}${contas ? ' · ' + contas : ''}</small>
            ${s.nivel !== 'ok' ? '<a class="link-renovar" href="https://meu.pluggy.ai" target="_blank" rel="noopener">Renovar no Meu Pluggy →</a>' : ''}</div>
        </div>`;
      }).join('')}
      ${b.ultimo_erro ? `<p class="erro banco-erro">${esc(b.ultimo_erro)}</p>` : ''}
      ${r ? `<p class="sutil banco-resumo">Última busca: ${r.importados} novos · ${r.ligados} já estavam no app · ${r.ignorados} ignorados (fatura, transferências próprias, aplicações)</p>` : ''}
      <div class="acoes-notif">
        <button class="btn-sec" data-sincronizar="${esc(b.pessoa)}">🔄 Sincronizar agora</button>
        <button class="btn-sec" data-conectar="${esc(b.pessoa)}">Editar</button>
      </div>
    </div>`;
  }).join('') + `<p class="dica">Os bancos mandam os dados com atraso (o plano grátis atualiza a cada 24 h e alguns lançamentos chegam dias depois). Compras com Apple Pay continuam chegando na hora pelo Atalho, sem duplicar.</p>`;

  el.querySelectorAll('[data-conectar]').forEach((b) => { b.onclick = () => { editando = b.dataset.conectar; cartaoBancos(config); }; });
  el.querySelectorAll('[data-sincronizar]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Buscando…';
      try {
        const res = await api('/api/bancos/sincronizar', { method: 'POST' });
        const meu = res.find((x) => x.pessoa === b.dataset.sincronizar) || {};
        toast(meu.erros?.length ? 'preocupado' : 'joinha', meu.erros?.length ? 'Busca com erro, veja o cartão' : `${meu.importados || 0} novos lançamentos`);
      } catch (e) { toast('preocupado', e.message); }
      cartaoBancos(config);
    };
  });
  ligarFormulario();
}

function formulario(b) {
  const itens = b.itens?.length ? b.itens : [{ id: '', apelido: 'Nubank' }, { id: '', apelido: 'Inter' }];
  return `<div class="banco-pessoa banco-form">
    <div class="bp-topo"><b>Conectar bancos de ${esc(b.pessoa)}</b></div>
    <ol class="passos">
      <li>Crie sua conta em <a href="https://meu.pluggy.ai" target="_blank" rel="noopener"><b>meu.pluggy.ai</b></a> e conecte o Nubank e o Inter (aprove no app de cada banco).</li>
      <li>Entre em <a href="https://dashboard.pluggy.ai" target="_blank" rel="noopener"><b>dashboard.pluggy.ai</b></a> com o mesmo e-mail e crie uma <b>aplicação</b>.</li>
      <li>Na aplicação, crie uma conexão com o conector <b>MeuPluggy</b>.</li>
      <li>Copie o <b>Client ID</b>, o <b>Client Secret</b> e o <b>Item ID</b> de cada banco e cole abaixo.</li>
    </ol>
    <label class="campo"><span>Client ID</span><input id="bk-id" autocomplete="off" autocapitalize="off" spellcheck="false" value="" placeholder="${b.configurado ? '•••• ' + esc(b.clientIdFim) + ' (cole de novo para trocar)' : 'cole aqui'}"></label>
    <label class="campo"><span>Client Secret</span><input id="bk-secret" type="password" autocomplete="off" placeholder="${b.configurado ? 'deixe em branco para manter' : 'cole aqui'}"></label>
    <span class="rotulo">Bancos (Item ID de cada um)</span>
    <div id="bk-itens">${itens.map(linhaItem).join('')}</div>
    <button class="btn-add" id="bk-mais" type="button">+ outro banco</button>
    <p class="erro" id="bk-erro" hidden></p>
    <div class="acoes-notif">
      ${b.configurado ? '<button class="btn-perigo" id="bk-remover" type="button">Desconectar</button>' : ''}
      <button class="btn-sec" id="bk-cancelar" type="button">Cancelar</button>
      <button class="btn-primario" id="bk-salvar" type="button">Salvar e testar</button>
    </div>
    <p class="dica">🔒 O Client Secret fica guardado só no servidor do pagaAI e nunca aparece de novo na tela. Não mande essas chaves por chat ou print.</p>
  </div>`;
}

function linhaItem(i) {
  return `<div class="bk-item"><input class="bk-apelido" placeholder="Nome (ex.: Nubank)" value="${esc(i.apelido || '')}">
    <input class="bk-itemid" placeholder="Item ID" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(i.id || '')}"></div>`;
}

function ligarFormulario() {
  if (!editando) return;
  $('#bk-mais').onclick = () => $('#bk-itens').insertAdjacentHTML('beforeend', linhaItem({}));
  $('#bk-cancelar').onclick = () => { editando = null; cartaoBancos(config); };
  const rem = $('#bk-remover');
  if (rem) rem.onclick = async () => {
    if (!confirm(`Desconectar os bancos de ${editando}? Os lançamentos já importados continuam no app.`)) return;
    await api('/api/bancos/' + encodeURIComponent(editando), { method: 'DELETE' });
    editando = null; cartaoBancos(config);
  };
  $('#bk-salvar').onclick = async () => {
    const btn = $('#bk-salvar'); const erroEl = $('#bk-erro');
    const itens = [...document.querySelectorAll('.bk-item')].map((d) => ({
      apelido: d.querySelector('.bk-apelido').value, id: d.querySelector('.bk-itemid').value.trim(),
    })).filter((i) => i.id);
    const clientId = $('#bk-id').value.trim();
    erroEl.hidden = true;
    if (!clientId) { erroEl.textContent = 'Cole o Client ID (por segurança ele não fica preenchido).'; erroEl.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Testando…';
    try {
      const r = await api('/api/bancos/' + encodeURIComponent(editando), {
        method: 'PUT', body: JSON.stringify({ clientId, clientSecret: $('#bk-secret').value.trim(), itens }),
      });
      const res = r.resultado || {};
      toast(res.erros?.length ? 'preocupado' : 'comemora', res.erros?.length ? 'Conectou, mas houve erro em algum banco' : `Conectado! ${res.importados || 0} lançamentos importados`);
      editando = null; cartaoBancos(config);
    } catch (e) {
      erroEl.textContent = e.message; erroEl.hidden = false;
      btn.disabled = false; btn.textContent = 'Salvar e testar';
    }
  };
}

