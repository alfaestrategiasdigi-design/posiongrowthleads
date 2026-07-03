## Objetivo

Criar um **painel de detalhes do lead unificado**, usado igual em Lista de Leads, Kanban, Pipeline Agência e Agenda. O painel mostra o contexto do lead, permite qualificação SDR no formato GPCT, guarda respostas do formulário, e adiciona uma aba de Tarefas com sub-tarefas e comentários.

## Estrutura do painel

Um único componente `UnifiedLeadPanel` (drawer/lateral em telas grandes, dialog em mobile) com 4 abas:

1. **Resumo** — nome, WhatsApp (com botão de conversa), empresa, cidade, volume/faturamento, valor da proposta, etapa do pipeline, origem, botão de editar etapa e valor, notas comerciais.
2. **Formulário** — campos capturados do Meta Lead Ads / formulário de captação (respostas originais, campanha, UTM). Somente leitura.
3. **Qualificação SDR (GPCT)** — 4 campos textuais + score 0-100 + observações do SDR.
4. **Tarefas** — checklist livre com sub-tarefas e comentários por tarefa.

O painel funciona em modo polimórfico: recebe `{ source: "lead" | "agency_lead", id }` e resolve internamente qual tabela consultar/atualizar. Um adaptador normaliza os dois schemas em um "view model" único (nome, contato, empresa, volume, etc.).

## Mudanças no banco

Novas colunas / tabelas via migration:

- `leads.sdr_qualification` `jsonb` — `{ goals, plans, challenges, timeline, score, notes, updated_at, updated_by }`
- `agency_leads.sdr_qualification` `jsonb` — mesma estrutura
- Nova tabela `lead_tasks`:
  - `id`, `parent_task_id` (self-ref para sub-tarefas), `lead_id` (FK opcional a `leads`), `agency_lead_id` (FK opcional a `agency_leads`), `tenant_id` (opcional), `title`, `done`, `due_date`, `assignee_user_id`, `position`, `created_at`, `updated_at`
  - CHECK garante exatamente um de `lead_id` / `agency_lead_id` preenchido
- Nova tabela `lead_task_comments`:
  - `id`, `task_id` FK `lead_tasks`, `author_user_id`, `body`, `created_at`
- RLS: admin (POSION) faz tudo; membros do tenant enxergam somente tarefas cujo `lead_id` pertence ao seu tenant (via `has_tenant_access`). `agency_leads` fica restrito a admin (já é).
- GRANTs para `authenticated` + `service_role` conforme padrão.

## Integração nas telas

- **`LeadsPage` + `KanbanBoard`**: substituem `LeadDetailModal` por `UnifiedLeadPanel` com `source="lead"`. Mantém realtime já existente.
- **`AgencyPipelinePage`**: hoje tem editor inline próprio. Passa a abrir `UnifiedLeadPanel` com `source="agency_lead"` no clique do card, mantendo drag-and-drop de etapa.
- **`AppointmentModal` (Agenda)**: quando o agendamento estiver vinculado a um `agency_lead_id`, exibe um bloco compacto "Contexto do lead" (nome, WhatsApp, empresa, volume) direto no modal e um botão **"Abrir painel completo"** que abre `UnifiedLeadPanel` sobre o modal. Para permitir isso, `appointments` ganha coluna `agency_lead_id uuid` (FK opcional a `agency_leads`) além do `lead_id` já existente, e o selector de lead no modal grava o id no campo certo conforme a origem.

## Aba de Tarefas — comportamento

- Lista as tarefas de nível 0 ordenadas por `position`.
- Cada tarefa tem checkbox, título editável inline, prazo, responsável, botão de expandir sub-tarefas e ícone de comentários com contador.
- Ao expandir, mostra sub-tarefas (mesma estrutura, um nível de profundidade) e um painel de comentários com input de novo comentário.
- Adicionar tarefa: input rápido no topo. Adicionar sub-tarefa: botão dentro da tarefa expandida.
- Realtime opcional (mesmo canal já usado nas outras telas) para refletir mudanças multi-usuário.

## Aba Qualificação SDR (GPCT)

Formulário com:
- `Goals` (textarea) — objetivos do lead
- `Plans` (textarea) — planos atuais para atingir os objetivos
- `Challenges` (textarea) — desafios/dores
- `Timeline` (select: imediato / 30d / 60-90d / >90d / indefinido)
- `Score` (slider 0-100 com badge colorida: <40 frio, 40-70 morno, >70 quente)
- `Notas do SDR` (textarea)
- Botão "Salvar qualificação" que grava em `sdr_qualification` do lead correspondente e registra `updated_by` + `updated_at`.

## Arquivos a criar / editar

Criar:
- `src/components/leads/UnifiedLeadPanel.tsx` — shell com abas
- `src/components/leads/panel/LeadSummaryTab.tsx`
- `src/components/leads/panel/LeadFormAnswersTab.tsx`
- `src/components/leads/panel/LeadSDRTab.tsx`
- `src/components/leads/panel/LeadTasksTab.tsx`
- `src/components/leads/panel/LeadContextCard.tsx` — bloco compacto usado dentro do AppointmentModal
- `src/hooks/useUnifiedLead.ts` — adaptador que carrega/salva dependendo de `source`
- `src/hooks/useLeadTasks.ts` — CRUD tarefas + subtarefas + comentários
- Migration SQL nova

Editar:
- `src/pages/admin/LeadsPage.tsx` — trocar `LeadDetailModal` por `UnifiedLeadPanel`
- `src/components/admin/KanbanBoard.tsx` — mesma troca
- `src/pages/admin/AgencyPipelinePage.tsx` — abrir `UnifiedLeadPanel` no clique
- `src/components/admin/AppointmentModal.tsx` — embutir `LeadContextCard` + botão para o painel completo; gravar `agency_lead_id`

Manter (deprecado, mas sem remover ainda para evitar quebrar imports externos):
- `src/components/admin/LeadDetailModal.tsx` — passa a re-exportar `UnifiedLeadPanel` com `source="lead"` para retrocompatibilidade.
