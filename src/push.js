// Web Push (notificações no iPhone/Android/computador) sem bibliotecas externas.
// Segue os padrões: RFC 8291 (criptografia da mensagem, "aes128gcm") e RFC 8292 (VAPID).
// Usa só WebCrypto, então roda no Cloudflare Worker e no Node (para os testes).

const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deB64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function juntar(...partes) {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, bytes) {
  const chave = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, chave, bytes * 8);
  return new Uint8Array(bits);
}

// ---------- RFC 8291: criptografa a mensagem para um aparelho ----------
// p256dh = chave pública do aparelho (65 bytes), auth = segredo do aparelho (16 bytes)
export async function criptografar(mensagem, p256dhB64, authB64, { salt, chavesServidor } = {}) {
  const uaPublico = deB64url(p256dhB64);
  const authSegredo = deB64url(authB64);

  const servidor = chavesServidor || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublico = new Uint8Array(await crypto.subtle.exportKey('raw', servidor.publicKey));
  const uaChave = await crypto.subtle.importKey('raw', uaPublico, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaChave }, servidor.privateKey, 256));

  const infoChave = juntar(enc.encode('WebPush: info\0'), uaPublico, asPublico);
  const ikm = await hkdf(authSegredo, ecdh, infoChave, 32);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const texto = juntar(enc.encode(mensagem), new Uint8Array([2])); // 0x02 = último bloco
  const chaveAes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, chaveAes, texto));

  const rs = new Uint8Array([0, 0, 16, 0]); // tamanho do bloco: 4096
  const cabecalho = juntar(salt, rs, new Uint8Array([asPublico.length]), asPublico);
  return juntar(cabecalho, cifrado);
}

// ---------- RFC 8292: assinatura VAPID (identifica o nosso servidor) ----------
export async function cabecalhoVapid(endpoint, vapidPrivadaJwk, vapidPublica, contato) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const cab = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64url(enc.encode(JSON.stringify({ aud, exp, sub: contato })));
  const chave = await crypto.subtle.importKey('jwk', vapidPrivadaJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const assinatura = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, enc.encode(`${cab}.${corpo}`));
  return `vapid t=${cab}.${corpo}.${b64url(assinatura)}, k=${vapidPublica}`;
}

// Envia uma notificação para um aparelho. Devolve o status HTTP do serviço de push.
export async function enviarPush(inscricao, dados, { vapidPrivadaJwk, vapidPublica, contato }) {
  const corpo = await criptografar(JSON.stringify(dados), inscricao.p256dh, inscricao.auth);
  const r = await fetch(inscricao.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await cabecalhoVapid(inscricao.endpoint, vapidPrivadaJwk, vapidPublica, contato),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body: corpo,
  });
  return r.status;
}
