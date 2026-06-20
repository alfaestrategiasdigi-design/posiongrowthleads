## Painel de Vendas (Admin Master) dentro do Dashboard

Duas seções colapsáveis novas no `/admin` (Painel Comercial), visíveis apenas no modo "Todos locatários" e somente para `role=admin`. Sem rotas novas.

### Seção A — "Vendas (operação comercial dos clientes)"
Consolida `public.sales` de todos os tenants no período selecionado. Mostra a operação comercial interna que cada cliente está fazendo (procedimentos vendidos a pacientes).

KPIs no topo da seção:
- Receita total (R$), Vendas (n°), Ticket médio, % Pagas / Parciais / Pendentes, Internacionais.

Visualizações:
- **Ranking de clientes** (mesma estrutura do card "Por cliente" que já existe): receita, n° vendas, ticket médio, barra de %.
- **Top 5 vendedores** (`seller_name`): receita + n° vendas.
- **Mix por categoria** (donut `procedure_category`).
- **Tendência diária** de receita (área).
- **Pagamentos**: barra empilhada Pago / Parcial / Pendente por cliente.

Fonte: `sales` já carregada no Dashboard — só agregamos.

### Seção B — "SaaS & Contratos"
Faturamento da plataforma (o que o admin master cobra de cada cliente). Hoje não há tabela; crio `saas_contracts` mínima.

Nova tabela `public.saas_contracts`:
```
id uuid PK
tenant_id uuid FK tenants
plan text                         -- 'starter' | 'growth' | 'scale' | 'enterprise' | custom
status text                       -- 'active' | 'trial' | 'past_due' | 'canceled'
mrr numeric(12,2) not null        -- valor mensal
billing_cycle text                -- 'monthly' | 'yearly'
started_at date not null
renews_at date
canceled_at date
notes text
created_at, updated_at timestamptz
```
+ GRANTs + RLS: SELECT/INSERT/UPDATE/DELETE só para `has_role(auth.uid(),'admin')`. service_role full.

KPIs da seção:
- **MRR total** (somatório `mrr` onde status='active').
- **ARR** (MRR × 12).
- **Clientes ativos / em trial / inadimplentes / cancelados**.
- **Ticket médio (ARPA)** = MRR / clientes ativos.
- **Churn no período** (cancelados no período / ativos início).

Visualizações:
- **Tabela de contratos**: cliente, plano, status (badge), MRR, ciclo, renovação, ações (editar/cancelar) via dialog inline.
- **Botão "Novo contrato"** abre dialog (tenant select + plano + MRR + ciclo + data início).
- **MRR por plano** (barra horizontal).
- **Receita SaaS últimos 12 meses** (área, derivada de `mrr × meses ativos`).

### Layout
Logo após o card "Por cliente" já existente, adiciono duas abas (`Tabs` shadcn): "Operação dos clientes" | "SaaS & contratos". Persistência via URL hash (`#vendas-operacao` / `#vendas-saas`).

### Arquivos
- **Migration**: cria `saas_contracts` + RLS + GRANTs.
- **Novo**: `src/components/admin/dashboard/SalesPanel.tsx` — encapsula as 2 abas para não inflar `Dashboard.tsx`.
- **Novo**: `src/components/admin/dashboard/SaasContractDialog.tsx` — criar/editar contrato.
- **Edit**: `src/pages/admin/Dashboard.tsx` — carregar `saas_contracts` (só se admin) e renderizar `<SalesPanel>` após o breakdown por cliente.

### Fora do escopo
- Cobrança automática / integração com gateway de pagamento (Stripe/Paddle). Os contratos são registro manual de MRR por enquanto.
- Faturas/invoices individuais (pode vir depois se quiser).
- Página dedicada `/admin/vendas` (mantemos tudo no Dashboard como pedido).
