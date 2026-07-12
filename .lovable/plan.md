## Objetivo
Garantir que `/admin/contratos-agencia` mostre apenas contratos originados do pipeline Posion Master (agency_leads), mantendo a aba SaaS separada.

## Mudanças

**src/pages/admin/AgencyContractsPage.tsx**
1. No `load()`, alterar a query de `agency_contracts` para filtrar `agency_lead_id IS NOT NULL` — assim só entram contratos que nasceram de um lead do pipeline Posion Master (via trigger `trg_create_contract_on_ganho`) ou que foram promovidos por `promote_agency_lead_to_tenant`.
2. Manter `tenant_id: null` no insert manual (já está correto) e adicionar `agency_lead_id: null` explicitamente — porém, para o novo contrato manual criado pela UI, exigir vínculo? Não: manter criação manual permitida, mas ela só aparecerá se tiver `agency_lead_id`. Alternativa mais simples: no dialog "Novo Contrato", adicionar um seletor obrigatório de "Lead do pipeline Posion Master" (agency_leads em stage ganho/ativo) para vincular `agency_lead_id`. Isso garante que todo contrato criado aqui pertença ao pipeline.
3. KPIs recalculados sobre a lista já filtrada (nenhuma outra mudança necessária).
4. Aba SaaS permanece inalterada, listando `saas_contracts` normalmente.

## Resultado
- Aba "Agência" mostra somente contratos vinculados a leads do pipeline Posion Master.
- Novos contratos criados pela UI passam a exigir um lead de origem do pipeline Posion Master.
- Aba "SaaS" continua exibindo assinaturas dos tenants como hoje.
