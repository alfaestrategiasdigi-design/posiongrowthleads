## Contexto

O sistema já roda `sync-meta-leads` a cada 15 minutos: ele lista todos os `leadgen_forms` da página Facebook conectada, chama `resolve_tenant_for_lead` (que lê `lead_routing_rules`, `match_type='form_id'`) e insere o lead no tenant correto. Falta apenas a UI para o admin ver quais forms existem e vinculá-los.

Hoje a página Campanhas Meta tem um botão "Adicionar regra form_id" que exige digitar o ID cru — inútil na prática. Vamos substituir por uma tabela viva que puxa os forms direto do Meta.

## O que muda

### 1. Edge function `facebook-ads-manage` — nova action

Adiciono `case "list_lead_forms"` em `supabase/functions/facebook-ads-manage/index.ts`. Ele lê `page_id` de `facebook_webhook_config` e chama `GET {page_id}/leadgen_forms?fields=id,name,status,leads_count,created_time`. Retorna `{ ok, data: [{id, name, status, leads_count, created_time}] }`.

Sem novo secret; usa o `page_access_token` já persistido.

### 2. `src/pages/admin/CampanhasPage.tsx` — bloco Mapeamento reformulado

Dentro do `<details>` "Mapeamento de Contas & Formulários" o segundo sub-bloco vira uma **tabela viva de Lead Forms**:

```text
FORMULÁRIO (Meta)          ID              LEADS   CLIENTE VINCULADO       AÇÃO
Consulta Botox — Roar      1234567890      42     [Instituto Roar ▾]    ↻ Sync
Aval. Facial Alessandro    9876543210      17     [— sem vínculo ▾]     ↻ Sync
Landing Genérica           5555555555      3      [Admin Master (fallback) ▾]  ↻ Sync
```

Comportamento:

- Ao abrir o `<details>`, chama `facebook-ads-manage` action `list_lead_forms`. Mostra loader e depois a tabela.
- Coluna "Cliente vinculado" é um `<Select>` alimentado pelo array `tenants`; opção adicional "— sem vínculo —" e "Admin Master (fallback)".
- Trocar o valor faz upsert em `lead_routing_rules` (`match_type='form_id'`, `match_value=form.id`, `match_label=form.name`, `priority=5`, `active=true`). "— sem vínculo —" apaga a regra. Toast de confirmação.
- Botão ↻ Sync por linha chama `facebook-backfill-leads` com `{ form_ids: [form.id], max_per_form: 200 }` e mostra o resultado (X importados, Y duplicados).
- Cabeçalho do bloco ganha um botão global "Sincronizar todos os forms agora" que dispara `facebook-backfill-leads` sem `form_ids` (backfill de todos).
- Some o diálogo "Nova regra form_id → cliente" (input cru de ID) — não é mais necessário.

### 3. Sub-bloco "Contas de anúncios → Cliente" permanece como está

Fica no mesmo `<details>`, acima dos Lead Forms. Sem mudanças de comportamento.

### 4. Reflexo no cliente — nenhuma mudança de código

Não precisa mexer em `TenantCampaigns.tsx` nem no Kanban do tenant. Assim que o admin vincula um form à clínica X, o próximo ciclo do cron `sync-meta-leads` (≤15 min) já grava os leads com `tenant_id = X` e o tenant vê no Kanban ("Novo") e em Leads. O botão ↻ Sync individual serve para não esperar 15 min no primeiro vínculo.

### 5. Feedback ao admin

Card acima da tabela mostra: total de forms, quantos já vinculados, quantos sem cliente, timestamp da última sync (lê `last_leads_sync_at` do RPC `get_facebook_config_meta` que já existe).

## Detalhes técnicos

Arquivos tocados:
- `supabase/functions/facebook-ads-manage/index.ts` — +30 linhas para a nova action.
- `src/pages/admin/CampanhasPage.tsx` — substituo o bloco `formIdRules` + `addFormRule` dialog pela tabela nova (~120 linhas trocadas). O restante da página (KPIs, cards de campanha, header sticky) fica intacto.

Reaproveitados sem mexer: `resolve_tenant_for_lead` (RPC), `facebook-backfill-leads`, `sync-meta-leads` (cron), `lead_routing_rules`.

Nenhuma migração de banco. Nenhum secret novo.

## Fora de escopo

- Configurar webhook Meta em tempo real (usuário pediu "puxar automaticamente"; o cron de 15 min já cobre e não requer setup extra).
- Renderizar campos do formulário (nome, telefone etc.) na tabela — só ID e nome bastam para vincular.
- Vincular a nível de campaign_id ou ad_id (fica só form_id + ad_account, como hoje).
