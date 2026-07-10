## Objetivo
Adicionar aba **Cartão** ao `FounderPixCheckoutDialog`, ao lado do Pix, para o cliente pagar com cartão de crédito **sem sair da página** (checkout transparente Mercado Pago) e ter a **recorrência automática** ativada.

## Como vai funcionar
1. Diálogo passa a ter 2 abas: **Pix** (fluxo atual, intacto) e **Cartão**.
2. Aba Cartão renderiza o **Card Payment Brick** do Mercado Pago (SDK v2). Formulário oficial, tokeniza os dados do cartão no navegador — nenhum dado sensível toca nosso backend.
3. Ao submeter, o brick devolve um `card_token_id`. Enviamos ao backend, que:
   - **Cobra a entrada** (ex.: R$ 250) via `POST /v1/payments` usando o `card_token_id`.
   - **Cria a assinatura recorrente** via `POST /preapproval` com `status: authorized`, `card_token_id` associado ao pagador, `transaction_amount` = valor recorrente (R$ 389 padrão) e `start_date` = agora + `entry_cycles`.
   - Se `entry_amount == recurring_amount` e `entry_cycles == 1`, cria só a preapproval que já cobra imediatamente (fluxo simplificado).
4. Backend grava o resultado nas mesmas tabelas usadas pelo Pix (`founder_slots` para slot + `subscriptions` para recorrência), então o restante do sistema (webhooks, dashboards) não muda.

## Novidades técnicas

**Chave pública Mercado Pago**
- Card Brick precisa da `public_key` da conta MP.
- Já existe coluna `payment_provider_config.public_key`, mas está vazia.
- Novo endpoint público `mp-public-key` lê essa coluna. Se estiver vazia, retorno instrui você a preenchê-la em Admin → Configurações → Provedor de Pagamento (vou adicionar o campo lá também).

**Novos edge functions**
- `mp-public-key` — GET, sem auth, devolve `{ public_key }`.
- `mp-card-subscribe` — POST auth. Body: `{ tenant_id, offer_id?, payer, card_token_id, installments }`. Cobra entrada + cria preapproval. Retorna `{ ok, payment_id, preapproval_id, status }`.

**Frontend**
- `src/lib/mercadopago.ts` — loader idempotente do SDK v2 (`https://sdk.mercadopago.com/js/v2`).
- `FounderPixCheckoutDialog.tsx` — envolve o conteúdo em `Tabs` (Pix / Cartão). Componente novo `MpCardBrickForm` monta/desmonta o brick, controla loading e chama `mp-card-subscribe`. Sucesso → mesma tela de "Pagamento confirmado".
- `TenantPaymentProviderCard` (admin) — adicionar input **Chave pública Mercado Pago** e salvar em `payment_provider_config.public_key`.

## Fora de escopo (desta entrega)
- `TenantOfferDialog` e `TenantPlans` continuam só com Pix. Uma vez validado o fluxo aqui, replicar é trivial.
- Parcelamento sem juros: por ora fixo em 1x. Vem em ajuste futuro se quiser.

## Riscos
- `public_key` precisa ser preenchida antes de o cliente conseguir usar cartão. Sem ela, aba Cartão mostra alerta amigável em vez de quebrar.
- Assinaturas com `card_token_id` só funcionam com conta MP ativada para cobrança recorrente com cartão (padrão em contas Brasil). Se a conta específica não permitir, MP retorna erro claro que propago para o usuário.