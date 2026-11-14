// Converte texto/número em reais para centavos.
// Aceita 52.9, "52,90", "R$ 1.234,56", "R$52.90", "1.800"
export function paraCentavos(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
  let s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "1.800" = mil e oitocentos
  const n = Math.abs(parseFloat(s));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}
