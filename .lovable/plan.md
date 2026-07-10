
## Objetivo
Criar uma oferta única "POSION Fundadores" de **R$ 250 vitalício**, limitada aos **10 primeiros clientes**, com checkout **Pix transparente** (QR Code + copia-e-cola gerado dentro da própria página, sem sair para o Mercado Pago). E entregar a mensagem pronta pra você mandar no WhatsApp do Matheus (Instituto Roar) e do Gabriel Lourenço.

---

## 1. Banco de dados (migration)

Nova tabela `founder_slots` para controlar o limite de 10 vagas:

```
founder_slots
- id uuid pk
- tenant_id uuid (fk tenants) unique
- payment_id text                (id do pagamento Pix no MP)
- status text ('pending'|'paid'|'expired'|'cancelled')
- amount_cents int default 25000
- qr_code_base64 text
- qr_code_text text              (copia-e-cola)
- ticket_url text
- expires_at timestamptz
- paid_at timestamptz
- created_at / updated_at
```

+ GRANTs (`authenticated` só lê o próprio tenant; `service_role` full).
+ RLS: tenant vê o próprio; admin vê tudo.
+ Função `count_founder_slots_taken()` → `SELECT count(*) WHERE status IN ('paid','pending' com expires_at > now())`.
+ Extensão em `subscriptions`: aceitar `interval = 'lifetime'` e `plan_code = 'posion_founder'`.
+ Registro em `plan_catalog`: `posion_founder / R$250 / interval=lifetime / lookup_key=posion_founder_v1`.

## 2. Edge functions

**`mp-pix-create`** (nova) — recebe `tenant_id`, valida:
- tenant tem acesso, ainda não pagou o Founder;
- restam vagas (`count < 10`);
- chama `POST /v1/payments` do MP com `payment_method_id: 'pix'`, `transaction_amount: 250`, `payer.email`, `description: 'POSION Fundadores — Acesso Vitalício'`, `notification_url` (webhook), `date_of_expiration` (+30 min);
- persiste em `founder_slots` (status=`pending`, qr_code, qr_code_text, ticket_url, expires_at);
- retorna `{ qr_code_base64, qr_code_text, ticket_url, expires_at, payment_id }`.

**`mp-pix-status`** (nova) — polling: recebe `payment_id`, chama `GET /v1/payments/{id}`, se `status=approved` marca `founder_slots.status='paid'` + cria `subscriptions` com `status='active'`, `interval='lifetime'`, `current_period_end=NULL` (vitalício) + grava `subscription_invoices`. Retorna status atualizado.

**`mp-webhook`** (existente) — estender para reconhecer pagamentos Pix cujo `external_reference` seja `founder:<tenant_id>`; mesma lógica de ativação (idempotente com `mp-pix-status`).

## 3. Frontend — `src/pages/app/TenantPlans.tsx`

- Buscar `founder_slots` (vagas restantes) + status próprio do tenant.
- Novo componente destaque no topo: **card "Oferta Fundadores"** dourado, mostrando:
  - "Últimas X de 10 vagas"
  - "R$ 250 — pagamento único, acesso vitalício"
  - Lista curta de benefícios (mesma do Pro + selo Fundador)
  - Botão **"Gerar Pix agora"**
- Ao clicar → abre modal `<FounderPixCheckoutDialog>`:
  - chama `mp-pix-create`;
  - exibe QR Code (`<img src={data:image/png;base64,...}>`), campo copia-e-cola com botão "Copiar", contagem regressiva até expirar;
  - faz polling `mp-pix-status` a cada 4s;
  - quando `paid` → confete + "Pagamento confirmado! Bem-vindo, Fundador." e fecha modal, refresh da página.
- Se tenant já é fundador → card mostra selo "Você é Fundador POSION" (sem CTA).
- Se vagas esgotadas → card mostra "Vagas esgotadas" e some o CTA, mantendo o catálogo mensal/tri/semestral abaixo.

## 4. Mensagem para WhatsApp (retorno no chat)

Depois de aplicar, respondo aqui no chat com o texto pronto pra copiar/colar, algo como:

> "Fala, Matheus / Gabriel! Tô finalizando as conexões da plataforma pra deixar tudo rodando 100% até segunda-feira. Como combinado, o investimento pra travar o acesso é **R$ 250 (pagamento único, vitalício — condição de Fundador POSION, só pros 10 primeiros)**. Entra no seu painel em **Planos → Oferta Fundadores → Gerar Pix agora**, paga pelo QR Code que aparece na tela e me sinaliza aqui assim que efetuar. Assim que cair, libero as automações e a gente sobe tudo pra segunda. 🚀"

## Detalhes técnicos

- Todos os edge functions usam `getMpAccessToken()` de `_shared/mp-token.ts` (já existe).
- CORS + `verify_jwt = true` (usa Authorization do usuário) nas funções `mp-pix-create` e `mp-pix-status`.
- Polling client-side com `setInterval` + AbortController; para em `paid|expired|cancelled` ou ao fechar modal.
- Idempotência: `mp-pix-create` só cria novo Pix se o `founder_slot` do tenant estiver `expired`/inexistente. Se `pending` válido → retorna o QR existente.
- `subscriptions.interval = 'lifetime'` já é aceito (coluna `text`); ajustar `TenantPlans` para exibir "Vitalício" quando esse valor aparecer.
- Sem quebra dos planos mensais/tri/sem: continuam abaixo, o Founder é o card destaque.

## Arquivos que serão criados/alterados
- migration nova (`founder_slots` + grants + rls + plan_catalog insert)
- `supabase/functions/mp-pix-create/index.ts` (novo)
- `supabase/functions/mp-pix-status/index.ts` (novo)
- `supabase/functions/mp-webhook/index.ts` (estender)
- `src/components/tenant/FounderPixCheckoutDialog.tsx` (novo)
- `src/pages/app/TenantPlans.tsx` (card destaque + integração)
