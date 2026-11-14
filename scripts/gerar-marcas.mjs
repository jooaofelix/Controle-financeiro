// Gera public/marcas.js com os logos (simple-icons, CC0) das marcas reconhecidas.
// Rode com: npm run marcas
import * as si from 'simple-icons';
import { writeFileSync } from 'node:fs';

// [id do app, slug do simple-icons, regex para reconhecer na descrição]
const MARCAS = [
  ['netflix', 'netflix', 'netflix'],
  ['spotify', 'spotify', 'spotify'],
  ['ifood', 'ifood', 'ifood'],
  ['uber', 'uber', 'uber'],
  ['primevideo', 'primevideo', 'prime ?video'],
  ['amazon', 'amazon', 'amazon|amzn'],
  ['max', 'max', '\\bhbo\\b|\\bmax\\b'],
  ['youtube', 'youtube', 'youtube'],
  ['applemusic', 'applemusic', 'apple ?music'],
  ['icloud', 'icloud', 'icloud'],
  ['apple', 'apple', 'apple'],
  ['googleplay', 'googleplay', 'google ?play'],
  ['google', 'google', 'google'],
  ['shopee', 'shopee', 'shopee'],
  ['aliexpress', 'aliexpress', 'aliexpress'],
  ['mcdonalds', 'mcdonalds', 'mc ?donald'],
  ['burgerking', 'burgerking', 'burger ?king|\\bbk\\b'],
  ['starbucks', 'starbucks', 'starbucks'],
  ['kfc', 'kfc', '\\bkfc\\b'],
  ['shell', 'shell', '\\bshell\\b'],
  ['carrefour', 'carrefour', 'carrefour'],
  ['nubank', 'nubank', '\\bnu\\b|nubank'],
  ['picpay', 'picpay', 'picpay'],
  ['mercadopago', 'mercadopago', 'mercado ?pago'],
  ['playstation', 'playstation', 'playstation|\\bpsn\\b'],
  ['steam', 'steam', 'steam'],
  ['twitch', 'twitch', 'twitch'],
  ['crunchyroll', 'crunchyroll', 'crunchyroll'],
  ['paramountplus', 'paramountplus', 'paramount'],
  ['airbnb', 'airbnb', 'airbnb'],
  ['openai', 'openai', 'openai|chatgpt'],
  ['claude', 'claude', 'claude|anthropic'],
  ['dropbox', 'dropbox', 'dropbox'],
  ['vivo', 'vivo', '\\bvivo\\b'],
];

// Marcas sem logo no simple-icons: selo com sigla na cor da marca
const SELOS = [
  ['inter', 'Inter', 'FF7A00', 'in', '\\binter\\b'],
  ['mercadolivre', 'Mercado Livre', 'FFE600', 'ML', 'mercado ?livre|mercadolivre'],
  ['disney', 'Disney+', '113CCF', 'D+', 'disney'],
  ['noventaenove', '99', 'FFDD00', '99', '\\b99\\s?(app|pop|taxi|food)?\\b'],
  ['magalu', 'Magalu', '0086FF', 'M', 'magalu|magazine ?luiza'],
  ['rappi', 'Rappi', 'FF441F', 'R', 'rappi'],
  ['deezer', 'Deezer', 'A238FF', 'dz', 'deezer'],
  ['globoplay', 'Globoplay', 'FB0234', 'g', 'globoplay'],
  ['claro', 'Claro', 'DA291C', 'C', '\\bclaro\\b'],
  ['tim', 'TIM', '004691', 'TIM', '\\btim\\b'],
];

const porSlug = Object.fromEntries(Object.values(si).map((i) => [i.slug, i]));
const saida = [];
for (const [id, slug, re] of MARCAS) {
  const i = porSlug[slug];
  if (!i) throw new Error('Ícone não encontrado: ' + slug);
  saida.push({ id, nome: i.title, cor: i.hex, path: i.path, re });
}
for (const [id, nome, cor, sigla, re] of SELOS) saida.push({ id, nome, cor, sigla, re });

writeFileSync(
  'public/marcas.js',
  '// Gerado por scripts/gerar-marcas.mjs — logos: simple-icons (CC0). Marcas pertencem aos donos.\n' +
    'export const MARCAS = ' + JSON.stringify(saida) + ';\n'
);
console.log(saida.length, 'marcas');
