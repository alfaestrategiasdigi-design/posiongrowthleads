
# Separação: Admin Master (Agência) vs Tenants (Clínicas)

Entendi agora — hoje os dois níveis estão misturando o mesmo pipeline/pacientes/produtos. Vamos separar em dois mundos com vocabulários e telas próprias.

---

## Conceito

| Nível | Quem é o "lead"? | Quem é o "cliente"? | O que vende? |
|---|---|---|---|
| **Admin Master (POSION Agência)** | Clínica interessada em contratar a POSION | Clínica que virou cliente (tenant ativo) | Plano SaaS + serviço de agência (contratos) |
| **Tenant (Clínica)** | Paciente que veio de campanha | Paciente ativo | Procedimentos / pacotes |

São dois CRMs paralelos. Um não interfere no outro.

---

## 1. Admin Master — funil de agência próprio

**Rota:** `/admin/pipeline` (novo).

**Fonte de dados:** nova tabela `agency_leads` (não usa `leads` nem `clinic_leads` — essas ficam pro tenant).

```
agency_leads {
  id, nome_clinica, responsavel, whatsapp, email, cidade, estado,
  origem (indicacao/instagram/inbound/outbound/evento),
  stage (lead → qualificado → reuniao → proposta → negociacao → ganho → perdido),
  valor_proposta, plano_interesse (starter/growth/premium),
  proximo_followup, owner_id, notas, tags,
  ganho_at, tenant_id_criado (fk quando vira cliente),
  created_at, updated_at
}
```

**Kanban Master** com essas 7 colunas, cards com valor proposta, cidade, próxima ação, tag do plano.

**Ao mover para GANHO:**
- Cria automaticamente um `tenant` (`nome_clinica → tenants.name`, slug gerado).
- Cria `saas_contracts` com o plano.
- Cria `agency_contracts` (novo) para o serviço.
- Dispara CAPI Purchase pro pixel da POSION com `valor_proposta`.

## 2. Dashboard Master — reflete AGÊNCIA (não SaaS puro)

**3 blocos, período com date range (padrão 30d):**

1. **Pipeline Agência**
   - Leads no funil, por stage
   - Taxa de conversão lead→ganho
   - Ticket médio de contrato
   - Valor total em negociação

2. **Fechamentos (agência + SaaS)**
   - Nº contratos assinados no período
   - Receita agência (soma `agency_contracts.valor_total`)
   - MRR SaaS (soma `saas_contracts.mrr`)
   - **Total combinado** = agência + SaaS

3. **Operação dos clientes** (visão consolidada, apenas leitura)
   - Nº tenants ativos
   - Leads capturados pelos tenants (soma cross-tenant) — só métrica
   - Vendas dos tenants no período (GMV)
   - Top 5 clínicas por resultado

O dashboard **NÃO** mostra pacientes, procedimentos ou agenda das clínicas — isso é do tenant.

## 3. Sidebar Admin Master — reorganizada

```
OPERAÇÃO POSION
  Dashboard             (agência + resumo tenants)
  Pipeline Agência      (kanban novo)
  Contratos             (agency + saas contracts)
  Clínicas Clientes     (lista de tenants + KPIs de cada)

MARKETING
  Campanhas Meta
  Leads (formulário POSION)
  CAPI

CONFIGURAÇÕES
  Automações (recall, welcome)
  Integrações (Meta, WhatsApp master, Mercado Pago)
  Planos & Cobranças
  Usuários & Roles
```

Remover do master: qualquer coisa de "paciente", "prontuário", "agenda clínica", "produtos da clínica".

## 4. Tenant (Clínica) — fica isolado, com CRM da clínica

Aplico as mudanças do plano anterior **apenas dentro do tenant**:
- Sidebar tenant: Dashboard · WhatsApp · Kanban (leads=pacientes) · **Pacientes Ativos** · **Automações** · **Financeiro** · **Agenda** · **Produtos & Procedimentos** · Configurações
- Date range 30d padrão no dashboard
- Catálogo de produtos por tenant (não hardcoded)
- Financeiro (renomeia Fechamentos) com sub-dashboard
- Kanban usa `PIPELINE_STAGES` (Lead → Qualificado → Consulta → Compareceu → Negociação → Ganho/Perdido/No-show)

**Nada disso aparece pro admin master.**

## 5. Backfill leads Meta (todas as campanhas, mesmo pausadas)

- Editar `sync-meta-leads` / `facebook-backfill-leads`: remover filtro de status, iterar todos forms de todas as campanhas dos últimos 90d.
- Roteamento por `lead_routing_rules` decide se vai pro tenant X ou pro `agency_leads` (quando `default_tenant_id` for o "Master").

## 6. Fix imediato do print

- Kanban mostra "REUNIÃO AGENDADA" — trocar 100% pra "CONSULTA AGENDADA" (source-of-truth em `PIPELINE_STAGES`).
- Coluna "CONSULTA" no print está com label truncado — largura mínima e ellipsis.

---

## Detalhes técnicos

**Migração (1):**
- `CREATE TABLE agency_leads` + GRANT + RLS (só admin).
- `CREATE TABLE agency_contracts` + GRANT + RLS.
- `CREATE TABLE tenant_products (id, tenant_id, nome, categoria, preco_sugerido, duracao_min, ativo)` + GRANT + RLS por tenant.
- Function `promote_agency_lead_to_tenant(lead_id)` — cria tenant + contrato + dispara CAPI.

**Arquivos novos:**
- `src/pages/admin/AgencyPipelinePage.tsx` (kanban master)
- `src/pages/admin/AgencyContractsPage.tsx`
- `src/pages/admin/Dashboard.tsx` (rewrite completo com 3 blocos)
- `src/components/shared/DateRangePicker.tsx`
- `src/pages/app/TenantProductsConfig.tsx`
- `src/pages/app/TenantFinanceiro.tsx`
- `src/pages/app/TenantPacientesAtivos.tsx`
- `src/pages/app/TenantAutomacoes.tsx`

**Editados:**
- `AdminLayout.tsx` (sidebar master reorganizada)
- `AppLayout.tsx` (sidebar tenant renomeada)
- `TenantKanban.tsx` (produtos dinâmicos + labels)
- `TenantDashboard.tsx` (date range)
- `TenantAgenda.tsx` (redesign)
- 2 edge functions de sync Meta

---

## Ordem de execução

1. **Migração** (agency_leads, agency_contracts, tenant_products, promote function).
2. **Paralelo A:** Pipeline Agência + Dashboard Master novo + sidebar master.
3. **Paralelo B:** DateRangePicker + rename sidebar tenant + tenant_products config + fix kanban label.
4. **Sequencial:** Financeiro, Pacientes Ativos, Automações, Agenda.
5. **Último:** edge functions backfill.

---

## O que preciso confirmar

1. **Origem dos leads da agência POSION**: hoje o formulário de qualificação (`QualificacaoPage`) grava em `clinic_leads` do master. Migro os existentes pra `agency_leads` ou começo do zero?
2. **Contratos existentes**: já temos `saas_contracts` e `posion_contracts`. Uso `agency_contracts` como camada nova ou consolido tudo em `posion_contracts` (que já existe)?
3. **Meta Pixel do master**: o Purchase do funil agência dispara pro pixel da POSION (config em `tenant_capi_config` com tenant_id = sentinel master)?

Se responder as 3, toco a migração já com as decisões certas. Se preferir, uso os defaults: (1) migrar clinic_leads master→agency_leads, (2) reusar posion_contracts renomeando pra agency_contracts, (3) sim, pixel master via sentinel.

**Aprova?**
