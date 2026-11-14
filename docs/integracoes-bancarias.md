# Integrações bancárias — opções

## 1. Open Finance Brasil (via agregador)
Pessoa física não acessa as APIs do Open Finance diretamente — só instituições
autorizadas pelo Banco Central. O caminho é um **agregador**:

- **Pluggy** — agregador brasileiro. Oferece o *Meu Pluggy*, que permite conectar
  as próprias contas para uso pessoal/desenvolvimento. Retorna contas, saldos,
  transações e faturas de cartão já categorizadas.
- **Belvo** — alternativa, mais focada em empresas.

Prós: automático, dados estruturados. Contras: depende de terceiro, consentimento
expira (renovar periodicamente), verificar preço/limites atuais.

## 2. Leitura de notificações do celular
- **Android:** apps de automação (MacroDroid, Tasker) ou um app próprio com
  `NotificationListenerService` capturam a push do banco
  ("Compra aprovada R$ 52,90 em PADARIA X") e fazem POST para o webhook.
- **iPhone:** o iOS não deixa ler notificações de outros apps. Opção: app
  **Atalhos** → Automação → gatilho **"Transação"** (cartões no Apple Pay/Wallet)
  → enviar para o webhook.

Prós: tempo real, grátis. Contras: precisa de um parser por banco; Pix e
débito automático nem sempre geram notificação.

## 3. Importação de extrato (OFX/CSV)
Quase todo banco exporta OFX ou CSV (Nubank, Inter, Itaú, BB…). Manual, mas
confiável e sem depender de ninguém. Bom para conciliar o mês.

## 4. E-mail de compra
Alguns bancos enviam e-mail a cada compra; dá para encaminhar para um endereço
que o app processa (ex.: Cloudflare Email Workers).
