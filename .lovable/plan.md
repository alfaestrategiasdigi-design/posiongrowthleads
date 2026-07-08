## Novo catálogo POSION Pro

Valor de referência: **R$ 450/mês** · usuários ilimitados · sem agente de IA · sem cobrança mensal avulsa (compromisso mínimo trimestral).

| Plano | Ciclo | Preço cheio | Desconto | Preço final | Equivalente/mês |
|---|---|---|---|---|---|
| POSION Pro Trimestral | 3 meses | R$ 1.350 | **–10%** | **R$ 1.215** | R$ 405 |
| POSION Pro Semestral | 6 meses | R$ 2.700 | **–20%** | **R$ 2.160** | R$ 360 |

## Escopo da mudança

### 1. Banco (`plan_catalog`) — via migration
- Marcar como `active = false` todas as linhas atuais (Starter/Pro/Scale mensal e trimestral). Assinaturas ativas seguem funcionando no valor antigo até renovarem/cancelarem — histórico preservado.
- Inserir 2 novas linhas:
  - `code = 'pro'`, `interval = 'quarter'`, `name = 'POSION Pro Trimestral'`, `amount_cents = 121500`, `currency = 'brl'`, `lookup_key = 'pro_quarter_v_new'`, `mp_preapproval_plan_id = NULL`, `sort_order = 1`, `active = true`, `mp_reason = 'POSION Pro Trimestral'`.
  - `code = 'pro'`, `interval = 'semester'`, `name = 'POSION Pro Semestral'`, `amount_cents = 216000`, `currency = 'brl'`, `lookup_key = 'pro_semester_v1'`, `mp_preapproval_plan_id = NULL`, `sort_order = 2`, `active = true`, `mp_reason = 'POSION Pro Semestral'`.
- O plano MP será criado automaticamente no primeiro checkout (fluxo já implementado em `mp-subscription-checkout` + `ensureMpPreapprovalPlan`).

### 2. Suporte a intervalo semestral
Hoje o helper `ensureMpPreapprovalPlan` e a UI só reconhecem `month` e `quarter`. Ajustar para aceitar `semester`:
- `supabase/functions/_shared/mercadopago.ts`: `frequency = interval === 'semester' ? 6 : interval === 'quarter' ? 3 : 1`.
- `src/pages/app/TenantPlans.tsx` e `src/pages/admin/SubscriptionsPage.tsx`: label "Semestral" para `interval === 'semester'`, cálculo de MRR dividindo por 6.

### 3. UI — `src/pages/app/TenantPlans.tsx` (cliente)
- Remover cards Starter/Pro/Scale. Renderizar apenas **um card POSION Pro** com dois botões (Trimestral / Semestral).
- Texto de features: "Usuários ilimitados", "CRM Kanban", "WhatsApp integrado", "Recall automatizado", "Meta Ads", "Suporte prioritário". **Não** mencionar agente de IA.
- Mostrar equivalente/mês ao lado do preço (ancoragem em R$ 450/mês).
- Selo "–20%" no semestral, "–10%" no trimestral.

### 4. UI — `src/pages/admin/SubscriptionsPage.tsx`
- Aba "Planos & Faturas" passa a listar apenas os 2 planos ativos (o filtro já vem da query; só precisa garantir ordenação).
- Ajustar MRR: `s.interval === 'semester' ? amount/6 : s.interval === 'quarter' ? amount/3 : amount`.

### 5. Detalhes técnicos
- `subscriptions.interval` já é texto livre, aceita `'semester'` sem migration adicional.
- Assinaturas antigas continuam válidas — não mexer em `subscriptions` existentes.
- Nenhuma alteração em RLS/GRANT (tabelas já existem).

## Fora de escopo
- Migração forçada de clientes atuais para os novos valores (fazer manualmente caso a caso).
- Integração de novo gateway (segue Mercado Pago).
- Página pública de pricing / landing (só painel admin e área do tenant).
