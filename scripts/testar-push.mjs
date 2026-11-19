// Testes das notificações (Web Push): node scripts/testar-push.mjs
// Simula o aparelho: criptografa com src/push.js e decifra como o navegador faria (RFC 8291).
import assert from 'node:assert/strict';
import { criptografar, cabecalhoVapid, b64url, deB64url } from '../src/push.js';

const enc = new TextEncoder();
let ok = 0;
const teste = async (nome, fn) => { await fn(); ok++; console.log('✓', nome); };

async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}

// Lado do aparelho: decifra o corpo aes128gcm
async function decifrar(corpo, uaChaves, authSegredo) {
  const salt = corpo.slice(0, 16);
  const rs = new DataView(corpo.buffer, corpo.byteOffset + 16, 4).getUint32(0);
  const idlen = corpo[20];
  const asPublico = corpo.slice(21, 21 + idlen);
  const cifrado = corpo.slice(21 + idlen);
  const uaPublico = new Uint8Array(await crypto.subtle.exportKey('raw', uaChaves.publicKey));
  const asChave = await crypto.subtle.importKey('raw', asPublico, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asChave }, uaChaves.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublico, ...asPublico]);
  const ikm = await hkdf(authSegredo, ecdh, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const claro = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, cifrado));
  assert.equal(claro[claro.length - 1], 2, 'último byte deve ser o delimitador 0x02');
  return { texto: new TextDecoder().decode(claro.slice(0, -1)), rs, idlen };
}

const aparelho = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const p256dh = b64url(await crypto.subtle.exportKey('raw', aparelho.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));

await teste('mensagem criptografada volta igual no aparelho', async () => {
  const msg = JSON.stringify({ titulo: '💸 Saída de R$ 45,90', corpo: 'iFood · Alimentação · Esposa' });
  const corpo = await criptografar(msg, p256dh, b64url(auth));
  const r = await decifrar(corpo, aparelho, auth);
  assert.equal(r.texto, msg);
  assert.equal(r.rs, 4096);
  assert.equal(r.idlen, 65);
});

await teste('cada envio usa sal e chave novos (não repete o cifrado)', async () => {
  const a = await criptografar('x', p256dh, b64url(auth));
  const b = await criptografar('x', p256dh, b64url(auth));
  assert.notDeepEqual(a, b);
});

await teste('aparelho com segredo diferente não consegue ler', async () => {
  const corpo = await criptografar('segredo', p256dh, b64url(auth));
  await assert.rejects(() => decifrar(corpo, aparelho, crypto.getRandomValues(new Uint8Array(16))));
});

await teste('assinatura VAPID é um JWT ES256 válido para o serviço de push', async () => {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
  const pub = b64url(await crypto.subtle.exportKey('raw', par.publicKey));
  const h = await cabecalhoVapid('https://web.push.apple.com/abc123', jwk, pub, 'https://exemplo.dev');
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, pub);
  const [cab, corpo, sig] = jwt.split('.');
  const dados = JSON.parse(new TextDecoder().decode(deB64url(corpo)));
  assert.equal(dados.aud, 'https://web.push.apple.com');
  assert.equal(dados.sub, 'https://exemplo.dev');
  assert.ok(dados.exp > Date.now() / 1000 && dados.exp <= Date.now() / 1000 + 24 * 3600, 'expira em até 24h');
  assert.equal(JSON.parse(new TextDecoder().decode(deB64url(cab))).alg, 'ES256');
  const valido = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, par.publicKey, deB64url(sig), enc.encode(`${cab}.${corpo}`));
  assert.ok(valido, 'assinatura confere com a chave pública');
});

await teste('bate exatamente com o vetor oficial da RFC 8291 (Apêndice A)', async () => {
  const pub = deB64url('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
  const chavesServidor = {
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  };
  const out = await criptografar('When I grow up, I want to be a watermelon',
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
    { salt: deB64url('DGv6ra1nlYgDCS1FRnbzlw'), chavesServidor });
  assert.equal(b64url(out), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

console.log(`\n${ok} testes de notificação passaram`);
