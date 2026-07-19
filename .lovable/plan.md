## Objetivo

Aplicar mudanças mínimas e seguras para: (1) impedir agendamentos sem lead vinculado (UI e automações), (2) garantir que o roteamento use `resolve_form_routing` como fonte única, (3) corrigir a UI de Leads admin para incluir forms `is_admin_master`, e (4) preparar migration segura sem UPDATEs em massa.

## Escopo por área

### 1. UI — Bloquear salvar agendamento sem lead
- **`src/components/admin/AppointmentModal.tsx`**
  - Adicionar validação em `handleSave`: se `!form.agency_lead_id && !form.lead_id` → `toast.error("Vincule um lead antes de criar o agendamento")` e abortar.
  - Adicionar aviso visual (badge/hint vermelho) próximo ao campo de busca de lead enquanto nenhum lead está vinculado.
  - Desabilitar botão "Criar agendamento" quando não houver vínculo (mantém "Salvar alterações" em edição de registros legados).
- **`src/components/tenant/AppointmentDialog.tsx`**
  - Mesma validação: exigir `lead_id` no payload antes do insert/update; nunca enviar `lead_id: null` em criação.
  - Mensagem clara e botão desabilitado até vincular.

### 2. Automations — Não criar agendamento sem lead
- **`supabase/functions/automation-dispatch/index.ts`**
  - No handler `appointment_create` (ou equivalente): se `ctx.lead_id` ausente/inválido, marcar execução como `skipped` com `reason: "missing_lead_id"` em `automation_executions`, sem inserir em `appointments`.
  - Remover fallbacks tipo `lead_id: ctx.lead_id ?? null` — sempre usar `ctx.lead_id` validado.

### 3. Leads admin — Forms admin-master visíveis mesmo sem leads
- **`src/pages/admin/LeadsPage.tsx`**
  - No dropdown/lista de formulários: unir `distinct facebook_form_id` de `leads` com todos os forms `lead_routing_rules` onde `is_admin_master=true AND match_type='form_id'`.
  - Rotular forms sem leads como "Sem leads ainda" para clareza.
- **`src/pages/admin/MetaAdsAdminPage.tsx`**
  - Nas queries de checagem de duplicidade de regra, adicionar `.eq("is_admin_master", true)` para o escopo master; corrigir insert para respeitar unicidade `(match_type, match_value, is_admin_master)`.

### 4. Edge functions — `resolve_form_routing` como fonte única
- **`supabase/functions/facebook-leads-webhook/index.ts`**, **`facebook-backfill-leads/index.ts`**, **`sync-meta-leads/index.ts`**
  - Confirmar/ajustar chamada `admin.rpc("resolve_form_routing", { p_form_id })`.
  - Se `matched=false`: gravar em `unrouted_leads` (não em `leads`).
  - Se `matched=true`: usar `tenant_id` retornado (pode ser `null` quando `is_admin_master=true`) na inserção em `leads`.
  - Remover qualquer lookup direto legado a `lead_routing_rules` nessas funções.

### 5. Migration segura — apenas a função
- **`supabase/migrations/20260719000000_fix_resolve_form_routing.sql`** (novo)
  - Somente `CREATE OR REPLACE FUNCTION public.resolve_form_routing(...)` com a implementação atual/corrigida.
  - **NÃO** incluir `UPDATE public.leads` nem `UPDATE public.conversations`. Backfills ficam para janela posterior com aprovação explícita.

### 6. Testes e verificação
- Rodar `npm run build` e testes existentes (`vitest`).
- Manual QA:
  - Criar agendamento sem lead (admin e tenant) → bloqueado.
  - Criar com lead → OK, `leads.reuniao_agendada_em` atualizado (trigger existente).
  - Automação dispara sem `lead_id` → nada em `appointments`, execução registrada como `skipped`.
  - `LeadsPage`: dropdown mostra forms admin-master mesmo sem leads.
  - Webhook com `form_id` mapeado → lead no tenant certo; sem mapeamento → `unrouted_leads`.

## Fora de escopo (requer aprovação separada)
- Qualquer `UPDATE` em massa em `public.leads` ou `public.conversations` para recolocar `tenant_id`. Fazer em janela com backup e plano de reversão.
- Alterações em RLS/policies existentes.

## Detalhes técnicos

**Validação de payload (exemplo, admin):**
```ts
if (!form.agency_lead_id && !form.lead_id) {
  toast.error("Vincule um lead antes de criar o agendamento");
  return;
}
```

**Automations skip pattern:**
```ts
if (!ctx.lead_id) {
  await logExecution(step, "skipped", { reason: "missing_lead_id" });
  return;
}
```

**LeadsPage — união de forms:**
```ts
const [{ data: fromLeads }, { data: fromRules }] = await Promise.all([
  supabase.from("leads").select("facebook_form_id, facebook_form_name").not("facebook_form_id","is",null),
  supabase.from("lead_routing_rules").select("match_value, description").eq("is_admin_master", true).eq("match_type","form_id").eq("active", true),
]);
// merge por match_value/facebook_form_id
```

## Ordem de aplicação
1. Migration (só função) → aplicar e verificar `SELECT * FROM resolve_form_routing('FORM_ID')`.
2. Edge functions (webhook/backfill/sync) → deploy.
3. UI (AppointmentModal, AppointmentDialog, LeadsPage, MetaAdsAdminPage).
4. Automations dispatcher.
5. Build + QA manual dos 5 cenários.
