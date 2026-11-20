// Testes da integração Meu Pluggy: node scripts/testar-pluggy.mjs
import assert from 'node:assert/strict';
import { classificar, acharDuplicado, situacaoItem, nomeDaConta, categoriaDoPluggy } from '../src/pluggy.js';

let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log('✓', nome); };
const corrente = { type: 'BANK', subtype: 'CHECKING_ACCOUNT', bankData: { transferNumber: '260/0001/1234-5' } };
const cartao = { type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Nubank Mastercard' };
const tx = (o) => ({ id: 'x', date: '2026-11-18T12:00:00.000Z', status: 'POSTED', category: '', ...o });

teste('Pix recebido na conta corrente vira ENTRADA', () => {
  const r = classificar(tx({ amount: 200, description: 'Transferência recebida pelo Pix - MARIA' }), corrente);
  assert.equal(r.importar, true);
  assert.equal(r.tipo, 'receita');
  assert.equal(r.valor, 20000);
  assert.equal(r.data, '2026-11-18');
});

teste('Pix enviado / compra no débito vira SAÍDA', () => {
  const r = classificar(tx({ amount: -45.9, description: 'Compra no débito - IFOOD', category: 'Food delivery' }), corrente);
  assert.equal(r.tipo, 'despesa');
  assert.equal(r.valor, 4590);
  assert.equal(categoriaDoPluggy(r.categoriaPluggy), 'Alimentação');
});

teste('compra no cartão (valor positivo) vira SAÍDA', () => {
  const r = classificar(tx({ amount: 159.9, description: 'AMAZON MARKETPLACE', category: 'Online shopping' }), cartao);
  assert.equal(r.tipo, 'despesa');
  assert.equal(categoriaDoPluggy(r.categoriaPluggy), 'Compras');
});

teste('pagamento/estorno no cartão (negativo) é ignorado', () => {
  assert.equal(classificar(tx({ amount: -2500, description: 'Pagamento recebido' }), cartao).importar, false);
  assert.equal(classificar(tx({ amount: -30, description: 'Estorno UBER' }), cartao).importar, false);
});

teste('pagamento da fatura na conta corrente é ignorado (não conta em dobro)', () => {
  assert.equal(classificar(tx({ amount: -2500, description: 'Pagamento de fatura', category: 'Credit card payment' }), corrente).importar, false);
  assert.equal(classificar(tx({ amount: -2500, description: 'PAGAMENTO DE FATURA NUBANK' }), corrente).importar, false);
});

teste('caixinha, aplicação e transferência entre contas próprias são ignoradas', () => {
  assert.equal(classificar(tx({ amount: -500, description: 'Aplicação RDB' }), corrente).importar, false);
  assert.equal(classificar(tx({ amount: 500, description: 'Resgate Caixinha' }), corrente).importar, false);
  assert.equal(classificar(tx({ amount: -800, description: 'Pix enviado', category: 'Same person transfer - PIX' }), corrente).importar, false);
});

teste('transação pendente espera o banco confirmar', () => {
  assert.equal(classificar(tx({ amount: -10, status: 'PENDING' }), corrente).importar, false);
});

teste('nome da conta pelo código do banco (COMPE) ou pelo apelido', () => {
  assert.equal(nomeDaConta(corrente), 'Nubank');
  assert.equal(nomeDaConta({ bankData: { transferNumber: '077/0001/99' } }), 'Inter');
  assert.equal(nomeDaConta(cartao), 'Nubank');
  assert.equal(nomeDaConta({ name: 'Conta' }, 'Itaú'), 'Itaú');
});

teste('compra que já veio pelo Apple Pay é reconhecida (não duplica)', () => {
  const existentes = [
    { id: 1, tipo: 'despesa', valor: 4590, data: '2026-11-16', conta: 'Nubank', externo_id: null },
    { id: 2, tipo: 'despesa', valor: 4590, data: '2026-11-01', conta: 'Nubank', externo_id: null }, // longe demais
  ];
  const d = acharDuplicado({ tipo: 'despesa', valor: 4590, data: '2026-11-18', conta: 'Nubank' }, existentes);
  assert.equal(d.id, 1);
});

teste('não casa com conta diferente, tipo diferente ou já ligado ao banco', () => {
  const nova = { tipo: 'despesa', valor: 1000, data: '2026-11-18', conta: 'Nubank' };
  assert.equal(acharDuplicado(nova, [{ tipo: 'despesa', valor: 1000, data: '2026-11-18', conta: 'Inter' }]), null);
  assert.equal(acharDuplicado(nova, [{ tipo: 'receita', valor: 1000, data: '2026-11-18', conta: 'Nubank' }]), null);
  assert.equal(acharDuplicado(nova, [{ tipo: 'despesa', valor: 1000, data: '2026-11-18', conta: 'Nubank', externo_id: 'abc' }]), null);
  // lançamento manual sem conta casa pelo valor e data
  assert.ok(acharDuplicado(nova, [{ tipo: 'despesa', valor: 1000, data: '2026-11-17', conta: '' }]));
});

teste('situação da conexão: ok, vencendo e com erro', () => {
  assert.equal(situacaoItem({ status: 'UPDATED' }, '2026-11-20').nivel, 'ok');
  const v = situacaoItem({ status: 'UPDATED', consentExpiresAt: '2026-11-25T00:00:00Z' }, '2026-11-20');
  assert.equal(v.nivel, 'aviso');
  assert.equal(v.diasParaVencer, 5);
  assert.equal(situacaoItem({ status: 'LOGIN_ERROR' }, '2026-11-20').nivel, 'erro');
  assert.equal(situacaoItem({ status: 'OUTDATED' }, '2026-11-20').nivel, 'erro');
});

console.log(`\n${ok} testes do Meu Pluggy passaram`);
