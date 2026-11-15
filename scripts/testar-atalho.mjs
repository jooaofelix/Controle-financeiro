// Testa a leitura da quantia que chega do Atalho do iPhone.
//   npm run test:atalho
//
// O caso que motivou isto: no crédito, a Quantia do Apple Pay pode chegar como
// objeto com a moeda junto, e a moeda vinha sendo lida no lugar do número.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paraCentavos } from '../src/valores.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fonte = fs.readFileSync(path.join(RAIZ, 'src', 'index.js'), 'utf8');
const corpo = fonte.match(/function acharValor\(bru\) \{[\s\S]*?\n\}/)?.[0];
if (!corpo) {
  console.error('! acharValor não encontrada em src/index.js');
  process.exit(1);
}
const acharValor = new Function('paraCentavos', `${corpo}; return acharValor;`)(paraCentavos);

const casos = [
  ['texto com símbolo',       { valor: 'R$ 45,90' },                              4590],
  ['texto simples',           { valor: '45,90' },                                 4590],
  ['número',                  { valor: 45.9 },                                    4590],
  ['milhar brasileiro',       { valor: 'R$ 1.234,56' },                         123456],
  ['objeto, moeda primeiro',  { valor: { currency: 'BRL', amount: 45.9 } },       4590],
  ['objeto, moeda na chave',  { valor: { BRL: 45.9 } },                           4590],
  ['objeto do iOS',           { valor: { amount: '45,90', currencyCode: 'BRL' } },4590],
  ['chave quantia',           { quantia: '45,90' },                               4590],
  ['chave amount',            { amount: 45.9 },                                   4590],
  ['vazio',                   { valor: '' },                                         0],
  ['ausente',                 { estabelecimento: 'iFood' },                          0],
  ['texto por extenso',       { valor: 'um real' },                                  0],
  ['zero',                    { valor: '0,00' },                                     0],
  ['não lê o cartão',         { cartao: '5432 1098 7654 3210' },                     0],
];

let falhas = 0;
for (const [nome, entrada, esperado] of casos) {
  const obtido = acharValor(entrada);
  if (obtido !== esperado) {
    falhas++;
    console.error(`  X  ${nome}: esperado ${esperado}, obtido ${obtido}`);
  } else {
    console.log(`  ok  ${nome}`);
  }
}
console.log(falhas ? `\n${falhas} caso(s) falharam` : `\n${casos.length} casos, todos passaram`);
process.exit(falhas ? 1 : 0);
