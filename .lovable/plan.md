
## Objetivo
Fazer com que **Agenda, Kanban e Leads** operem como uma coisa só dentro de cada tenant:
- Toda ação numa dessas telas reflete automaticamente nas outras.
- Leads são reaproveitados por telefone (ou nome, quando telefone não bate) — nunca duplicados.
- Se criar um agendamento sem lead, o lead nasce junto. Se mover no Kanban, a data/etapa da agenda acompanha.
- Corrigir cards do dashboard do tenant que estão com texto cortado / mal dimensionados.

Escopo: **apenas o app do tenant** (rotas `/app/:slug/*`). Não muda master.

---

## 1. Sincronização Agenda → Kanban (server-side, via trigger)

Hoje existe `trg_link_appointment_to_lead` que só preenche `lead_id` por telefone. Vou:

**1.1. Estender esse trigger** para também casar por **nome normalizado** quando o telefone não encontra nada (ilike do primeiro+último nome dentro do tenant, mesma janela). Só faz match se resultado for único — evita colar em pessoa errada.

**1.2. Criar `lead` automaticamente se ainda assim não achar** (só quando `NEW.tenant_id` não é null): insere `leads(tenant_id, nome_completo=client_name, whatsapp=client_phone, origem='agenda', status='reuniao_agendada')` e amarra `NEW.lead_id`. Assim "lead criado dentro da agenda também vira lead no Kanban" — exatamente o pedido.

**1.3. Novo trigger `trg_sync_lead_stage_from_appointment`** (AFTER INSERT/UPDATE OF status, date_time em appointments):
- `agendado` / `reagendado` → se lead está em `lead|qualificado|agendar_reuniao`, promove para `reuniao_agendada` e grava `reuniao_agendada_em`.
- `compareceu` (o "em consulta") → grava `reuniao_realizada_em` e, se etapa < `proposta`, move para `proposta`. Não regride ninguém que já está em `negociacao/ganho/ativo`.
- `no_show` → grava evento em `lead_status_events` (sem mexer no status atual — a SDR decide se perde).
- `cancelado` → limpa `reuniao_agendada_em` só se não houver outro appointment futuro do mesmo lead.

Idempotente: só age quando `OLD IS DISTINCT FROM NEW` no campo relevante.

## 2. Sincronização Kanban → Agenda (client-side, `KanbanBoard.tsx`)

No `handleDrop`, ao mover para `reuniao_agendada`:
- Verificar se já existe appointment futuro (`date_time >= now`, status ∉ cancelado/no_show) para o lead.
- Se **não existir**, abrir modal rápido para escolher data/hora (reaproveita `AppointmentDialog` com `prefillLead`) — sem isso a etapa fica inconsistente. Usuário confirma ou cancela a movimentação.

Ao mover para `perdido` ou `cancelado`: perguntar se deseja cancelar appointments futuros daquele lead (chamada em lote, opcional).

## 3. Deduplicação/vinculação no `AppointmentDialog`

- Ao digitar telefone no campo, **auto-buscar lead do tenant por telefone normalizado** (debounced 400ms) e sugerir vincular ("Encontramos João Silva com este número — vincular?"). Se aceitar, preenche `lead_id`.
- Fallback por nome: se telefone não bate e nome informado bate exato com um único lead do tenant → sugerir vinculação.
- Se usuário salvar sem lead vinculado e o trigger criar um lead novo, mostrar toast "Lead criado automaticamente" (usando `RETURNING` via re-select do appointment após insert).

## 4. Criar lead a partir da Agenda (fluxo explícito)

Adicionar no `AppointmentDialog`, quando não há `lead_id` selecionado, um botão secundário **"Criar como novo lead"** que força o comportamento (mesmo se houver match parcial suspeito).

## 5. Correção visual dos cards do Dashboard do tenant

Arquivo: `src/pages/app/TenantDashboard.tsx`.

Problemas observados nos `KpiCard` / `KpiPremium`:
- `whiteSpace: nowrap` + `overflow: hidden` + `textOverflow: ellipsis` corta valores longos (ex.: `R$ 1.245.000`) em cards estreitos no grid responsivo.
- Label em `uppercase` com `letter-spacing: 0.18em` estoura em telas médias.

Ajustes (apenas apresentação):
- `KpiPremium`: trocar a lógica de `fontSize` fixa por `clamp()` responsivo, permitir quebra em 2 linhas no `value` para números muito longos, e adicionar `min-width: 0` no wrapper do grid.
- `KpiCard` (legacy): idem — remover `whiteSpace: nowrap` do valor, aplicar `text-2xl md:text-3xl` e `break-words` no label.
- Ajustar o grid pai dos KPIs para `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` (ou `auto-fit,minmax(220px,1fr)`) evitando 5+ cards espremidos.
- Revisar os `Card` de "Atingimento de Metas" / "Evolução Trimestral" para `md:grid-cols-3` → `sm:grid-cols-2 lg:grid-cols-3` com `gap-3` menor.

## 6. Testes / verificação
- SQL: rodar migration em ambiente e verificar cadeia:
  1. Criar appointment com telefone existente → `lead_id` preenchido e status do lead promovido para `reuniao_agendada`.
  2. Criar appointment com telefone novo → lead novo criado, aparece no Kanban.
  3. Marcar como `compareceu` → lead vai para `proposta` e grava `reuniao_realizada_em`.
- UI: mover card do Kanban para `reuniao_agendada` sem appointment → modal abre; após salvar, aparece na Agenda com o horário escolhido.
- Dashboard: abrir Instituto Roar em 1280px e 1440px, confirmar que valores como `R$ 1.245.000` e labels longos não são mais cortados.

---

## Arquivos afetados

**Migration SQL nova**
- `supabase/migrations/<timestamp>_agenda_kanban_sync.sql`
  - Reescreve `trg_link_appointment_to_lead` (match por telefone + nome + criação de lead).
  - Cria função e trigger `trg_sync_lead_stage_from_appointment`.

**Frontend**
- `src/components/tenant/AppointmentDialog.tsx` — sugestão de match ao digitar telefone/nome, botão "Criar como novo lead", refresh do lead após save.
- `src/components/admin/KanbanBoard.tsx` — ao drop em `reuniao_agendada` sem appointment futuro, abrir `AppointmentDialog` com `prefillLead`; ao drop em `perdido/cancelado`, opção de cancelar appointments futuros.
- `src/pages/app/TenantDashboard.tsx` — ajustes visuais em `KpiCard`, `KpiPremium` e grid dos KPIs.

Nada de business logic fora desses pontos; sem mudanças no master, no WhatsApp ou nas automações existentes (o trigger de automações continua reagindo aos INSERTs de leads gerados pela agenda, então já vai disparar o fluxo `lead_entered` normalmente — o guard de 10 min impede reentrada).
