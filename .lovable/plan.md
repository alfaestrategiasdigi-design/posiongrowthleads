# Diagnóstico READ-ONLY — KPIs do dashboard

Nada foi alterado. Abaixo o que encontrei.

## 1. Qual dashboard e quais KPIs

Existem **dois** dashboards:

- **Tenant (clínica)** — `src/pages/app/TenantDashboard.tsx`, rota `/app/:tenantSlug/dashboard`. É o dashboard onde estão os KPIs de funil que você mencionou. Cards renderizados (linhas 501–559):
  - Qualificação = qualificados ÷ leads
  - **Agendamento** = agendados ÷ qualificados
  - **Comparecim.** = compareceu ÷ (compareceu + no-show)
  - **Fechamento** = ganho ÷ compareceu
  - No-show = no-show ÷ (compareceu + no-show)
  - Conv. Geral = ganho ÷ leads

  Fórmulas centralizadas em `src/lib/funnel-metrics.ts` (`computeFunnelMetrics`).

- **Admin Master** — `src/pages/admin/Dashboard.tsx`. KPIs de agência/SaaS (pipeline, contratos, MRR, clínicas ativas). Não tem os cards de funil clínico. Se o print for daqui, o "funil clínico" não existe nessa página por design.

## 2. Os dados existem no banco?

Sim para 3 clínicas, não para as demais. Contagens nos últimos 30 dias:

```text
tenant                       leads30  appt30  compareceu30  ganhos30
Dr Instituto Roar             1600     25       8            3
Fio terapia                   1276      0       0            0
Clínica Donna Face             110     24       8            2
Clínica Dr Gabriel Lourenço     58      4       2            0
Dr. Brenda Lima                  4      0       0            0
Dra Larissa Cangussu             0      0       0            0
amo.servicosmedicos              0      0       0            0
Dr Diego Lopes                   0      0       0            0
Dr Sergio                        0      0       0            0
MatheusBetSafe                   0      0       0            0
```

Todos os 25 appointments do Roar têm `lead_id` preenchido (o backfill funcionou). Status dos appointments do Roar: 17 `agendado` + 8 `compareceu`, **nenhum** `no_show`/`faltou`.

## 3. Causa provável dos "0%"

Depende de qual tenant você estava vendo. Duas causas distintas, e ambas são consistentes com o print:

### (a) Tenants sem agenda → 0% é o valor correto
Para Fio terapia, Brenda, Larissa, amo, Diego, Sergio, MatheusBetSafe **não existe nenhum appointment**. O cálculo devolve 0 legítimo para Agendamento/Comparecim./Fechamento. Não é bug de renderização — é ausência de dado. Se o dashboard aberto era um desses, o "zerado" reflete a realidade.

### (b) Tenants com agenda (Roar / Donna / Gabriel) — bug de truncamento silencioso no fetch de leads
`TenantDashboard.tsx` linhas 87–92 buscam **todos** os leads do tenant sem `.range()` nem `.limit()` explícito:

```ts
supabase.from("leads").select("id,status,created_at,nome_completo,whatsapp,mql,sql_qualified")
  .eq("tenant_id", tenant.id)
```

O PostgREST devolve no máximo **1000 linhas** por padrão. Roar tem **1631** leads (Fio 1276) → o array `leads` chega **truncado a 1000** e sem ordenação garantida, então `computeFunnelMetrics` recebe um subconjunto arbitrário. Consequência:

- `totalLeads`, `qualificados` e `ganhos` calculados no cliente ficam **subestimados de forma não determinística** entre reloads.
- Se os poucos leads qualificados/ganhos ficarem de fora do lote de 1000, as taxas caem para próximo de 0.

Isso explica por que o mesmo tenant pode mostrar KPIs "às vezes" e "às vezes zerado". Appointments (25 linhas) e sales (22 linhas) não sofrem — só a query de leads.

### (c) Descartadas após verificar
- `whatsapp_connections` com `.maybeSingle()`: só existe 1 row em todo o banco e é para `tenant_id = NULL`, então nenhum tenant real dispara o erro "multiple rows" que travaria o `Promise.all`. Não é essa a causa.
- Filtro de tenant nas queries: correto (`.eq("tenant_id", tenant.id)` em todas).
- Filtro de período: leads são filtrados só no cliente por `created_at` dentro do `range` (default 30d). Correto.
- Status de appointment: código aceita `compareceu`/`realizado` e `no_show`/`faltou`; combina com o que está no banco.

## 4. O que preciso de você antes de propor correção

- Qual tenant estava aberto quando você viu os 0%? Se for um da lista **sem appointments** (Fio, Brenda, etc.), é dado real e nada precisa ser "consertado" no código.
- Se for Roar / Donna / Gabriel, a correção é limitar/pagniar a query de leads (ou movê-la para o servidor com agregação) para não sofrer o corte de 1000 linhas do PostgREST. Posso detalhar isso num próximo plano quando você confirmar.

Nada foi tocado em agenda, formulários, webhook ou automações.
