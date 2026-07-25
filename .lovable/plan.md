## Objetivo

Deixar o tenant **MatheusBetSafe** (`matheusbetsafe`) operar em modo **infoproduto** (leads + vendas manuais de produto digital) sem impactar os tenants de clínica. Toda a lógica clínica (agendamento, prontuário, procedimentos, pacientes) continua igual para os demais.

## Como será ativado

Nova coluna `tenants.business_type text default 'clinica'` com valor `'infoproduto'` **apenas** para o MatheusBetSafe. Todo o comportamento novo só liga quando `tenant.business_type === 'infoproduto'`. Nenhum outro tenant é afetado.

Nada de estrutura nova: reaproveitamos `leads`, `sales`, kanban e sidebar existentes. A flag apenas troca labels e esconde itens.

## Escopo (o que muda com a flag ligada)

**1. Sidebar do tenant** (`src/components/app/TenantSidebar.tsx`)
- Ocultar: **Pacientes Ativos, Agenda, Produtos & Serviços, Planos, Automações** (mantemos Dashboard, WhatsApp, Leads, Campanhas Meta, Kanban, Financeiro, Relatórios, Configurações).
- Rota `/pacientes` e `/agenda` continuam existindo mas não aparecem no menu deste tenant.

**2. Labels renomeados (só na UI deste tenant)**
Criar helper `src/lib/tenant/labels.ts` com um dicionário por `business_type`:
- Paciente → **Cliente**
- Agendamento / Consulta → **Sessão / Checkout**
- Prontuário → oculto
- Procedimento → **Produto**

Componentes que hoje escrevem "Paciente"/"Agendamento" no header, breadcrumb e botões do Dashboard/Leads/Kanban passam a usar `useTenantLabels()` (hook fino que lê `tenant.business_type`).

**3. Kanban com estágios próprios** (`src/types/admin.ts` + `src/pages/app/TenantKanban.tsx`)
Adicionar nova constante `INFOPRODUTO_PIPELINE_STAGES` **reusando os mesmos `id`s já aceitos pelo constraint `leads_status_check`** (só muda `title`/`short`):

```
lead              → "Lead Novo"
qualificado       → "Assistiu VSL"
agendar_reuniao   → "Iniciou Checkout"
reuniao_agendada  → "Boleto/Pix Gerado"
proposta          → "Aguardando Pagamento"
negociacao        → "Em Negociação"
ganho             → "Comprou"
ativo             → "Cliente Ativo"
perdido           → "Perdido / Reembolso"
```

`TenantKanban` escolhe entre `CLIENT_PIPELINE_STAGES` e `INFOPRODUTO_PIPELINE_STAGES` conforme `business_type`. Sem migration de dados, sem novo enum, sem mexer nos gatilhos existentes.

**4. Vendas: manual apenas**
Continua exatamente como hoje (mover card para "Comprou" abre `SalesDialog`, sem webhook de checkout). Só o label do estágio muda.

## Fora de escopo (para depois, se pedir)

- Webhook de checkout (Hotmart/Kiwify/Stripe).
- Página `/produtos` reformulada para catálogo digital.
- Automação/CAPI específicas de infoproduto.

## Detalhes técnicos

**Migration**
```sql
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT 'clinica'
  CHECK (business_type IN ('clinica','infoproduto'));
```
Update de dados (via insert tool): setar `business_type = 'infoproduto'` para o tenant `matheusbetsafe`.

**Frontend**
- `src/lib/tenant/labels.ts` — dicionário + `getLabels(businessType)`.
- `src/hooks/useTenantLabels.ts` — lê `useTenant()` e devolve os labels.
- `src/components/app/TenantSidebar.tsx` — filtra itens por `business_type`.
- `src/types/admin.ts` — exporta `INFOPRODUTO_PIPELINE_STAGES` + helper `getPipelineStages(businessType)`.
- `src/pages/app/TenantKanban.tsx` — usa helper.
- Ajustes cirúrgicos nos títulos de `TenantDashboard`, `TenantLeadsPage`, `LeadCard` (header "Paciente" → label do dicionário).

**Segurança/dados**
- Sem mudança de RLS.
- Sem mudança em triggers (`trg_promote_lead_to_patient` etc.) — no infoproduto o card ao chegar em "Ativo" ainda cria registro em `patients`, mas como a página de pacientes fica oculta neste tenant, isso é inofensivo e mantém compatibilidade com relatórios existentes. Se quiser, na fase seguinte adicionamos guard `IF NEW.tenant_id business_type='infoproduto' THEN skip`.

## Riscos

- Baixo. Nenhum tenant existente muda porque o default é `'clinica'`. Só o slug `matheusbetsafe` recebe `'infoproduto'`.
- Kanban reusa os mesmos IDs de estágio → nenhum gatilho/relatório quebra.
