## Problemas identificados
1. **Contratos duplicados (6 em vez de 3)** — em `isMasterAccount`, o `wins/revenue` é contado 2× no `load()` de `src/pages/app/TenantCampaigns.tsx`: uma vez ao iterar `leadRows` com `status='ganho'` (linhas 265-275) e outra ao iterar `agency_contracts` (linhas 279-296).
2. **Duas contagens de leads na mesma tela (346 no KPI vs 175 no funil visual)** — o KPI "Leads" usa `insights.leads` (Meta), enquanto o funil visual usa `globalStats.leads` (leads salvos no banco). Você definiu como verdade os **leads reportados pelo Meta**.
3. **Reuniões agendadas infladas (21)** — `globals.meetings` soma o `scheduledSet` (appointments com lead) + `unassignedAppointments` (appointments sem lead) + bump no loop de `leadRows` para `reuniao_agendada_em` quando o lead não está no `scheduledSet`. Um mesmo lead pode ter `reuniao_agendada_em` e também estar em `unassignedAppointments` via telefone não normalizado, gerando dupla contagem.
4. **CPL/CAC/Custo por reunião** — hoje dividem `spend` por bases diferentes; precisam usar a mesma fonte de leads (Meta) e a contagem corrigida de contratos/reuniões.

## Mudanças em `src/pages/app/TenantCampaigns.tsx`

### A. Contratos no Posion Master (única fonte = `agency_contracts`)
- No loop de `leadRows` (linhas 265-275), pular o incremento de `wins/revenue` quando `isMasterAccount === true`. Manter apenas o bloco de `agency_contracts` como fonte oficial de contratos e receita.
- Resultado: KPI "Contratos" = 3, "Receita" = soma real dos `valor_total` dos contratos assinados no período.

### B. Leads = Meta insights (unificado)
- Definir `kpis.leads = s.leads` (Meta insights) — já é assim no KPI top.
- No funil visual (`<CampaignFunnel leads={...}>`), trocar `globalStats.leads` por `kpis.leads` para que os dois blocos mostrem o mesmo número (346).
- CPL = `spend / kpis.leads` (já é).
- "Contato WhatsApp" no funil continua vindo de `globalStats.contacts` (leads que avançaram no CRM), pois é a única fonte real de conversão.

### C. Reuniões agendadas (sem dupla contagem)
- Consolidar em UMA fonte: contar `appointments` do período com `tenant_id IS NULL` (Master), deduplicando por `(lead_id OR client_phone normalizado OR date_time+client_phone)`.
- Remover o bump extra de `reuniao_agendada_em` no loop de `leadRows` para o total global (mantém apenas na atribuição por campanha `stats[k]`).
- `globals.meetings = tamanho do set deduplicado`; `globals.showed = subset com status ∈ {compareceu, realizado, fechado, confirmado}`.

### D. CAC e Custo por reunião
- CAC = `spend / wins` (wins agora = contratos reais = 3).
- Custo/Reunião = `spend / meetings` (meetings corrigido).
- Custo/Realizada = `spend / showed`.

## Fora do escopo
- Não mexer no funil da Clínica (tenant), só no Master.
- Não alterar coleta/sync do Meta — apenas usar o que já vem em `campaign_insights`.

## Resultado esperado
- KPI Leads = Funil Leads = 346 (Meta).
- Contratos = 3 (único, sem duplicação).
- Reuniões agendadas = valor real deduplicado (ex.: 4-8, conforme banco).
- CPL, CAC, ROAS recalculados com bases consistentes.
