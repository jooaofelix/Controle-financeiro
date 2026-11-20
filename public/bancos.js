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
        const contas = i.contas.map((c) => `${esc(c.nome)} ${esc(c.tipo.toLowerCase())}${c.final ? ' ••' + esc(c.final) : ''}${c.repetidaEm ? ` (já vem pela conexão de ${esc(c.repetidaEm)}, não conto 2×)` : ''}`).join(' · ');
        return `<div class="banco-item ${s.nivel}">
          <span>${icone}</span>
          <div><b>${esc(i.apelido || 'Banco')}</b><small>${esc(s.texto)}${contas ? ' · ' + contas : ''}</small>
            ${s.nivel !== 'ok' ? '<a class="link-renovar" href="https://meu.pluggy.ai" target="_blank" rel="noopener">Renovar no Meu Pluggy →</a>' : ''}</div>
        </div>`;
      }).join('')}
      ${b.ultimo_erro ? `<p class="erro banco-erro">${esc(b.ultimo_erro)}</p>` : ''}
      ${r ? `<p class="sutil banco-resumo">Última busca: ${r.importados} novos · ${r.ligados} já estavam no app · ${r.ignorados} ignorados (fatura, transferências próprias, aplicações)</p>` : ''}
      <div class="acoes-notif">
        <button class="btn-sec" data-sincronizar="${esc(b.pessoa)}">🔄 Sincronizar</button>
        <button class="btn-sec" data-adicionar="${esc(b.pessoa)}">＋ Banco</button>
        <button class="btn-sec" data-conectar="${esc(b.pessoa)}">Editar</button>
      </div>
    </div>`;
  }).join('') + `<p class="dica">Os bancos mandam os dados com atraso (o plano grátis atualiza a cada 24 h e alguns lançamentos chegam dias depois). Compras com Apple Pay continuam chegando na hora pelo Atalho, sem duplicar.</p>`;

  el.querySelectorAll('[data-conectar]').forEach((b) => { b.onclick = () => { editando = b.dataset.conectar; cartaoBancos(config); }; });
  el.querySelectorAll('[data-adicionar]').forEach((b) => {
    b.onclick = () => abrirPluggyConnect(b.dataset.adicionar, {}, b);
  });
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
  const itens = b.itens?.length ? b.itens : [{ id: '', apelido: '' }];
  return `<div class="banco-pessoa banco-form">
    <div class="bp-topo"><b>Conectar bancos de ${esc(b.pessoa)}</b></div>
    <ol class="passos">
      <li>Em <a href="https://meu.pluggy.ai" target="_blank" rel="noopener"><b>meu.pluggy.ai</b></a>, conecte os bancos de ${esc(b.pessoa)} (aprove no app de cada banco).</li>
      <li>Em <a href="https://dashboard.pluggy.ai" target="_blank" rel="noopener"><b>dashboard.pluggy.ai</b></a> (mesmo e-mail) → <b>Aplicações</b> → sua aplicação → <b>Credenciais</b>: copie o <b>Client ID</b> e o <b>Client Secret</b>.</li>
      <li>Cole abaixo e toque em <b>Conectar banco</b>. Na janela da Pluggy, escolha <b>MeuPluggy</b>, entre com sua conta e escolha o banco. Repita para cada banco.</li>
    </ol>
    <label class="campo"><span>Client ID</span><input id="bk-id" autocomplete="off" autocapitalize="off" spellcheck="false" value="" placeholder="${b.configurado ? '•••• ' + esc(b.clientIdFim) + ' (cole de novo para trocar)' : 'cole aqui'}"></label>
    <label class="campo"><span>Client Secret</span><input id="bk-secret" type="password" autocomplete="off" placeholder="${b.configurado ? 'deixe em branco para manter' : 'cole aqui'}"></label>
    <p class="erro" id="bk-erro" hidden></p>
    <button class="btn-primario btn-largo" id="bk-widget" type="button">🏦 Conectar banco</button>
    <details class="bk-manual" ${b.itens?.length ? 'open' : ''}>
      <summary>Já tenho o Item ID (opcional)</summary>
      <div id="bk-itens">${itens.map(linhaItem).join('')}</div>
      <button class="btn-add" id="bk-mais" type="button">+ outro banco</button>
      <button class="btn-sec btn-largo" id="bk-salvar" type="button">Salvar com Item IDs</button>
    </details>
    <div class="acoes-notif">
      ${b.configurado ? '<button class="btn-perigo" id="bk-remover" type="button">Desconectar</button>' : ''}
      <button class="btn-sec" id="bk-cancelar" type="button">Cancelar</button>
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
  $('#bk-widget').onclick = () => {
    const clientId = $('#bk-id').value.trim();
    const clientSecret = $('#bk-secret').value.trim();
    abrirPluggyConnect(editando, { clientId, clientSecret }, $('#bk-widget'));
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


// ---------- Janela oficial da Pluggy (Pluggy Connect) ----------
const PLUGGY_CONNECT_JS = 'https://cdn.pluggy.ai/pluggy-connect/v2.10.0/pluggy-connect.js';

function carregarScript(src) {
  return new Promise((ok, falha) => {
    if (window.PluggyConnect) return ok();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => (window.PluggyConnect ? ok() : falha(new Error('A janela da Pluggy não carregou')));
    s.onerror = () => falha(new Error('Não consegui carregar a janela da Pluggy (verifique a internet)'));
    document.head.append(s);
  });
}

async function abrirPluggyConnect(pessoa, credenciais, botao) {
  const erroEl = $('#bk-erro');
  const texto = botao?.textContent;
  if (erroEl) erroEl.hidden = true;
  if (botao) { botao.disabled = true; botao.textContent = 'Abrindo…'; }
  const volta = () => { if (botao) { botao.disabled = false; botao.textContent = texto; } };
  try {
    const { accessToken } = await api('/api/bancos/' + encodeURIComponent(pessoa) + '/conectar', {
      method: 'POST', body: JSON.stringify(credenciais || {}),
    });
    await carregarScript(PLUGGY_CONNECT_JS);
    const janela = new window.PluggyConnect({
      connectToken: accessToken,
      includeSandbox: false,
      connectorIds: [200], // conector "MeuPluggy" (plano pessoal)
      onSuccess: async (dados) => {
        const id = dados?.item?.id || dados?.id;
        if (!id) { toast('preocupado', 'A Pluggy não devolveu a conexão'); volta(); return; }
        toast('celular', 'Banco conectado! Buscando lançamentos…');
        try {
          const r = await api('/api/bancos/' + encodeURIComponent(pessoa) + '/item', { method: 'POST', body: JSON.stringify({ id }) });
          const res = r.resultado || {};
          toast(res.erros?.length ? 'preocupado' : 'comemora', res.erros?.length ? 'Conectado, mas a busca deu erro (veja o cartão)' : `Pronto! ${res.importados || 0} lançamentos importados`);
        } catch (e) { toast('preocupado', e.message); }
        editando = null; cartaoBancos(config);
      },
      onError: (e) => { toast('preocupado', 'A Pluggy informou um erro: ' + (e?.message || 'tente de novo')); volta(); },
      onClose: () => volta(),
    });
    janela.init();
  } catch (e) {
    if (erroEl) { erroEl.textContent = e.message; erroEl.hidden = false; } else toast('preocupado', e.message);
    volta();
  }
}
