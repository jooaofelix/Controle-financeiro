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
- **Planejador de contas:** aba *Planejar* — cadastre salários, contas fixas e cartões; o app simula o saldo dia a dia e sugere os melhores vencimentos e o melhor dia de compra em cada cartão.
- **Custo zero:** roda no plano gratuito da Cloudflare (Worker + Durable Object com SQLite).

Outras opções de integração (Open Finance/Pluggy, extrato OFX):
[`docs/integracoes-bancarias.md`](docs/integracoes-bancarias.md).

## Estrutura

```
src/index.js            API (login, lançamentos, Atalho do iPhone, planejador) + banco SQLite
src/valores.js          Conversão de valores em reais
public/                 App (HTML/CSS/JS puro, sem build)
public/planejador.js    Cálculo do planejador (simulação do saldo + sugestões)
public/plano.js         Tela "Planejar"
public/marcas.js        Logos das marcas (gerado por scripts/gerar-marcas.mjs)
scripts/                Testes e geração de logos
wrangler.toml           Configuração da Cloudflare (nomes das pessoas em PESSOAS)
```

## Rodar no computador

```bash
npm install
echo "SENHA=teste123" > .dev.vars
npm run dev            # abre em http://localhost:8787
npm test               # testes do planejador
```

## Publicar (grátis)

No ar em: https://controle-financeiro.desatasistemas.workers.dev

```bash
npx wrangler login
npm run deploy
npx wrangler secret put SENHA        # a senha que vocês dois vão usar
```

## Próximos passos

- [ ] Orçamento por categoria (limite mensal)
- [ ] Importar extrato OFX/CSV (Nubank e Inter) para pegar Pix e boletos
- [ ] Integração Open Finance via Meu Pluggy
- [ ] Assistente com IA (Workers AI) para perguntas sobre os gastos
