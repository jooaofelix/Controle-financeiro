// Dias úteis bancários (seg a sex, sem feriados nacionais e sem o Carnaval, quando os bancos não abrem).
// Usado para o salário "até o 5º dia útil": considera o dia mais tarde em que ele pode cair.
// Testes: node scripts/testar-diasuteis.mjs

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia);
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const DIA = 86400000;
const cache = new Map();
export function feriados(ano) {
  if (cache.has(ano)) return cache.get(ano);
  const p = pascoa(ano);
  const lista = new Set([
    ...['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map((d) => `${ano}-${d}`),
    iso(p - 48 * DIA), iso(p - 47 * DIA), // Carnaval (segunda e terça)
    iso(p - 2 * DIA),                     // Sexta-feira Santa
    iso(p + 60 * DIA),                    // Corpus Christi
  ]);
  cache.set(ano, lista);
  return lista;
}

export function ehDiaUtil(dataISO) {
  const sem = new Date(dataISO + 'T12:00:00Z').getUTCDay();
  return sem !== 0 && sem !== 6 && !feriados(+dataISO.slice(0, 4)).has(dataISO);
}

// Dia do mês (1..31) do n-ésimo dia útil do mês 'AAAA-MM'
export function enesimoDiaUtil(ym, n) {
  let conta = 0;
  for (let d = 1; d <= 31; d++) {
    const data = `${ym}-${String(d).padStart(2, '0')}`;
    if (new Date(data + 'T12:00:00Z').toISOString().slice(0, 7) !== ym) break;
    if (ehDiaUtil(data) && ++conta === n) return d;
  }
  return 28;
}

// Dia em que o salário cai neste mês: fixo (r.dia) ou "até o Nº dia útil" (r.diaUtil)
export function diaDoSalario(r, ym) {
  return r.diaUtil ? enesimoDiaUtil(ym, r.diaUtil) : r.dia;
}
