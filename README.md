# Controle Financeiro da Casa

App simples para o casal registrar e acompanhar os gastos da casa.

## Objetivos

- Registrar gastos e receitas (manual e automático)
- Saber **quem** gastou, em **quê** (categoria) e **de onde** saiu (conta/cartão)
- Ver resumo do mês: total por categoria, por pessoa, orçamento x realizado
- Funcionar no celular dos dois (PWA — "instalar na tela inicial")

## Formas de entrada de dados

| Fonte | Como | Prioridade |
|---|---|---|
| Lançamento manual | Formulário rápido no app | MVP |
| Extrato OFX/CSV | Upload do arquivo exportado pelo banco | MVP |
| Notificação do banco | Celular encaminha a notificação para um webhook do app | Fase 2 |
| Open Finance | Agregador (ex.: Pluggy) puxa transações automaticamente | Fase 3 |

Detalhes em [`docs/integracoes-bancarias.md`](docs/integracoes-bancarias.md).

## Stack proposta (a confirmar)

- **Backend:** Cloudflare Workers (API + endpoint de webhook) — plano grátis basta
- **Banco de dados:** Cloudflare D1 (SQLite)
- **Frontend:** PWA (React + Vite) servido pelo próprio Worker
- **Login:** só os dois usuários (Cloudflare Access ou senha simples)

## Roadmap

- [ ] Modelo de dados: pessoas, contas/cartões, categorias, transações, orçamentos
- [ ] CRUD de transações + categorias
- [ ] Dashboard mensal
- [ ] Importação OFX/CSV
- [ ] Webhook de notificações + parser por banco
- [ ] Integração Open Finance
