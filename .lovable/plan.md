# Abrir detalhe completo do lead ao clicar num agendamento

## Comportamento hoje
Na Agenda, clicar num agendamento abre o dialog compacto "Editar agendamento". Você quer que, quando o agendamento estiver vinculado a um lead, abra o **mesmo modal completo do lead** que aparece no Kanban (com abas Resumo/Formulário/Qualificação SDR/Tarefas + seção de agendamentos).

## Mudanças em `src/pages/app/TenantAgenda.tsx`

1. Importar `LeadDetailModal` (`@/components/admin/LeadDetailModal`) e o tipo `Lead`.
2. Novo estado `selectedLead: Lead | null`.
3. Trocar `openEdit(id)` por `openAppointment(appt)`:
   - Se `appt.lead_id` existe → `supabase.from("leads").select("*").eq("id", appt.lead_id).single()` e setar `selectedLead` (abre LeadDetailModal com a seção "Agendamentos deste lead" já mostrando esse agendamento).
   - Se `appt.lead_id` for `null` (agendamento avulso) → continua abrindo o `AppointmentDialog` para editar/vincular. Dentro do dialog o usuário pode buscar/vincular um lead e o trigger de banco preenche `lead_id`.
4. Passar a nova função para `MonthView`, `WeekView`, `DayView` e `ApptChip` (troca a prop `onEdit: (id) => void` por `onOpen: (a: Appointment) => void`).
5. Renderizar `<LeadDetailModal lead={selectedLead} open={!!selectedLead} onClose={() => setSelectedLead(null)} onUpdated={() => { setSelectedLead(null); load(); }} />` junto do `AppointmentDialog`.

## Fora de escopo
- Não mexer no `AppointmentDialog` nem no `LeadDetailModal` — apenas orquestrar qual abrir.
- Não mudar o comportamento do botão "Novo Agendamento" (continua abrindo o dialog vazio).
