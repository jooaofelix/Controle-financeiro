// Tela "Planejar": salários, contas fixas, cartões e sugestões de vencimento
import { $, fmt, fmtCurto, esc, api, CATS, cat, corCat, marcaDe, iconeMarca, iconeCategoria, iconeEmoji, mascote, toast } from '/comum.js';
import { planejar, DIAS } from '/planejador.js';
import { cartaoNotificacoes } from '/notificacoes.js';
import { cartaoBancos } from '/bancos.js';
import { situacaoMes } from '/vinculos.js';
import { projetarMes } from '/projecao.js';
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
let lancRecentes = [];
let pagamentos = []; // gastos vinculados a contas previstas
let saldos = [];     // saldo agora em cada conta (banco ou informado)
let projecao = null; // previsão real até o fim do mês // lançamentos deste mês e do anterior (para a fatura atual)

export async function abrirPlano(cfg) {
  config = cfg;
  const ym = hojeLocal().slice(0, 7);
  const [a, mm] = ym.split('-').map(Number);
  const ant = `${mm === 1 ? a - 1 : a}-${String(mm === 1 ? 12 : mm - 1).padStart(2, '0')}`;
  const [dados, log, l1, l2, sal] = await Promise.all([
    api('/api/plano'), api('/api/atalho/log').catch(() => []),
    api('/api/transacoes?mes=' + ym).catch(() => []), api('/api/transacoes?mes=' + ant).catch(() => []),
    api('/api/saldos').catch(() => []),
  ]);
  saldos = sal;
  lancRecentes = [...l1, ...l2];
  itens = dados.itens;
  pagamentos = dados.pagamentos || [];
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
    // mês típico: começa com o valor dos ajustes ou, se não houver, com o que deve sobrar no fim deste mês
    saldoInicial: ajustes.saldoInicial || (projecao ? Math.max(0, projecao.fim) : 0),
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
  const ajustes = itens.find((i) => i.tipo === 'ajustes') || {};
  const gastoVar = ajustes.gastoVariavel ?? gastoEstimado.porMes;
  projecao = saldos.length
    ? projetarMes({ saldoAgora: saldos.reduce((t, x) => t + x.valor, 0), hojeISO: hojeLocal(), itens, pagamentos, gastoVariavelMensal: gastoVar })
    : null;
  const plano = montarPlano();
  resultado = planejar(plano);
  const vazio = !itens.some((i) => i.tipo !== 'ajustes');

  $('#plano-vazio').hidden = !vazio;
  $('#plano-conteudo').hidden = vazio;

  // Hero: com saldo real, mostra a previsão até o fim do mês; sem saldo, o mês típico
  const { resumo } = resultado;
  const alertas = [];
  if (projecao) {
    const p = projecao;
    $('#plano-hero-rotulo').textContent = `Previsão para o fim do mês (dia ${p.diasRestantes + Number(hojeLocal().slice(8, 10)) - 1})`;
    $('#plano-sobra').textContent = fmt(p.fim);
    $('#plano-renda-rot').textContent = 'A receber'; $('#plano-renda').textContent = fmtCurto(p.aReceber);
    $('#plano-fixas-rot').textContent = 'Contas a pagar'; $('#plano-fixas').textContent = fmtCurto(p.aPagar);
    $('#plano-variavel-rot').textContent = `Dia a dia (${p.diasRestantes}d)`; $('#plano-variavel').textContent = fmtCurto(p.diaADia);
    $('#plano-minimo').textContent = `Saldo agora: ${fmt(p.saldoAgora)} · menor até lá: ${fmt(p.min)} no dia ${p.diaMin}`;
    if (p.min < 0) {
      const salario = p.eventos.find((e) => e.tipo === 'renda' && e.dia > p.diaMin);
      alertas.push({ nivel: 'critico', texto: `No dia ${p.diaMin} o saldo das contas pode ficar em ${fmt(p.min)}${salario ? `, antes de cair o ${salario.nome.toLowerCase()} (dia ${salario.dia})` : ''}. Vale segurar gastos ou mudar alguma data.` });
    } else if (p.fim < 0) {
      alertas.push({ nivel: 'critico', texto: `Pelo ritmo atual, o mês fecha em ${fmt(p.fim)}.` });
    }
  } else {
    $('#plano-hero-rotulo').textContent = 'Sobra prevista no mês';
    $('#plano-sobra').textContent = fmt(resumo.sobra);
    $('#plano-renda-rot').textContent = 'Salários'; $('#plano-renda').textContent = fmtCurto(resumo.totalRendas);
    $('#plano-fixas-rot').textContent = 'Contas fixas'; $('#plano-fixas').textContent = fmtCurto(resumo.totalFixas);
    $('#plano-variavel-rot').textContent = 'Dia a dia'; $('#plano-variavel').textContent = fmtCurto(resumo.gastoVariavel);
    const sim = verSugestao ? resultado.final : resultado.base;
    $('#plano-minimo').textContent = `Menor saldo do mês: ${fmt(sim.min)} no dia ${sim.diaMin} · informe o saldo das contas para ver a previsão real`;
    alertas.push(...resultado.alertas);
  }
  // estrutural: renda menor que os gastos previstos (vale nos dois modos)
  if (projecao) alertas.push(...resultado.alertas.filter((a) => /cortar/.test(a.texto)));

  // Alertas
  $('#plano-alertas').innerHTML = alertas
    .map((a) => `<div class="alerta alerta-${a.nivel}">${mascote('preocupado')}<span>${esc(a.texto)}</span></div>`).join('');

  renderSaldos();

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
    .map((c) => linha(c, esc(c.nome), `Vence dia ${c.dia}${c.flexivel ? ' · <span class="tag-flex">pode mudar</span>' : ''}${statusDoMes(c)}`, fmt(c.valor))).join('')
    || '<p class="vazio">Aluguel, luz, água, internet, escola...</p>';
  $('#lista-cartoes').innerHTML = resultado.cartoes.map((c) => {
    const orig = plano.cartoes.find((x) => x.id === c.id);
    const parcelas = parcelasNoCartao(itens.filter((i) => i.tipo === 'divida'), orig.nome, hojeLocal().slice(0, 7));
    const fat = faturaAtual(orig);
    return linha(orig, esc(c.nome),
      `Fecha dia ${orig.fechamento} · vence dia ${orig.vencimento}<br><span class="compra">🛍️ Melhor dia de compra: <b>dia ${(orig.fechamento % DIAS) + 1}</b> (até ${c.prazo} dias para pagar)</span>` +
      (fat.total ? `<br>💳 <b>Fatura atual: ${fmt(fat.total)}</b> <small class="sutil">(${fat.qtd} compras de ${fat.de} a ${fat.ate})</small>` : '') +
      (parcelas ? `<br>🧾 Inclui ${fmt(parcelas)} em parcelas este mês` : '') + (orig.valor ? statusDoMes(orig) : ''),
      c.valor ? fmt(c.valor) : '');
  }).join('') || '<p class="vazio">Cadastre Nubank e Inter para saber o melhor dia de compra.</p>';

  renderDividas();

  const aj = itens.find((i) => i.tipo === 'ajustes');
  const gv = aj?.gastoVariavel ?? null;
  $('#ajuste-saldo').textContent = fmt(aj?.saldoInicial || 0);
  $('#ajuste-variavel').textContent = fmt(gv ?? gastoEstimado.porMes);
  $('#ajuste-variavel-origem').textContent = gv != null
    ? 'definido por vocês'
    : gastoEstimado.dias ? `média dos últimos ${gastoEstimado.dias} dias (sem crédito, que já está na fatura)` : 'sem lançamentos ainda';

  // Marcar/desmarcar como paga (sem abrir o editor da conta)
  document.querySelectorAll('[data-marcar], [data-desmarcar]').forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const id = el.dataset.marcar || el.dataset.desmarcar;
      if (el.dataset.marcar) await api(`/api/plano/${id}/paga`, { method: 'POST', body: JSON.stringify({ mes: el.dataset.mes }) });
      else await api(`/api/plano/${id}/paga?mes=${el.dataset.mes}`, { method: 'DELETE' });
      toast(el.dataset.marcar ? 'recibo' : 'pensando', el.dataset.marcar ? 'Marcada como paga!' : 'Desfeito');
      abrirPlano(config);
    };
  });

  document.querySelectorAll('[data-editar]').forEach((b) => {
    b.onclick = () => { const it = itens.find((i) => i.id === Number(b.dataset.editar)); abrirEditor(it.tipo, it); };
  });
}

// Soma as compras no crédito deste cartão desde o último fechamento da fatura
function faturaAtual(cartao) {
  const hoje = new Date();
  const fech = cartao.fechamento;
  const dia = (ano, mes, d) => new Date(ano, mes, Math.min(d, new Date(ano, mes + 1, 0).getDate()));
  const y = hoje.getFullYear(), m = hoje.getMonth();
  const fechEsteMes = dia(y, m, fech);
  const ini = hoje > fechEsteMes ? new Date(fechEsteMes.getTime() + 86400000) : new Date(dia(y, m - 1, fech).getTime() + 86400000);
  const fim = hoje > fechEsteMes ? dia(y, m + 1, fech) : fechEsteMes;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const de = iso(ini), ate = iso(fim);
  const nome = String(cartao.nome || '').toLowerCase();
  const compras = lancRecentes.filter((t) => t.tipo === 'despesa' && t.meio === 'credito'
    && String(t.conta || '').toLowerCase() === nome && t.data >= de && t.data <= ate);
  const br = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
  return { total: compras.reduce((x, t) => x + t.valor, 0), qtd: compras.length, de: br(de), ate: br(ate) };
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
        <span class="meta multi">${status}<br>${esc(PAGAMENTOS[d.pagamento] || '')} · dia ${d.dia}${d.pagamento === 'boleto' && s.ativaNoMes ? statusDoMes(d) : ''}</span>
        <span class="progresso"><i style="width:${Math.round(s.progresso * 100)}%"></i></span>
      </span>
      <span class="valor">${fmt(d.valor)}<small>${s.quitada ? 'por mês' : `falta ${fmtCurto(s.valorRestante)}`}</small></span>
    </button>`;
  }).join('') || '<p class="vazio">Financiamentos, empréstimos, compras parceladas no carnê ou no cartão...</p>';
}

// Situação da conta neste mês: ✅ paga / ⏳ pendente / ⚠️ atrasada
function statusDoMes(item) {
  const hoje = hojeLocal();
  const [s] = situacaoMes([item], pagamentos, hoje.slice(0, 7), hoje);
  if (!s) return '';
  const br = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const mes = hoje.slice(0, 7);
  if (s.estado === 'paga') {
    const p = s.pagamentos[0];
    const manual = s.pagamentos.every((x) => x.marcada && x.origem === 'manual');
    return manual
      ? `<br><span class="btn-check on" data-desmarcar="${item.id}" data-mes="${mes}">✓ Paga · desfazer</span>`
      : `<br><span class="status-conta paga">✅ Paga em ${br(p.data)} · ${fmt(s.pago)}</span>`;
  }
  const marcar = ` <span class="btn-check" data-marcar="${item.id}" data-mes="${mes}">○ marcar como paga</span>`;
  if (s.estado === 'atrasada') return '<br><span class="status-conta atrasada">⚠️ Venceu sem pagamento vinculado</span>' + marcar;
  return `<br><span class="status-conta pendente">⏳ ${s.diasPara === 0 ? 'Vence hoje' : `Vence em ${s.diasPara} ${s.diasPara === 1 ? 'dia' : 'dias'}`}</span>` + marcar;
}

// Cartão "Saldo agora": banco (automático) + informado à mão; pessoas sem saldo podem informar
function renderSaldos() {
  const el = $('#saldos-lista');
  const total = saldos.reduce((t, x) => t + x.valor, 0);
  $('#saldos-total').textContent = saldos.length ? fmt(total) : '';
  const br = (iso) => iso ? new Date(iso.length > 10 ? iso : iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
  const linhas = saldos.map((x) => `
    <div class="saldo-linha">
      <span class="avatar-mini">${esc(x.pessoa.charAt(0))}</span>
      <span class="saldo-txt"><b>${esc(x.pessoa)} · ${esc(x.conta)}</b>
        <small>${x.origem === 'banco' ? `🏦 do banco · ${br(x.atualizado)}` : `✏️ informado em ${br(x.atualizado)} · <span class="link-acao" data-saldo-editar="${x.id}">atualizar</span>`}</small></span>
      <b class="${x.valor < 0 ? 'negativo' : ''}">${fmt(x.valor)}</b>
    </div>`).join('');
  const semSaldo = config.pessoas.filter((p) => !saldos.some((x) => x.pessoa === p));
  const informar = semSaldo.map((p) => `<button class="btn-sec btn-largo" data-saldo-novo="${esc(p)}">✏️ Informar saldo de ${esc(p)}</button>`).join('');
  el.innerHTML = (linhas || '<p class="vazio">Conecte os bancos (🏦 Bancos, mais abaixo) ou informe o saldo de cada um para ver a previsão real do mês.</p>') +
    informar + (saldos.length ? '<p class="dica">O saldo do banco chega com o atraso do Open Finance. Para corrigir na hora, use “atualizar”.</p>' : '');
  el.querySelectorAll('[data-saldo-novo]').forEach((b) => { b.onclick = () => abrirEditor('saldo', { pessoa: b.dataset.saldoNovo, conta: '' }); });
  el.querySelectorAll('[data-saldo-editar]').forEach((b) => {
    b.onclick = () => { const it = itens.find((i) => i.id === Number(b.dataset.saldoEditar)); abrirEditor('saldo', it); };
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
  saldo: (i) => `
    <h3>💰 Saldo na conta</h3>
    <label class="campo"><span>De quem</span>
      <select name="pessoa">${config.pessoas.map((p) => `<option ${i?.pessoa === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <label class="campo"><span>Conta</span><input name="conta" placeholder="Ex.: Nubank" value="${esc(i?.conta || '')}" autocomplete="off"></label>
    <label class="campo"><span>Quanto tem na conta agora</span><input name="valor" inputmode="decimal" placeholder="0,00" value="${i?.valor != null && i?.id ? centavosTxt(i.valor) : ''}" required></label>
    <p class="dica">Só o dinheiro disponível na conta (sem cartão de crédito). Use “-” na frente se estiver negativo. Quando o banco desta conta estiver conectado, o saldo do banco passa a valer.</p>`,
  ajustes: (i) => `
    <h3>⚙️ Ajustes</h3>
    <label class="campo"><span>Quanto costuma ter na conta no dia 1</span><input name="saldoInicial" inputmode="decimal" placeholder="0,00" value="${i?.saldoInicial ? centavosTxt(i.saldoInicial) : ''}"></label>
    <label class="campo"><span>Gasto do dia a dia por mês</span><input name="gastoVariavel" inputmode="decimal" placeholder="Automático: ${centavosTxt(gastoEstimado.porMes)}" value="${i?.gastoVariavel != null ? centavosTxt(i.gastoVariavel) : ''}"></label>
    <p class="dica">Mercado, iFood, Uber, Pix do dia a dia... Deixe em branco para usar a média dos últimos 60 dias. Não entram compras no crédito (já estão na fatura), contas fixas, assinaturas e transferências.</p>`,
};

function centavosTxt(c) { return (c / 100).toFixed(2).replace('.', ','); }

function abrirEditor(tipo, item = null) {
  editando = { tipo, item };
  $('#plano-campos').innerHTML = CAMPOS[tipo](item);
  $('#plano-excluir').hidden = !item?.id || tipo === 'ajustes';
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
