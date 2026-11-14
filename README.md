# Controle Financeiro da Casa

App simples para o casal registrar e acompanhar os gastos da casa.

## Objetivos

- Registrar gastos e receitas (manual e automático)
- Saber **quem** gastou, em **quê** (categoria) e **de onde** saiu (conta/cartão)
- Ver resumo do mês: total por categoria, por pessoa, orçamento x realizado
- Funcionar no celular dos dois (PWA — "instalar na tela inicial")

## Como funciona

- **App no celular:** página instalável na tela inicial do iPhone (Safari →
  Compartilhar → *Adicionar à Tela de Início*). Mostra gastos do mês, por
  categoria e por pessoa, e tem o botão **+** para lançar à mão.
- **Automático pelo iPhone:** compras com Apple Pay (Nubank e Inter) são
  enviadas pelo app **Atalhos** → ver [`docs/atalho-iphone.md`](docs/atalho-iphone.md).
- **Custo zero:** roda no plano gratuito da Cloudflare (Workers + banco D1).

Outras opções de integração (Open Finance/Pluggy, extrato OFX):
[`docs/integracoes-bancarias.md`](docs/integracoes-bancarias.md).

## Estrutura

```
src/index.js     API (login, lançamentos, endpoint do Atalho)
public/          App (HTML/CSS/JS puro, sem build)
schema.sql       Tabela do banco
wrangler.toml    Configuração da Cloudflare (nomes das pessoas em PESSOAS)
```

## Rodar no computador

```bash
npm install
echo "SENHA=teste123" > .dev.vars
npm run db:local
npm run dev            # abre em http://localhost:8787
```

## Publicar (grátis)

```bash
npx wrangler login
npx wrangler d1 create financas      # copie o database_id para o wrangler.toml
npm run db:remote
npx wrangler secret put SENHA        # a senha que vocês dois vão usar
npm run deploy
```

## Próximos passos

- [ ] Orçamento por categoria (limite mensal)
- [ ] Importar extrato OFX/CSV (Nubank e Inter) para pegar Pix e boletos
- [ ] Integração Open Finance via Meu Pluggy
