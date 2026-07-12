## Objetivo

O funil do Posion Master (conta de agência) deve ter **exatamente o mesmo layout, mesmas métricas e mesmas fontes de dados** do funil das clínicas — a única diferença é o rótulo: onde na clínica é "Consulta", na agência é "Reunião". Custo/Reunião, CAC, Ticket, Receita e ROAS continuam existindo, calculados igual.

## O que muda em `src/pages/app/TenantCampaigns.tsx`

1. **Remover o bloco alternativo "Captação · Agência"** que eu tinha criado (ele escondia os KPIs de reunião/CAC).
2. **Restaurar os 3 blocos originais** (Mídia · Meta Ads, Funil, Resultado · CRM) e o `CampaignFunnel` visual para o Posion Master também.
3. **Parametrizar apenas os rótulos** com base em `isMasterAccount`:
   - Título do bloco: `Funil da Clínica` → `Funil da Agência`
   - `Consultas Agendadas` → `Reuniões Agendadas`
   - `Custo/Consulta` → `Custo/Reunião`
   - `Consultas Realizadas` → `Reuniões Realizadas`
   - `Custo/Realizada` (mantém)
   - `Taxa de Show` (mantém)
   - Bloco Resultado: `Vendas` → `Contratos` no Posion Master; demais mantêm (Ticket Médio, Receita, CAC, ROAS real)
4. **Passar rótulos customizados para o `CampaignFunnel`** (novo prop opcional `labels`) para que o funil visual mostre "Reunião Agendada / Reunião Realizada / Contrato" no Posion Master. Nenhum cálculo muda.

## O que muda em `src/components/campaigns/CampaignFunnel.tsx`

- Adicionar prop opcional `labels?: { appointments?: string; showed?: string; sales?: string; appointmentCost?: string; showedCost?: string; cac?: string; title?: string }` e usar nos steps quando fornecido. Sem labels, mantém os textos atuais (clínica).

## Fonte de dados (sem alteração)

- **Reuniões Agendadas** = `kpis.appointments` — vem de `appointments` (agenda) + `leads.reuniao_agendada_em`, filtrado por `tenant_id = 00000000-0000-0000-0000-000000000001` para o Posion Master. Já funciona hoje.
- **Reuniões Realizadas** = `kpis.showed` — `appointments.status ∈ (compareceu, realizado, fechado, confirmado)`.
- **Custo/Reunião** = `spend / appointments` — cálculo já existente `kpis.cost_per_appointment`.
- **CAC** = `spend / wins` (leads com `status = 'ganho'`) — inalterado.
- **Receita / Ticket / ROAS** — inalterados.

## Resultado esperado

Na página `/admin/campanhas` (aba Posion Master) o usuário vê o mesmo dashboard visual das clínicas, com Custo/Reunião, CAC, Ticket Médio, Receita e ROAS presentes, buscando das mesmas tabelas (`appointments`, `leads`, `campaign_insights`), só com os rótulos trocados para o contexto de agência.
