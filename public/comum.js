// Utilidades compartilhadas entre a tela principal e o planejador
import { MARCAS } from '/marcas.js';
export { MARCAS };

export const $ = (s) => document.querySelector(s);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmt = (centavos) => brl.format(centavos / 100);
export const fmtCurto = (centavos) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(centavos / 100);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- API ----------
let deslogado = () => {};
export const aoDeslogar = (fn) => { deslogado = fn; };

export async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
    credentials: 'same-origin',
  });
  if (r.status === 401 && caminho !== '/api/login') {
    deslogado();
    throw new Error('Faça login');
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Erro ' + r.status);
  return dados;
}

// ---------- Categorias ----------
export const CATS = {
  'Mercado':       { e: '🛒', c: 'mercado' },
  'Alimentação':   { e: '🍔', c: 'alimentacao' },
  'Casa':          { e: '🏠', c: 'casa' },
  'Transporte':    { e: '🚗', c: 'transporte' },
  'Saúde':         { e: '💊', c: 'saude' },
  'Lazer':         { e: '🎉', c: 'lazer' },
  'Assinaturas':   { e: '📺', c: 'assinaturas' },
  'Compras':       { e: '🛍️', c: 'compras' },
  'Educação':      { e: '📚', c: 'outros' },
  'Salário':       { e: '💰', c: 'outros' },
  'Outros':        { e: '📦', c: 'outros' },
  'A classificar': { e: '❓', c: 'outros' },
};
export const cat = (nome) => CATS[nome] || CATS['Outros'];

// Formas de pagamento
export const MEIOS = {
  credito:       { e: '💳', n: 'Crédito' },
  debito:        { e: '🏧', n: 'Débito' },
  pix:           { e: '⚡', n: 'Pix' },
  boleto:        { e: '🧾', n: 'Boleto' },
  transferencia: { e: '🔁', n: 'Transferência' },
  dinheiro:      { e: '💵', n: 'Dinheiro' },
};
export const meioTxt = (m) => (MEIOS[m] ? `${MEIOS[m].e} ${MEIOS[m].n}` : '');
export const corCat = (nome) => `var(--c-${cat(nome).c})`;

// ---------- Marcas e ícones ----------
const MARCAS_RE = MARCAS.map((m) => ({ ...m, rx: new RegExp(m.re, 'i') }));
export const marcaDe = (texto) => (texto ? MARCAS_RE.find((m) => m.rx.test(texto)) : null);

function corTexto(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#141414' : '#ffffff';
}

export function iconeMarca(m, classe = '') {
  const miolo = m.path
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${m.path}"/></svg>`
    : `<b>${esc(m.sigla)}</b>`;
  return `<span class="icone marca ${classe}" style="--mc:#${m.cor};--mt:${corTexto(m.cor)}" title="${esc(m.nome)}">${miolo}</span>`;
}

export function iconeCategoria(nome, classe = '') {
  return `<span class="icone ${classe}" style="--c:${corCat(nome)}" aria-hidden="true">${cat(nome).e}</span>`;
}

export function iconeEmoji(emoji, cor, classe = '') {
  return `<span class="icone ${classe}" style="--c:${cor}" aria-hidden="true">${emoji}</span>`;
}

// ---------- Mascote ----------
// Poses: joinha, oculos, comemora, pensando, celular, moeda, correndo, preocupado, recibo
export function mascote(pose, classe = '') {
  return `<img class="mascote ${classe}" src="/mascote/${pose}.webp" alt="" aria-hidden="true">`;
}

let timerToast = null;
export function toast(pose, texto) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.innerHTML = `${mascote(pose)}<span>${esc(texto)}</span>`;
  el.classList.remove('mostra');
  void el.offsetWidth; // reinicia a animação
  el.classList.add('mostra');
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove('mostra'), 2400);
}
