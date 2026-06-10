# Transformação em SaaS Multi-Tenant para Clínicas

Analisei a planilha do Dr. Matheus / Instituto Roar (Maio 2026, R$ 425.940, 63 vendas) e extraí o modelo de KPIs que vamos replicar. A planilha tem 7 abas: Resumo Executivo, Canais, Vendedores, KPIs Detalhados, Semana a Semana, Insights e Base Completa — todas viram dashboards dinâmicos no sistema.

## Visão Geral da Arquitetura

```text
┌────────────────────────────────────────────────────────┐
│  POSION ADMIN MASTER (a conta atual — agência)        │
│  • Funil de aquisição da própria agência               │
│  • Gestão de TODOS os tenants (clínicas clientes)      │
│  • Métricas consolidadas da carteira                   │
└────────────────────────────────────────────────────────┘
                          │
            cria / gerencia tenants
                          ▼
┌────────────────────────────────────────────────────────┐
│  TENANT = CLÍNICA CLIENTE  (ex.: Instituto Roar)      │
│  • Dashboard estilo Power BI (KPIs da planilha)        │
│  • Central de Conversas WhatsApp                       │
│  • Kanban de pacientes / funil de vendas               │
│  • Lista de pacientes + Lista de fechamentos           │
│  • Agendamentos da clínica                             │
└────────────────────────────────────────────────────────┘
```

Cada clínica enxerga só seus dados. O admin master enxerga tudo + sua própria operação.

## Modelo de Dados (novo)

Tabelas novas:
- **tenants** — clínicas clientes (nome, slug, logo, plano, status, meta_faturamento, etc.)
- **tenant_users** — vincula `auth.users` a um `tenant_id` com papel (`owner`, `vendedor`, `recepcao`)
- **patients** — pacientes da clínica (nome, contato, origem, status no funil, observações)
- **sales** — fechamentos (paciente, vendedor, valor, procedimento, categoria, canal, data, status pagamento, internacional sim/não)
- **sales_categories** — GOLD/Remodelação, Avaliações, Internacional, Tirzepatida, Bioestimulador, Implantes Hormonais, etc.
- **channels** — Instagram Orgânico, Paciente, Tráfego Pago, Indicação, TikTok, Site, Influenciadores
- **sellers** — vendedores da clínica
- **monthly_goals** — Meta 1/2/3 por mês
- **evaluations** — avaliações vendidas, compareceu, no-show, reagendamento

Tabelas existentes (`leads`, `conversations`, `messages`, `appointments`, `zapi_connections`, `qualification_criteria`, `facebook_webhook_config`) ganham coluna **`tenant_id`** + RLS por tenant.

Roles globais (`user_roles`) ganham `super_admin` (Posion) além de `admin`. Roles por tenant ficam em `tenant_users.role`.

## KPIs do Dashboard (derivados da planilha)

**Resumo Executivo**
- Faturamento do mês, Nº de vendas, Ticket médio
- Evolução trimestral com tendência (📈/📉)
- Atingimento de Meta 1, 2, 3 com % e diferença

**Funil / Avaliações** (KPIs principais que você pediu)
- Taxa de agendamento (agendados ÷ leads)
- Taxa de comparecimento (compareceram ÷ agendados)
- Taxa de no-show
- Taxa de conversão avaliação → venda
- Pipeline futuro (agendamentos do mês seguinte)

**Receita**
- Por canal (com variação mês a mês e ticket por canal)
- Por vendedor (ranking + variação)
- Por categoria de procedimento (GOLD, Avaliações, Internacional…)
- Receita internacional × nacional
- Receita reconhecida × caixa a entrar (vendas internacionais futuras)

**Temporal**
- Semana a semana com meta semanal
- Receita diária com destaques (maiores vendas)
- Heatmap dia da semana × volume

**Insights automáticos**
- Maior venda do mês, vendedor que mais cresceu, canal que disparou/caiu
- Pacientes recorrentes (cross-sell)
- Alertas: canais zerados, no-shows acima do benchmark

## Páginas / Rotas

```text
/                          → Landing Posion (mantém)
/login                     → Login unificado
/app                       → Redireciona p/ tenant do usuário
/app/:tenantSlug/dashboard → Dashboard Power BI
/app/:tenantSlug/whatsapp  → Central de conversas
/app/:tenantSlug/kanban    → Funil de pacientes
/app/:tenantSlug/pacientes → Lista de pacientes
/app/:tenantSlug/vendas    → Lista de fechamentos
/app/:tenantSlug/agenda    → Agendamentos
/app/:tenantSlug/config    → WhatsApp (Z-API: instance_id, token, client_token, webhook URL pronta p/ copiar), vendedores, metas, canais

/admin                     → Posion master (mantém o atual)
/admin/tenants             → CRUD de clínicas clientes
/admin/tenants/:id         → Visão da clínica (impersonate / métricas)
```

## Central WhatsApp

Mantemos a integração Z-API já existente, mas a UI de configuração mostra explicitamente os 4 campos pedidos:
- **Instance ID**
- **Token**
- **Client-Token**
- **Webhook URL** (gerada pelo sistema, com botão "Copiar") — apontando para a edge function `whatsapp-webhook` com `?tenant=<slug>`

Estrutura preparada para trocar de provider depois (campo `provider` em `zapi_connections`, hoje só `zapi`).

## Implementação por Fases

**Fase 1 — Fundação multi-tenant** (esta entrega)
1. Migration: criar `tenants`, `tenant_users`, `patients`, `sales`, `sales_categories`, `channels`, `sellers`, `monthly_goals`, `evaluations` + adicionar `tenant_id` nas tabelas existentes
2. RLS por tenant em todas as tabelas + função `has_tenant_access(tenant_id)`
3. Seed: cria o tenant "Posion" (admin master) e migra leads/conversations existentes para ele
4. Seed: cria o tenant "Instituto Roar" com TODOS os dados de maio da planilha (vendas, vendedores, canais, metas, avaliações)
5. Auth: roteamento `/app/:tenantSlug/*` com guard de acesso
6. Dashboard Power BI completo lendo dados reais (replicando as 7 abas da planilha)
7. Página de configuração WhatsApp com os 4 campos + URL do webhook copiável
8. Kanban + Lista de Pacientes + Lista de Vendas por tenant
9. Painel `/admin/tenants` para Posion criar/gerenciar clínicas

**Fase 2 (próximas entregas, não nesta)**
- Onboarding self-service de novo tenant
- Importação de Excel/CSV pela própria clínica
- Relatório PDF automático (espelho da planilha)
- Billing por tenant
- Multi-WhatsApp por tenant

## Pontos para Confirmar Antes de Codar

1. **Slug do primeiro tenant cliente:** confirmo `instituto-roar` para o Dr. Matheus?
2. **WhatsApp:** mantenho Z-API como provider padrão (já está montado) e deixo os 4 campos prontos — ok? Se quiser outro provider (Meta Cloud API, Evolution), me diga agora.
3. **Login:** um único login para Posion + clínicas (mesmo `/login`, redireciona pelo tenant do usuário) — ok?
4. **Dados da planilha:** vou carregar TODAS as vendas detalhadas da aba "Base Completa" no seed do Instituto Roar para o dashboard já nascer cheio — ok?

Se responder "pode seguir" sem comentar, assumo as 4 respostas acima como sim e começo pela Fase 1 inteira.
