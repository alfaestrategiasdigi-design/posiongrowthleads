## Objetivo

1. Ao abrir um lead no `UnifiedLeadPanel`, quando ainda não houver tarefas cadastradas, semear automaticamente um **checklist sugerido** baseado no valor do campo **"Você compra para"** (`leads.tipo_purchase` / `agency_leads`) combinado com a faixa do **Score SDR** (frio / morno / quente).
2. Reorganizar a sidebar do admin master: mover **WhatsApp Master**, **Leads (formulário)** e **Qualificação** para dentro do grupo **Agência POSION**.

---

## 1. Template de tarefas sugeridas

### Onde acontece
- Novo helper `src/lib/lead-task-templates.ts` com:
  - `getSuggestedTasks({ tipoPurchase, sdrScore, source }) → { key: string; title: string; subtasks?: string[] }[]`
  - Constante `TEMPLATE_VERSION = 1` — cada tarefa criada guarda `template_key` para não duplicar caso o painel reabra.
- `LeadTasksTab` recebe `lead` (não só id) e, no primeiro load, se `tasks.length === 0`, mostra um bloco **"Sugestões de tarefas para este lead"** com as sugestões do template + botão **"Aplicar todas"** e checkbox por item para aplicar seletivamente.
  - Nada é criado silenciosamente — o SDR clica para aplicar, evitando poluir leads antigos.
  - Após aplicar, as tarefas viram `lead_tasks` normais (com sub-tarefas conforme template), e o bloco de sugestões some.

### Regras de sugestão

Base por **`tipo_purchase`** (fallback "outro" quando nulo). Como os rótulos exatos vinculados a esse campo no formulário não são conhecidos em código, o helper normaliza por palavras-chave (`clinica|proprio|uso` → uso próprio, `revenda|distribui` → revenda, `iniciante` → iniciante) e cai em "outro" quando não bate.

- **Uso próprio / clínica própria**
  - Confirmar CNPJ e nome da clínica
  - Levantar volume atual de pacientes / procedimentos
  - Mapear ferramentas de gestão atuais
  - Agendar diagnóstico com especialista POSION
- **Revenda / distribuidor**
  - Validar região de atuação e portfólio
  - Levantar volume mensal de compra
  - Enviar tabela de revenda
  - Alinhar condições comerciais
- **Iniciante / ainda pesquisando**
  - Enviar material educativo (case + vídeo)
  - Qualificar orçamento disponível
  - Explorar timeline de decisão
- **Outro / não informado**
  - Confirmar objetivo da compra
  - Coletar dados básicos faltantes

### Regras por **Score SDR**
Adicionadas independentemente da faixa de `tipo_purchase`:

- **Quente (≥70)**: "Agendar reunião de proposta em ≤48h", "Preparar proposta comercial personalizada", "Enviar mensagem de follow-up no WhatsApp hoje"
- **Morno (40–69)**: "Enviar case de sucesso do segmento", "Agendar call de descoberta em 5 dias", "Registrar próximo touchpoint"
- **Frio (<40) ou sem score**: "Nutrir com conteúdo (2 mensagens em 7 dias)", "Reagendar qualificação em 15 dias"

### Detalhes técnicos
- `useLeadTasks` ganha método `bulkInsert(items)` que insere pai + subtarefas mantendo `position` sequencial e `template_key` em uma nova coluna `template_key text` de `lead_tasks` (migration curta, sem RLS nova).
- `LeadTasksTab` importa `getSuggestedTasks` e o hook, mostra sugestões apenas quando `!loading && tasks.length === 0`.
- Nenhuma alteração no fluxo manual de criar tarefa/subtarefa/comentário.

---

## 2. Sidebar — mover itens para "Agência POSION"

Editar apenas `src/components/admin/AppSidebar.tsx` (`navGroups`):

**Grupo "Agência POSION"** passa a conter, nesta ordem:
1. Dashboard
2. Pipeline Agência
3. Leads (formulário) — movido de Marketing
4. Qualificação — movido de Marketing
5. Agenda de Reunião
6. WhatsApp Master — movido de Operação Master
7. Contratos

**Grupo "Marketing"** fica só com: Campanhas Meta, Conexão Facebook, Conversions API.

**Grupo "Operação Master"** fica só com: Conexão WhatsApp, Status WhatsApp, Usuários & Convites.

Manter as flags `comercial: true` existentes (Leads formulário e WhatsApp Master já têm; Qualificação continua sem — só master vê).

---

## Arquivos

**Criar**
- `src/lib/lead-task-templates.ts`
- Migration adicionando coluna `template_key text` em `lead_tasks`

**Editar**
- `src/components/leads/panel/LeadTasksTab.tsx` — bloco de sugestões + apply
- `src/hooks/useLeadTasks.ts` — `bulkInsert`
- `src/components/leads/UnifiedLeadPanel.tsx` — passar `lead` para a tab (se ainda não passa)
- `src/components/admin/AppSidebar.tsx` — reordenação de grupos
