// Colchão: o "cofrinho" da casa (o dinheiro debaixo do colchão 🛏️).
// Testes: node scripts/testar-colchao.mjs

// Quanto mais guardado, maior o colchão
export const NIVEIS = [
  { ate: 100000, nome: 'Colchonete', emoji: '🧘', frase: 'Todo colchão começa assim. Bora encher!' },
  { ate: 500000, nome: 'Colchão de solteiro', emoji: '🛏️', frase: 'Já dá para deitar tranquilo.' },
  { ate: 1500000, nome: 'Colchão de casal', emoji: '💑', frase: 'Cabe os dois e ainda sobra espaço.' },
  { ate: 4000000, nome: 'Queen size', emoji: '👑', frase: 'Isso aqui já é colchão de hotel.' },
  { ate: Infinity, nome: 'King size', emoji: '🤴', frase: 'Dormindo em cima do dinheiro. Literalmente.' },
];

export function nivelDoColchao(total) {
  const i = NIVEIS.findIndex((n) => total < n.ate);
  const atual = NIVEIS[i];
  const proximo = NIVEIS[i + 1] || null;
  const piso = i ? NIVEIS[i - 1].ate : 0;
  return {
    ...atual,
    proximo,
    faltaProximo: proximo ? atual.ate - total : 0,
    progresso: proximo ? Math.max(0, Math.min(1, (total - piso) / (atual.ate - piso))) : 1,
  };
}

const meses = (de, ate) => (+ate.slice(0, 4) - +de.slice(0, 4)) * 12 + (+ate.slice(5, 7) - +de.slice(5, 7));

// Meta com data: quanto guardar por mês (contando o mês atual) para chegar lá
export function ritmoDaMeta(c, hojeISO) {
  if (!c.meta) return null;
  const falta = Math.max(0, c.meta - c.saldo);
  if (!falta) return { falta: 0, porMes: 0, meses: 0, pronto: true };
  if (!c.data_meta) return { falta, porMes: null, meses: null };
  const m = Math.max(1, meses(hojeISO, c.data_meta) + (c.data_meta.slice(8, 10) >= hojeISO.slice(8, 10) ? 1 : 0));
  return { falta, meses: m, porMes: Math.ceil(falta / m / 100) * 100, atrasado: c.data_meta < hojeISO };
}

// Frases do colchão (para os avisos)
export const FRASES = {
  guardar: ['Mais um dinheirinho debaixo do colchão 🛏️', 'O colchão agradece 😴', 'Colchão mais fofinho! 🛏️'],
  tirar: ['Saiu do colchão. Cuidado com as costas 😅', 'Colchão um pouco mais fino 🫣', 'Tirou do colchão. Usa com sabedoria! 🧠'],
};
export const frase = (tipo) => FRASES[tipo][Math.floor(Math.random() * FRASES[tipo].length)];
