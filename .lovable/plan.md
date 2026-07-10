## Ajuste: "Oferta Fundadores" vira 1ª mensalidade promocional (R$ 250), depois R$ 389/mês

Entendi — não é vitalício. É um **desconto de entrada só no primeiro mês** (R$ 250) para os 10 primeiros clientes; a partir do 2º mês entra a mensalidade cheia de **R$ 389**. Vou refazer o Founder pra funcionar como assinatura mensal recorrente com 1ª parcela promocional, mantendo o Pix transparente na tela.

---

### 1. Banco de dados (nova migration)
- **`plan_catalog`**: atualizar/adicionar `posion_founder_v1` com `amount_cents = 38900`, `interval = 'month'`, `first_cycle_amount_cents = 25000`, `promo_slots_total = 10`, `description = "1º mês R$ 250 (fundador) · depois R$ 389/mês"`.
- **`founder_slots`** (já existe): manter, mas passa a representar apenas a 1ª cobrança promocional. Adicionar coluna `next_charge_at timestamptz` (data em que a mensalidade cheia começa) e `subscription_id uuid` (fk para `subscriptions`).
- Função `count_founder_slots_taken()` continua igual (limite de 10 vagas usadas para o desconto).

### 2. Edge functions
- **`mp-pix-create`**: continua criando o Pix de **R$ 250** (1ª parcela) — sem mudança de valor aqui. Só ajusta a `description` para "POSION Fundador — 1º mês (depois R$ 389/mês)".
- **`mp-pix-status`** (mudança principal): quando o Pix for `approved`, ao invés de criar `subscription` `lifetime`, cria:
  - `subscriptions` com `interval='month'`, `amount_cents=38900`, `status='active'`, `current_period_end = paid_at + 30 dias`, `plan_code='posion_founder'`, `is_founder=true`.
  - `subscription_invoices` da 1ª parcela (R$ 250, `is_promo=true`).
  - agenda a próxima cobrança em D+30 (grava `next_charge_at`).
- **`mp-webhook`**: mesma lógica idempotente.
- **Nova função `mp-founder-renew`** (cron diário): varre `subscriptions` com `is_founder=true` e `current_period_end <= now()`, gera cobrança recorrente de **R$ 389** via Mercado Pago (Pix ou preferência de assinatura) e atualiza `current_period_end += 30d`. Se falhar, marca `past_due`.

### 3. Frontend — `src/pages/app/TenantPlans.tsx` + `FounderPixCheckoutDialog.tsx`
- **Card "Oferta Fundadores"** (mantém visual dourado da imagem), textos ajustados:
  - Título: `POSION FUNDADORES — 1º MÊS R$ 250`
  - Subtítulo: `Só para os 10 primeiros · depois R$ 389/mês`
  - Preço em destaque: `R$ 250` com selo pequeno `1º mês` e linha embaixo `depois R$ 389/mês · cancele quando quiser`.
  - Benefícios: mantém os atuais, remove "Acesso vitalício — nunca mais paga mensalidade" e troca por **"Economia de R$ 139 na entrada"** e **"Selo de Fundador POSION vitalício"** (o selo continua para sempre, só a mensalidade não).
  - Botão: `Gerar Pix — R$ 250 (1º mês)`.
- **Modal Pix**: mesmo fluxo, mas com aviso curto abaixo do QR:  
  *"Este Pix libera seu 1º mês como Fundador (R$ 250). A partir do 2º mês a mensalidade é R$ 389, cobrada automaticamente. Cancele quando quiser."*
- Mensagem de sucesso: `Bem-vindo, Fundador POSION! Seu 1º mês está ativo até <data>.` (sem "vitalício").
- Card do plano ativo: quando `is_founder=true`, mostra badge `Fundador POSION` + `Próxima cobrança: R$ 389 em <data>`.

### 4. Nova mensagem pro WhatsApp (Matheus / Gabriel)
Depois de aplicar, devolvo o texto pronto, algo como:

> "Fala, Matheus / Gabriel! Tô fechando as conexões da plataforma pra deixar tudo rodando 100% até segunda. Como combinamos, vocês entram como **Fundadores POSION**: o **1º mês sai por R$ 250** (condição só pros 10 primeiros) e a partir do 2º mês a mensalidade normal é **R$ 389**, com o **selo de Fundador pra sempre**. É só entrar no painel em **Planos → Oferta Fundadores → Gerar Pix agora**, pagar pelo QR Code que aparece na tela e me sinalizar aqui. Assim que cair, libero as automações."

### Detalhes técnicos
- Valor do Pix inicial permanece **R$ 250**; só muda o significado (1ª parcela, não vitalício).
- `subscriptions.interval` volta a ser `'month'` (não uso mais `'lifetime'` para o Founder).
- Renovação: via cron `mp-founder-renew` chamando MP a cada 30 dias. Se preferir, posso usar Assinaturas nativas do Mercado Pago (preapproval) com valor `389` e uma cobrança avulsa inicial de `250` — mas o Pix transparente na tela continua sendo a 1ª parcela.
- Nenhuma mudança nos planos mensais/tri/sem existentes.

### Arquivos alterados/criados
- migration nova (atualiza `plan_catalog`, adiciona colunas em `founder_slots`)
- `supabase/functions/mp-pix-status/index.ts` (troca `lifetime` por mensal)
- `supabase/functions/mp-pix-create/index.ts` (só ajuste de description)
- `supabase/functions/mp-founder-renew/index.ts` (nova, cron)
- `src/components/tenant/FounderPixCheckoutDialog.tsx` (textos + aviso)
- `src/pages/app/TenantPlans.tsx` (card + badge do plano ativo)
