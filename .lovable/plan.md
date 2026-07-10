# Sincronizar Agenda ↔ Lead ↔ Kanban (tenant)

## Problema
No detalhe do lead aparece "Agendamentos deste lead (0)", mas a Agenda do tenant já tem 10 consultas marcadas. Isso acontece porque `appointments.lead_id` está nulo — a Agenda hoje permite criar consulta só com nome/telefone, sem casar com o lead. Resultado: nada aparece no lead nem no card do Kanban.

## Objetivo
1. Detalhe do lead lista todas as consultas dele (as antigas + novas), com data/hora.
2. Card do Kanban mostra a próxima consulta agendada.
3. Toda nova consulta criada na Agenda gruda automaticamente no lead pelo telefone.
4. Consultas antigas órfãs são vinculadas de uma vez (backfill).

## Mudanças

### 1. Backfill — vincular consultas existentes (migração SQL)
- `UPDATE appointments SET lead_id = l.id` onde `lead_id IS NULL` e `normalize_phone(client_phone) = normalize_phone(l.whatsapp)` dentro do mesmo `tenant_id`. Usa a função `normalize_phone` que já existe.

### 2. Auto-vínculo permanente (trigger)
- Novo trigger `trg_link_appointment_to_lead` em `appointments` (BEFORE INSERT OR UPDATE): se `lead_id` vier nulo e houver `client_phone`, procura o lead do mesmo tenant com telefone equivalente e preenche `lead_id`. Espelha o padrão já usado por `trg_link_conversation_to_lead`.

### 3. `LeadAppointmentsSection` — buscar também por telefone
- Ampliar o `select` para trazer consultas com `lead_id = leadId` **OU** (mesmo tenant + `normalize_phone(client_phone) = normalize_phone(leadPhone)`). Como PostgREST não roda `normalize_phone`, fazer duas queries em paralelo e mesclar por id, mostrando data completa (`dd/MM/yyyy HH:mm`) em vez de só `dd/MM`.

### 4. Card do Kanban — próxima consulta
- Em `TenantKanban.tsx`, no fetch principal, trazer a próxima consulta futura por lead (`appointments` filtrado por `tenant_id`, `date_time >= now()`, agrupado por `lead_id`, ordenado ASC, limite 1 por lead). Renderizar no card um badge discreto tipo `📅 15/07 14:00` abaixo do nome, quando existir.

### 5. Consistência com admin master
- O admin master já usa o mesmo componente `LeadAppointmentsSection`? Verificar rapidamente na implementação; se sim, as mudanças 1–3 cobrem os dois lados automaticamente. Se o admin usa outro componente, aplicar o mesmo select ampliado lá.

## Fora de escopo
- Não mudar o layout do `AppointmentDialog`, só garantir que o `lead_id` seja preenchido (o trigger cobre).
- Não mexer em RLS — as políticas atuais de `appointments` já filtram por tenant.
