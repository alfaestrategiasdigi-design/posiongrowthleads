
# Migração de Pagamentos: Stripe → Mercado Pago

Substituir totalmente o Stripe pelo Mercado Pago. Credenciais (Access Token + Public Key de produção) cadastradas dentro do **Admin Master → Planos e Cobranças**. O próprio sistema cria a assinatura (preapproval) e devolve o link de checkout do MP para o cliente pagar.

## 1. Credenciais (no Admin Master)

Nova aba **"Mercado Pago"** dentro de `/admin/planos` (SubscriptionsPage.tsx) com formulário para:
- `MP_ACCESS_TOKEN` (APP_USR-...) — secreto, salvo via `add_secret`
- `MP_PUBLIC_KEY` (APP_USR-...) — salvo na tabela `payment_provider_config`
- `MP_WEBHOOK_SECRET` — gerado automaticamente (`generate_secret`)
- Botão "Testar conexão" → chama `/users/me` no MP para validar
- URL do webhook exibida para o usuário colar no painel do Mercado Pago

Tabela nova `payment_provider_config` (singleton, somente admin):
- provider = 'mercadopago'
- public_key, account_email, account_id, last_validated_at, webhook_url

## 2. Catálogo de planos

Reaproveitar `plan_catalog` existente, trocando colunas Stripe por MP:
- adicionar `mp_preapproval_plan_id` (id do plano recorrente no MP)
- adicionar `mp_reason` (descrição enviada na preapproval)
- limpar `stripe_price_id` / `stripe_product_id` (manter colunas mas não usar)

Edge function `mp-ensure-plan` cria/atualiza o **Preapproval Plan** no MP via `POST /preapproval_plan` para cada linha do catálogo (mensal e trimestral, BRL). IDs ficam cacheados.

## 3. Checkout (gerado pelo sistema)

Nova edge function `mp-subscription-checkout` (substitui `subscription-checkout`):
- Recebe `tenant_id` + `lookup_key`
- Garante plano no MP (chama `mp-ensure-plan` se faltar id)
- Cria **Preapproval** (`POST /preapproval`) com:
  - `preapproval_plan_id`
  - `payer_email` (do tenant)
  - `back_url` = `/app/:slug/planos?mp=success`
  - `external_reference` = `tenant_id:plan_code:interval`
- Retorna `init_point` → frontend abre em nova aba (`window.open`)

`TenantPlans.tsx` deixa de usar `EmbeddedCheckoutProvider`/Stripe e passa a chamar essa função e redirecionar para o `init_point`.

## 4. Webhook MP

Nova edge function `mp-webhook` (verify_jwt = false em `config.toml`):
- Recebe notificações `preapproval`, `subscription_preapproval`, `payment`
- Valida assinatura `x-signature` (HMAC com `MP_WEBHOOK_SECRET`)
- Busca recurso no MP via Access Token e:
  - upsert em `subscriptions` (status: authorized → active, paused, cancelled)
  - upsert em `subscription_invoices` para cada `payment` (status, valor, data, link do recibo)

Schema:
- `subscriptions`: adicionar colunas `mp_preapproval_id`, `mp_payer_email`, `provider` (default 'mercadopago'); manter `status`, `current_period_*`, `amount_cents`.
- `subscription_invoices`: adicionar `mp_payment_id`, `receipt_url`.

## 5. Remoção do Stripe

Apagar:
- `supabase/functions/_shared/stripe.ts`
- `supabase/functions/payments-webhook/`
- `supabase/functions/subscription-checkout/`
- `supabase/functions/subscription-change-plan/`
- `src/lib/stripe.ts`
- `src/components/PaymentTestModeBanner.tsx`
- Card "Stripe — Embedded Checkout" em `TenantConfig.tsx`
- Coluna `tenants.stripe_publishable_key`
- Bloco `[functions.payments-webhook]` em `config.toml` (substituído por `[functions.mp-webhook]`)
- Dependência `@stripe/stripe-js` (`bun remove`)

## 6. UI Admin Master — Planos e Cobranças

`SubscriptionsPage.tsx` em tabs:
1. **Assinaturas ativas** — lista por tenant (status, plano, próximo pagamento, MRR)
2. **Faturas** — histórico de `subscription_invoices` com link do MP
3. **Mercado Pago** — credenciais + status + URL do webhook + botão "Sincronizar planos no MP"

## 7. UI Cliente

`TenantPlans.tsx`:
- Catálogo Starter/Pro/Scale (mensal/trimestral) — igual hoje
- Botão "Assinar" → chama `mp-subscription-checkout` → abre `init_point` em nova aba
- Banner com status atual da assinatura (autorizada, pausada, cancelada)
- Histórico de pagamentos com link do recibo MP

## Detalhes técnicos

- **Endpoints MP usados**: `POST /preapproval_plan`, `POST /preapproval`, `GET /preapproval/{id}`, `GET /authorized_payments/search?preapproval_id=`, `GET /users/me`.
- **Auth**: `Authorization: Bearer ${MP_ACCESS_TOKEN}` direto (sem gateway).
- **Recorrência**: `auto_recurring.frequency=1/3`, `frequency_type=months`, `transaction_amount`, `currency_id=BRL`.
- **Cancelamento**: `PUT /preapproval/{id}` com `status: "cancelled"` — exposto no Admin Master por linha.
- **Secrets novos**: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`.

## Ordem de execução

1. Migration: nova tabela `payment_provider_config`, colunas MP em `plan_catalog`/`subscriptions`/`subscription_invoices`, drop `tenants.stripe_publishable_key`.
2. `add_secret` MP_ACCESS_TOKEN + `generate_secret` MP_WEBHOOK_SECRET.
3. Edge functions: `mp-validate`, `mp-ensure-plan`, `mp-subscription-checkout`, `mp-webhook` + `config.toml`.
4. Front: refatorar `SubscriptionsPage.tsx` (aba MP) e `TenantPlans.tsx` (redirect checkout); limpar `TenantConfig.tsx`.
5. Deletar arquivos Stripe + `bun remove @stripe/stripe-js`.
