# Lançar gastos automaticamente pelo iPhone (app Atalhos)

Toda compra feita com **Apple Pay** (cartão Nubank ou Inter cadastrado na
Carteira) dispara esta automação, que envia o gasto para o app sozinha.

> Pix, boleto e compras com o cartão físico/digitado **não** disparam a
> automação — esses você lança pelo botão **+** do app.

Faça isto **no iPhone de cada um** (muda só o nome em `pessoa`).

## Passo a passo

1. Abra o app **Atalhos** → aba **Automação** → **+** (Nova Automação).
2. Escolha o gatilho **Transação**.
3. Em **Cartão**, marque os cartões **Nubank** e **Inter**. Deixe as categorias
   todas marcadas.
4. Marque **Executar Imediatamente** (para não pedir confirmação) → **Seguinte**.
5. Escolha **Nova Automação em Branco** e adicione a ação
   **Obter Conteúdo da URL**.
6. Configure a ação (toque na setinha `>` para expandir):
   - **URL:** `https://SEU-ENDERECO/api/atalho`
   - **Método:** `POST`
   - **Cabeçalhos:** adicione
     - Chave `Authorization` → Valor `Bearer SUA_SENHA`
   - **Corpo da Solicitação:** `JSON`, com 4 campos do tipo **Texto**:

     | Chave | Valor |
     |---|---|
     | `valor` | variável **Quantia** (Amount) da Entrada do Atalho |
     | `estabelecimento` | variável **Comerciante** (Merchant) |
     | `cartao` | variável **Cartão ou Passe** (Card or Pass) |
     | `pessoa` | digite o seu nome, igual aparece no app (ex.: `Esposa`) |

7. **Notificação de confirmação** (recomendado): adicione a ação **Mostrar Notificação**
   e, no texto, escolha a variável **Conteúdo do URL**. O app já responde com a frase pronta:
   > ✅ Anotado: R$ 45,90 em iFood (Alimentação)
   > Gastos de novembro: R$ 2.978,70

   Se algo der errado, a notificação mostra o motivo (ex.: `⚠️ pagaAI não anotou: Senha inválida`).
8. Toque em **OK**. Pronto.

## Testar
Faça uma compra pequena com Apple Pay (ou rode a automação manualmente) e abra o
app: o gasto aparece em "Hoje", já com categoria quando o nome da loja é
conhecido — senão aparece como **A classificar** para vocês escolherem.

## O que o app faz com os dados
- Converte o valor (aceita `R$ 52,90`, `52,90` ou `52.9`).
- Identifica a conta pelo nome do cartão (Nubank / Inter).
- Sugere a categoria pelo nome da loja (iFood → Alimentação, Shell → Transporte…).
  As regras ficam em `src/index.js` (`REGRAS_CATEGORIA`).
