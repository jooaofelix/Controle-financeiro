// Liga/desliga as notificações de entrada e saída neste aparelho
import { $, api, esc, mascote, toast } from '/comum.js';

const suporta = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const ehIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const instalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const lsGet = (k) => { try { return localStorage.getItem('cf_' + k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem('cf_' + k, v); } catch {} };

function chaveBytes(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function registrarSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

async function inscricaoAtual() {
  if (!suporta()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// Banner no Início convidando a ativar (some depois de ativar ou dispensar)
export async function bannerInicio(onAbrir) {
  const el = $('#banner-notif');
  if (!el) return;
  const sub = await inscricaoAtual();
  const dispensado = lsGet('notif-dispensado') === '1';
  el.hidden = !!sub || dispensado || (suporta() && Notification.permission === 'denied');
  if (el.hidden) return;
  el.innerHTML = `${mascote('celular')}<span><b>Avisar os dois a cada entrada e saída?</b> Ative as notificações neste iPhone.</span>
    <button class="btn-mini" id="banner-notif-sim">Ativar</button><button class="btn-x" id="banner-notif-nao" aria-label="Dispensar">✕</button>`;
  $('#banner-notif-sim').onclick = onAbrir;
  $('#banner-notif-nao').onclick = () => { lsSet('notif-dispensado', '1'); el.hidden = true; };
}

// Cartão de configuração na aba Planejar
export async function cartaoNotificacoes(config) {
  const el = $('#notif-conteudo');
  if (!el) return;
  const aparelhos = await api('/api/push/aparelhos').catch(() => []);
  const lista = aparelhos.length
    ? `<p class="sutil">Recebendo agora: ${aparelhos.map((a) => `<b>${esc(a.pessoa || 'aparelho')}</b>`).join(', ')}</p>`
    : '';

  if (!suporta()) {
    el.innerHTML = ehIOS() && !instalado()
      ? `<div class="vazio-mascote">${mascote('celular')}<p><b>Abra o pagaAI pela tela de início.</b><br>No iPhone, as notificações só funcionam com o app instalado: Safari → Compartilhar → <b>Adicionar à Tela de Início</b>. Depois abra por lá e volte aqui.</p></div>${lista}`
      : `<p class="vazio">Este navegador não aceita notificações. No iPhone, precisa do iOS 16.4 ou mais novo e do app instalado na tela de início.</p>${lista}`;
    return;
  }

  const sub = await inscricaoAtual();
  const minha = sub && aparelhos.find((a) => sub.endpoint.endsWith(a.fim));
  if (sub && minha) {
    el.innerHTML = `
      <div class="notif-ativo">✅ Ativo neste aparelho como <b>${esc(minha.pessoa || '—')}</b></div>
      ${lista}
      <div class="acoes-notif">
        <button class="btn-sec" id="notif-teste">Enviar teste</button>
        <button class="btn-perigo" id="notif-desligar">Desativar aqui</button>
      </div>`;
    $('#notif-teste').onclick = async () => {
      const r = await api('/api/push/teste', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      toast(r.enviados ? 'joinha' : 'preocupado', r.enviados ? 'Teste enviado!' : `Não foi: ${r.erro || r.falhas?.join(', ') || 'erro'}`);
    };
    $('#notif-desligar').onclick = async () => {
      await api('/api/push/remover', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe().catch(() => {});
      toast('pensando', 'Notificações desativadas neste aparelho');
      cartaoNotificacoes(config);
    };
    return;
  }

  const bloqueado = Notification.permission === 'denied';
  const padrao = lsGet('pessoa') || config.pessoas[0];
  el.innerHTML = `
    <p class="sutil" style="margin:0 0 10px">Cada nova entrada ou saída (pelo Atalho ou pelo +) aparece como notificação nos dois iPhones.</p>
    ${lista}
    ${bloqueado
      ? '<p class="erro">As notificações do pagaAI estão bloqueadas neste iPhone. Libere em Ajustes → Notificações → pagaAI.</p>'
      : `<span class="rotulo">Este iPhone é de</span>
         <div class="seg" id="notif-pessoa" style="margin:6px 0 12px">${config.pessoas.map((p) => `<label><input type="radio" name="notif-pessoa" value="${esc(p)}" ${p === padrao ? 'checked' : ''}><span>${esc(p)}</span></label>`).join('')}</div>
         <button class="btn-primario" id="notif-ligar" style="width:100%">🔔 Ativar notificações neste iPhone</button>`}`;
  const btn = $('#notif-ligar');
  if (btn) btn.onclick = () => ativar(config, document.querySelector('input[name=notif-pessoa]:checked')?.value);
}

export async function ativar(config, pessoa) {
  try {
    if (!suporta()) { toast('pensando', 'Abra o pagaAI pela tela de início para ativar'); return; }
    const perm = await Notification.requestPermission(); // precisa vir de um toque no botão
    if (perm !== 'granted') { toast('preocupado', 'Permissão negada. Libere em Ajustes → Notificações.'); return; }
    const { chave } = await api('/api/push/chave');
    if (!chave) { toast('preocupado', 'Servidor sem chave de notificação'); return; }
    const reg = (await navigator.serviceWorker.getRegistration()) || (await registrarSW());
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(chave) }));
    const j = sub.toJSON();
    await api('/api/push/inscrever', { method: 'POST', body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, pessoa: pessoa || config.pessoas[0] }) });
    await api('/api/push/teste', { method: 'POST', body: JSON.stringify({ endpoint: j.endpoint }) });
    toast('comemora', 'Notificações ativadas!');
  } catch (e) {
    toast('preocupado', 'Não deu para ativar: ' + (e.message || e));
  }
  cartaoNotificacoes(config);
  bannerInicio(() => {});
}
