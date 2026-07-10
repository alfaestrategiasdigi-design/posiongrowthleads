## Objetivo

Permitir que o admin master configure **ofertas personalizadas por tenant** (ex.: Gabriel Lourenço = 3 meses por R$ 100), sobrescrevendo os preços padrão do catálogo. Também permitir controlar manualmente quem entra na "Oferta Fundadores" e com qual condição.

## Como o usuário vai usar

Nova aba **"Planos & Cobranças"** dentro do painel Admin (sidebar admin), listando todos os tenants. Para cada tenant, um botão **"Configurar oferta"** abre um modal onde o admin define:

- **Tipo de oferta**: Padrão (usa `plan_catalog`) · Fundadores POSION · **Oferta personalizada**
- Se **Personalizada**: valor da entrada (R$), quantidade de ciclos nesse valor (ex.: 3), intervalo (mensal), valor recorrente após os ciclos promocionais (R$/mês) e data de expiração da oferta
- Se **Fundadores**: reserva um slot manualmente (marca como pago ou pendente) sem consumir Pix
- Botão **"Gerar Pix desta oferta"** que cria o Pix já com o valor customizado e envia o link/QR para o tenant

Na página `/app/<slug>/planos` do tenant, se existir uma **oferta personalizada ativa**, ela aparece como card destaque no topo (substituindo/acima do card Fundadores), com os textos vindos da configuração — ex.: "Oferta especial: 3 meses por R$ 100 · depois R$ 389/mês".

## Mudanças técnicas

### 1. Banco — nova tabela `tenant_custom_offers`

```
tenant_id (uk), label, kind ('founder' | 'custom' | 'standard'),
entry_amount_cents, entry_cycles, interval ('month'|'quarter'|'semester'),
recurring_amount_cents, description, active, expires_at,
created_by, created_at, updated_at
```

RLS: `SELECT` para membros do tenant + admin; `INSERT/UPDATE/DELETE` só para `has_role('admin')`. GRANTs para `authenticated` e `service_role`.

### 2. Edge functions

- **`mp-pix-create`**: aceitar parâmetro opcional `offer_id`. Se vier, buscar `tenant_custom_offers`, usar `entry_amount_cents` e a descrição custom em vez dos R$ 250 fixos. Validar que o offer pertence ao tenant e está ativo.
- **`mp-pix-status`**: ao aprovar, se o pagamento veio de uma custom offer, criar `subscriptions` com `amount_cents = recurring_amount_cents`, `interval = offer.interval`, `current_period_end = paid_at + entry_cycles * (30d|90d|180d)`, `plan_code = 'custom:' || offer.id`, `is_founder = (kind='founder')`.

### 3. Frontend admin — nova página `src/pages/admin/PlanosCobrancasPage.tsx`

- Tabela de tenants com colunas: Tenant, Plano atual, Oferta ativa (badge), Próxima cobrança, Ações
- Botão **"Configurar oferta"** → `TenantOfferDialog` (novo componente) com o formulário acima
- Botão **"Gerar Pix"** → chama `mp-pix-create` com o `offer_id`, exibe QR/copia-cola no modal
- Botão **"Marcar como Fundador (sem cobrança)"** para casos manuais
- Entrada no sidebar admin (`AppSidebar.tsx`): "Planos & Cobranças"
- Rota nova em `App.tsx`: `/admin/planos-cobrancas`

### 4. Frontend tenant — `src/pages/app/TenantPlans.tsx`

- Carregar `tenant_custom_offers` do tenant atual (se ativa e não expirada)
- Se existir oferta custom: renderizar card destaque **no lugar** do card Fundadores, com o `label`, valores e descrição da oferta, e botão "Gerar Pix — R$ X (oferta especial)"
- `FounderPixCheckoutDialog` recebe prop opcional `offer` e passa `offer_id` ao invocar `mp-pix-create`; textos e valores no modal vêm da oferta quando presente

### 5. Exemplo para Gabriel Lourenço

Admin abre Planos & Cobranças → escolhe tenant do Gabriel → cria oferta:
- Tipo: Personalizada
- Entrada: R$ 100 · 3 ciclos mensais
- Recorrente após: R$ 389/mês
- Expira em: (data escolhida)

Gabriel entra em `/planos`, vê "Oferta especial: 3 meses por R$ 100", gera Pix de R$ 100, paga; assinatura ativa por 90 dias, depois renova em R$ 389/mês.

## Arquivos afetados

- **Novo**: migration `tenant_custom_offers` + GRANTs + RLS
- **Novo**: `src/pages/admin/PlanosCobrancasPage.tsx`
- **Novo**: `src/components/admin/TenantOfferDialog.tsx`
- **Editar**: `src/App.tsx` (rota), `src/components/admin/AppSidebar.tsx` (menu)
- **Editar**: `src/pages/app/TenantPlans.tsx` (renderizar oferta custom)
- **Editar**: `src/components/tenant/FounderPixCheckoutDialog.tsx` (aceitar `offer`)
- **Editar**: `supabase/functions/mp-pix-create/index.ts` e `mp-pix-status/index.ts`

## Fora do escopo

- Editar o `plan_catalog` global pela UI (continua via migration/seed)
- Cobrança recorrente automática do valor custom após o período (fica com o cron de renovação já planejado; ele lê `subscriptions.amount_cents` e `current_period_end`, então funciona nativamente)
