// Tela "Planejar": salários, contas fixas, cartões e sugestões de vencimento
import { $, fmt, fmtCurto, esc, api, CATS, cat, corCat, marcaDe, iconeMarca, iconeCategoria, iconeEmoji, mascote, toast } from '/comum.js';
import { planejar, DIAS } from '/planejador.js';

let config = null;
let itens = [];
let gastoEstimado = { porMes: 0, meses: 0 };
let resultado = null;
let verSugestao = true;
let diaSelecionado = null;
let editando = null; // { tipo, item? }

export async function abrirPlano(cfg) {
  config = cfg;
  const dados = await api('/api/plano');
  itens = dados.itens;
  gastoEstimado = dados.gastoVariavel;
  render();
}

function montarPlano() {
  const ajustes = itens.find((i) => i.tipo === 'ajustes') || {};
  return {
    rendas: itens.filter((i) => i.tipo === 'renda'),
    contas: itens.filter((i) => i.tipo === 'conta'),
    cartoes: itens.filter((i) => i.tipo === 'cartao'),
    saldoInicial: ajustes.saldoInicial || 0,
    gastoVariavel: ajustes.gastoVariavel ?? gastoEstimado.porMes,
  };
}

// ---------- Ícones dos eventos ----------
function iconeItem(i, classe = '') {
  if (i.tipo === 'renda') return iconeEmoji('💰', 'var(--c-lazer)', classe);
  const m = marcaDe(i.nome);
  if (m) return iconeMarca(m, classe);
  if (i.tipo === 'cartao') return iconeEmoji('💳', 'var(--c-assinaturas)', classe);
  return iconeCategoria(i.categoria || 'Casa', classe);
}

// ---------- Render ----------
function render() {
  const plano = montarPlano();
  resultado = planejar(plano);
  const vazio = !plano.rendas.length && !plano.contas.length && !plano.cartoes.length;

  $('#plano-vazio').hidden = !vazio;
  $('#plano-conteudo').hidden = vazio;

  // Hero
  const { resumo } = resultado;
  $('#plano-sobra').textContent = fmt(resumo.sobra);
  $('#plano-renda').textContent = fmtCurto(resumo.totalRendas);
  $('#plano-fixas').textContent = fmtCurto(resumo.totalFixas);
  $('#plano-variavel').textContent = fmtCurto(resumo.gastoVariavel);
  const sim = verSugestao ? resultado.final : resultado.base;
  $('#plano-minimo').textContent = `Menor saldo do mês: ${fmt(sim.min)} no dia ${sim.diaMin}`;

  // Alertas
  $('#plano-alertas').innerHTML = resultado.alertas
    .map((a) => `<div class="alerta alerta-${a.nivel}">${mascote('preocupado')}<span>${esc(a.texto)}</span></div>`).join('');

  renderCalendario();
  renderSugestoes();
  renderListas(plano);
}

function renderCalendario() {
  const temSug = resultado.sugestoes.length > 0;
  $('#cal-modo').hidden = !temSug;
  document.querySelectorAll('#cal-modo input').forEach((i) => { i.checked = (i.value === 'sug') === verSugestao; });
  const sim = temSug && verSugestao ? resultado.final : resultado.base;
  const diasSalario = new Set(resultado.planoFinal.rendas.map((r) => Math.min(DIAS, r.dia)));
  const movidos = new Set(verSugestao ? resultado.sugestoes.map((s) => s.para) : []);

  let html = '';
  for (let d = 1; d <= DIAS; d++) {
    const evs = sim.porDia[d];
    const neg = sim.saldos[d] < 0;
    const icones = evs.slice(0, 2).map((e) => iconeItem({ ...e.ref, tipo: e.tipo }, 'icone-mini')).join('');
    const mais = evs.length > 2 ? `<small>+${evs.length - 2}</small>` : '';
    html += `<button class="cal-dia ${neg ? 'neg' : ''} ${diasSalario.has(d) ? 'salario' : ''} ${movidos.has(d) ? 'movido' : ''} ${diaSelecionado === d ? 'sel' : ''}" data-dia="${d}">
      <span class="num">${d}</span><span class="evs">${icones}${mais}</span></button>`;
  }
  $('#calendario').innerHTML = html;
  document.querySelectorAll('.cal-dia').forEach((b) => {
    b.onclick = () => { diaSelecionado = Number(b.dataset.dia); renderCalendario(); };
  });

  const det = $('#cal-detalhe');
  if (!diaSelecionado) { det.innerHTML = '<p class="vazio">Toque num dia para ver o que cai nele.</p>'; return; }
  const evs = sim.porDia[diaSelecionado];
  const saldo = sim.saldos[diaSelecionado];
  det.innerHTML = `
    <div class="det-topo"><b>Dia ${diaSelecionado}</b>
      <span>Saldo no fim do dia: <b class="${saldo < 0 ? 'negativo' : 'positivo'}">${fmt(saldo)}</b></span></div>
    ${evs.length ? evs.map((e) => `
      <div class="det-item">${iconeItem({ ...e.ref, tipo: e.tipo }, 'icone-p')}
        <span>${esc(e.nome)}</span>
        <b class="${e.valor > 0 ? 'positivo' : ''}">${e.valor > 0 ? '+' : '−'} ${fmt(Math.abs(e.valor))}</b></div>`).join('')
      : '<p class="vazio">Nenhuma conta ou salário neste dia.</p>'}`;
}

function renderSugestoes() {
  const s = resultado.sugestoes;
  const el = $('#sugestoes');
  if (!s.length) {
    const temFlex = itens.some((i) => (i.tipo === 'conta' && i.flexivel) || (i.tipo === 'cartao' && i.valor > 0));
    el.innerHTML = temFlex
      ? `<div class="vazio-mascote">${mascote('oculos')}<p><b>Tudo no esquema!</b><br>As datas atuais já são as melhores para o saldo de vocês.</p></div>`
      : '<p class="vazio">Marque “posso escolher o vencimento” nas contas que dá para mudar (internet, celular, cartões...) para receber sugestões.</p>';
    return;
  }
  el.innerHTML = s.map((x, i) => `
    <div class="sugestao">
      ${iconeItem({ ...x.item, tipo: x.tipo })}
      <div class="sug-texto">
        <b>${esc(x.nome)}</b>
        <span>Mudar o vencimento do <s>dia ${x.de}</s> para o <b>dia ${x.para}</b></span>
        <small>Menor saldo do mês: ${fmtCurto(x.minAntes)} → <b class="positivo">${fmtCurto(x.minDepois)}</b></small>
      </div>
      <button class="btn-aplicar" data-i="${i}">Já mudei</button>
    </div>`).join('') +
    '<p class="dica">Peça a mudança no app da empresa ou do banco (Nubank e Inter deixam mudar o vencimento no app). Depois toque em “Já mudei”.</p>';
  el.querySelectorAll('.btn-aplicar').forEach((b) => {
    b.onclick = async () => {
      const sug = s[Number(b.dataset.i)];
      const it = itens.find((i) => i.id === sug.item.id);
      const novo = sug.tipo === 'cartao'
        ? (() => { const off = (it.vencimento - it.fechamento + DIAS) % DIAS; return { ...it, vencimento: sug.para, fechamento: ((sug.para - off - 1 + DIAS) % DIAS) + 1 }; })()
        : { ...it, dia: sug.para };
      b.disabled = true;
      await salvarItem({ ...novo, valor: centavosTxt(novo.valor || 0) }, it.id); // a API recebe reais
      toast('recibo', `${sug.nome}: agora vence dia ${sug.para}!`);
    };
  });
}

function renderListas(plano) {
  $('#lista-rendas').innerHTML = plano.rendas.map((r) => linha(r, `${esc(r.pessoa || r.descricao)}`, `Todo dia ${r.dia}`, `+ ${fmt(r.valor)}`, 'positivo')).join('')
    || '<p class="vazio">Adicione o salário de cada um.</p>';
  $('#lista-contas').innerHTML = plano.contas
    .sort((a, b) => a.dia - b.dia)
    .map((c) => linha(c, esc(c.nome), `Vence dia ${c.dia}${c.flexivel ? ' · <span class="tag-flex">pode mudar</span>' : ''}`, fmt(c.valor))).join('')
    || '<p class="vazio">Aluguel, luz, água, internet, escola...</p>';
  $('#lista-cartoes').innerHTML = resultado.cartoes.map((c) => {
    const orig = plano.cartoes.find((x) => x.id === c.id);
    return linha(orig, esc(c.nome),
      `Fecha dia ${orig.fechamento} · vence dia ${orig.vencimento}<br><span class="compra">🛍️ Melhor dia de compra: <b>dia ${(orig.fechamento % DIAS) + 1}</b> (até ${c.prazo} dias para pagar)</span>`,
      c.valor ? fmt(c.valor) : '');
  }).join('') || '<p class="vazio">Cadastre Nubank e Inter para saber o melhor dia de compra.</p>';

  const aj = itens.find((i) => i.tipo === 'ajustes');
  const gv = aj?.gastoVariavel ?? null;
  $('#ajuste-saldo').textContent = fmt(aj?.saldoInicial || 0);
  $('#ajuste-variavel').textContent = fmt(gv ?? gastoEstimado.porMes);
  $('#ajuste-variavel-origem').textContent = gv != null
    ? 'definido por vocês'
    : gastoEstimado.meses ? `média dos lançamentos (${gastoEstimado.meses} ${gastoEstimado.meses === 1 ? 'mês' : 'meses'})` : 'sem lançamentos ainda';

  document.querySelectorAll('[data-editar]').forEach((b) => {
    b.onclick = () => { const it = itens.find((i) => i.id === Number(b.dataset.editar)); abrirEditor(it.tipo, it); };
  });
}

function linha(item, titulo, sub, valor, classeValor = '') {
  return `<button class="item" data-editar="${item.id}">
    ${iconeItem(item)}
    <span class="meio"><span class="desc">${titulo}</span><span class="meta multi">${sub}</span></span>
    <span class="valor ${classeValor}">${valor}</span></button>`;
}

// ---------- Editor (salário / conta / cartão / ajustes) ----------
const CAMPOS = {
  renda: (i) => `
    <h3>💰 Salário</h3>
    <label class="campo"><span>De quem</span>
      <select name="pessoa">${config.pessoas.map((p) => `<option ${i?.pessoa === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <label class="campo"><span>Valor líquido</span><input name="valor" inputmode="decimal" placeholder="0,00" value="${i ? centavosTxt(i.valor) : ''}" required></label>
    <label class="campo"><span>Dia que cai na conta</span><input name="dia" type="number" min="1" max="31" inputmode="numeric" value="${i?.dia ?? 5}" required></label>`,
  conta: (i) => `
    <h3>📄 Conta fixa</h3>
    <label class="campo"><span>Nome</span><input name="nome" placeholder="Ex.: Internet, Luz, Aluguel" value="${esc(i?.nome || '')}" required autocomplete="off"></label>
    <label class="campo"><span>Valor médio</span><input name="valor" inputmode="decimal" placeholder="0,00" value="${i ? centavosTxt(i.valor) : ''}" required></label>
    <label class="campo"><span>Dia do vencimento</span><input name="dia" type="number" min="1" max="31" inputmode="numeric" value="${i?.dia ?? 10}" required></label>
    <label class="campo"><span>Categoria</span>
      <select name="categoria">${Object.keys(CATS).filter((c) => !['A classificar', 'Salário'].includes(c))
        .map((c) => `<option value="${esc(c)}" ${(i?.categoria || 'Casa') === c ? 'selected' : ''}>${cat(c).e} ${esc(c)}</option>`).join('')}</select></label>
    <label class="campo-check"><input type="checkbox" name="flexivel" ${i?.flexivel ? 'checked' : ''}>
      <span>Posso escolher o vencimento<small>Internet, celular, plano de saúde... (aluguel e escola geralmente não)</small></span></label>`,
  cartao: (i) => `
    <h3>💳 Cartão de crédito</h3>
    <label class="campo"><span>Cartão</span>
      <select name="nome">${['Nubank', 'Inter', 'Outro'].map((c) => `<option ${i?.nome === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label class="campo"><span>Dia que a fatura fecha</span><input name="fechamento" type="number" min="1" max="31" inputmode="numeric" value="${i?.fechamento ?? 3}" required></label>
    <label class="campo"><span>Dia do vencimento</span><input name="vencimento" type="number" min="1" max="31" inputmode="numeric" value="${i?.vencimento ?? 10}" required></label>
    <label class="campo"><span>Valor médio da fatura</span><input name="valor" inputmode="decimal" placeholder="0,00" value="${i?.valor ? centavosTxt(i.valor) : ''}"></label>
    <label class="campo-check"><input type="checkbox" name="flexivel" ${i?.flexivel !== false ? 'checked' : ''}>
      <span>Posso mudar o vencimento<small>No app do Nubank e do Inter dá para trocar a data</small></span></label>`,
  ajustes: (i) => `
    <h3>⚙️ Ajustes</h3>
    <label class="campo"><span>Quanto costuma ter na conta no dia 1</span><input name="saldoInicial" inputmode="decimal" placeholder="0,00" value="${i?.saldoInicial ? centavosTxt(i.saldoInicial) : ''}"></label>
    <label class="campo"><span>Gasto do dia a dia por mês</span><input name="gastoVariavel" inputmode="decimal" placeholder="Automático: ${centavosTxt(gastoEstimado.porMes)}" value="${i?.gastoVariavel != null ? centavosTxt(i.gastoVariavel) : ''}"></label>
    <p class="dica">Mercado, iFood, Uber... Deixe em branco para usar a média dos lançamentos (sem contar Casa e Assinaturas, que entram como contas fixas).</p>`,
};

function centavosTxt(c) { return (c / 100).toFixed(2).replace('.', ','); }

function abrirEditor(tipo, item = null) {
  editando = { tipo, item };
  $('#plano-campos').innerHTML = CAMPOS[tipo](item);
  $('#plano-excluir').hidden = !item || tipo === 'ajustes';
  $('#plano-erro').hidden = true;
  $('#dlg-plano').showModal();
}

async function salvarItem(dados, id) {
  if (id) await api('/api/plano/' + id, { method: 'PUT', body: JSON.stringify(dados) });
  else await api('/api/plano', { method: 'POST', body: JSON.stringify(dados) });
  await abrirPlano(config);
}

$('#form-plano').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const dados = { tipo: editando.tipo };
  for (const el of f.querySelectorAll('[name]')) dados[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  try {
    const existente = editando.tipo === 'ajustes' ? itens.find((i) => i.tipo === 'ajustes') : editando.item;
    await salvarItem(dados, existente?.id);
    $('#dlg-plano').close();
    toast('joinha', 'Salvo!');
  } catch (err) {
    $('#plano-erro').textContent = err.message;
    $('#plano-erro').hidden = false;
  }
});
$('#plano-cancelar').onclick = () => $('#dlg-plano').close();
$('#dlg-plano').addEventListener('click', (e) => { if (e.target === $('#dlg-plano')) $('#dlg-plano').close(); });
$('#plano-excluir').onclick = async () => {
  if (!editando?.item || !confirm('Excluir este item?')) return;
  await api('/api/plano/' + editando.item.id, { method: 'DELETE' });
  $('#dlg-plano').close();
  await abrirPlano(config);
};

document.querySelectorAll('[data-novo]').forEach((b) => { b.onclick = () => abrirEditor(b.dataset.novo); });
$('#btn-ajustes').onclick = () => abrirEditor('ajustes', itens.find((i) => i.tipo === 'ajustes'));
document.querySelectorAll('#cal-modo input').forEach((i) => {
  i.onchange = () => { verSugestao = i.value === 'sug'; render(); };
});
