// Tela "Planejar": salários, contas fixas, cartões e sugestões de vencimento
import { $, fmt, fmtCurto, esc, api, CATS, cat, corCat, marcaDe, iconeMarca, iconeCategoria, iconeEmoji, mascote, toast } from '/comum.js';
import { planejar, DIAS } from '/planejador.js';
import { cartaoNotificacoes } from '/notificacoes.js';
import { cartaoBancos } from '/bancos.js';
import { situacao, resumoDividas, contasDoMes, parcelasNoCartao, inicioDe, parcelaDoMes, mesAno } from '/dividas.js';

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PAGAMENTOS = { boleto: 'Boleto / débito em conta', Nubank: 'Cartão Nubank', Inter: 'Cartão Inter' };

let config = null;
let itens = [];
let gastoEstimado = { porMes: 0, meses: 0 };
let resultado = null;
let verSugestao = true;
let diaSelecionado = null;
let editando = null; // { tipo, item? }

export async function abrirPlano(cfg) {
  config = cfg;
  const [dados, log] = await Promise.all([api('/api/plano'), api('/api/atalho/log').catch(() => [])]);
  itens = dados.itens;
  gastoEstimado = dados.gastoVariavel;
  render();
  renderDiario(log);
  cartaoNotificacoes(config);
  cartaoBancos(config);
}

// Diário do Atalho: mostra o que o iPhone mandou e se deu certo (ajuda a achar falhas)
function renderDiario(log) {
  const el = $('#atalho-log');
  if (!log.length) {
    el.innerHTML = '<p class="vazio">Nenhuma compra chegou do iPhone ainda. Se a automação mostrou erro e nada aparece aqui, o problema está no próprio Atalho (antes de chegar ao app).</p>';
    return;
  }
  el.innerHTML = log.map((l) => {
    const quando = new Date(l.quando.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<details class="diario ${l.ok ? 'ok' : 'erro'}">
      <summary><span>${l.ok ? '✅' : '⚠️'}</span><span class="d-txt">${esc(l.resposta.split('\n')[0].replace(/^(⚠️ pagaAI não anotou: |✅ |📝 )/u, ''))}</span><small>${quando}</small></summary>
      <code>${esc(l.corpo)}</code>
    </details>`;
  }).join('');
}

function montarPlano() {
  const ajustes = itens.find((i) => i.tipo === 'ajustes') || {};
  const dividas = itens.filter((i) => i.tipo === 'divida');
  return {
    rendas: itens.filter((i) => i.tipo === 'renda'),
    // parcelas de boleto deste mês entram como contas fixas (não dá para mudar a data)
    contas: [...itens.filter((i) => i.tipo === 'conta'), ...contasDoMes(dividas, hojeLocal().slice(0, 7))],
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
  const vazio = !itens.some((i) => i.tipo !== 'ajustes');

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
    .filter((c) => !c.divida)
    .sort((a, b) => a.dia - b.dia)
    .map((c) => linha(c, esc(c.nome), `Vence dia ${c.dia}${c.flexivel ? ' · <span class="tag-flex">pode mudar</span>' : ''}`, fmt(c.valor))).join('')
    || '<p class="vazio">Aluguel, luz, água, internet, escola...</p>';
  $('#lista-cartoes').innerHTML = resultado.cartoes.map((c) => {
    const orig = plano.cartoes.find((x) => x.id === c.id);
    const parcelas = parcelasNoCartao(itens.filter((i) => i.tipo === 'divida'), orig.nome, hojeLocal().slice(0, 7));
    return linha(orig, esc(c.nome),
      `Fecha dia ${orig.fechamento} · vence dia ${orig.vencimento}<br><span class="compra">🛍️ Melhor dia de compra: <b>dia ${(orig.fechamento % DIAS) + 1}</b> (até ${c.prazo} dias para pagar)</span>` +
      (parcelas ? `<br>🧾 Inclui ${fmt(parcelas)} em parcelas este mês` : ''),
      c.valor ? fmt(c.valor) : '');
  }).join('') || '<p class="vazio">Cadastre Nubank e Inter para saber o melhor dia de compra.</p>';

  renderDividas();

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

function renderDividas() {
  const dividas = itens.filter((i) => i.tipo === 'divida');
  const hoje = hojeLocal();
  const r = resumoDividas(dividas, hoje);
  const resumo = $('#resumo-dividas');
  resumo.hidden = !dividas.length;
  if (dividas.length) {
    resumo.innerHTML = `
      <div class="div-numeros">
        <div><span class="rotulo">Falta pagar</span><b>${fmt(r.totalRestante)}</b></div>
        <div><span class="rotulo">Parcelas este mês</span><b>${fmt(r.porMes)}</b></div>
      </div>
      ${r.proxima ? `<div class="div-proxima">${mascote('comemora')}<p>A próxima a acabar é <b>${esc(r.proxima.nome)}</b>, em <b>${mesAno(r.proxima.sit.fim)}</b>. Depois disso sobram <b class="positivo">${fmt(r.proxima.valor)}</b> a mais por mês.</p></div>` : ''}
      <div class="div-meses" role="img" aria-label="Parcelas nos próximos meses">
        ${r.proximosMeses.map((m) => {
          const max = Math.max(...r.proximosMeses.map((x) => x.total), 1);
          return `<div><span class="mes-valor">${m.total ? fmtCurto(m.total) : '—'}</span><i style="height:${Math.max(4, (m.total / max) * 56)}px"></i><small>${mesAno(m.mes).split('/')[0]}</small></div>`;
        }).join('')}
      </div>`;
  }
  const ordenadas = r.itens.sort((a, b) => (a.sit.quitada - b.sit.quitada) || a.sit.fim.localeCompare(b.sit.fim));
  $('#lista-dividas').innerHTML = ordenadas.map((d) => {
    const s = d.sit;
    const status = s.quitada
      ? '<span class="tag-quitada">Quitada 🎉</span>'
      : s.pagas === 0 && s.parcelaDoMes < 1
        ? `Começa em ${mesAno(d.inicio)}`
        : `${s.pagas} de ${d.total} pagas · termina em ${mesAno(s.fim)}`;
    return `<button class="item divida ${s.quitada ? 'quitada' : ''}" data-editar="${d.id}">
      ${iconeItem(d)}
      <span class="meio">
        <span class="desc">${esc(d.nome)}</span>
        <span class="meta multi">${status}<br>${esc(PAGAMENTOS[d.pagamento] || '')} · dia ${d.dia}</span>
        <span class="progresso"><i style="width:${Math.round(s.progresso * 100)}%"></i></span>
      </span>
      <span class="valor">${fmt(d.valor)}<small>${s.quitada ? 'por mês' : `falta ${fmtCurto(s.valorRestante)}`}</small></span>
    </button>`;
  }).join('') || '<p class="vazio">Financiamentos, empréstimos, compras parceladas no carnê ou no cartão...</p>';
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
  divida: (i) => {
    const atual = i ? Math.min(Math.max(parcelaDoMes(i, hojeLocal().slice(0, 7)), 1), i.total) : 1;
    return `
    <h3>🧾 Dívida parcelada</h3>
    <label class="campo"><span>Nome</span><input name="nome" placeholder="Ex.: Geladeira, Empréstimo, Celular" value="${esc(i?.nome || '')}" required autocomplete="off"></label>
    <label class="campo"><span>Valor da parcela</span><input name="valor" inputmode="decimal" placeholder="0,00" value="${i ? centavosTxt(i.valor) : ''}" required></label>
    <div class="campo-duplo">
      <label class="campo"><span>Parcela deste mês</span><input name="parcelaAtual" type="number" min="1" max="240" inputmode="numeric" value="${atual}" required></label>
      <span class="de">de</span>
      <label class="campo"><span>Total de parcelas</span><input name="total" type="number" min="1" max="240" inputmode="numeric" value="${i?.total ?? 12}" required></label>
    </div>
    <p class="dica">Ex.: se este mês você paga a 4ª de 12, coloque 4 de 12. O app conta sozinho nos próximos meses.</p>
    <label class="campo"><span>Dia do vencimento</span><input name="dia" type="number" min="1" max="31" inputmode="numeric" value="${i?.dia ?? 10}" required></label>
    <label class="campo"><span>Como paga</span>
      <select name="pagamento">${Object.entries(PAGAMENTOS).map(([v, t]) => `<option value="${v}" ${(i?.pagamento || 'boleto') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <p class="dica">No cartão, a parcela já está dentro da fatura: o app só acompanha quanto falta. No boleto, ela entra no calendário do planejador.</p>
    <label class="campo"><span>Categoria</span>
      <select name="categoria">${Object.keys(CATS).filter((c) => !['A classificar', 'Salário'].includes(c))
        .map((c) => `<option value="${esc(c)}" ${(i?.categoria || 'Compras') === c ? 'selected' : ''}>${cat(c).e} ${esc(c)}</option>`).join('')}</select></label>`;
  },
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
  if (editando.tipo === 'divida') {
    const atual = parseInt(dados.parcelaAtual, 10) || 1;
    const total = parseInt(dados.total, 10) || 1;
    if (atual > total) { $('#plano-erro').textContent = 'A parcela deste mês não pode ser maior que o total.'; $('#plano-erro').hidden = false; return; }
    dados.inicio = inicioDe(atual, hojeLocal());
    delete dados.parcelaAtual;
  }
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
