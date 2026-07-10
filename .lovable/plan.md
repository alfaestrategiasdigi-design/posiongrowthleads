## 1. Dashboard tenant — hero menor

Em `src/pages/app/TenantDashboard.tsx`:
- Voltar o gráfico do card "Faturamento do período" para altura fixa compacta (`h-40` em vez do `flex-1 min-h-[220px]` atual).
- Remover o `flex flex-col` do container do hero para o card parar de esticar até a altura da coluna de KPIs. Assim o hero passa a ter altura natural (título + valor + gráfico) e os 3 KPIs à direita definem a altura da linha.

Resultado: hero deixa de ter aquele espaço vazio gigante e fica proporcional aos KPIs.

## 2. Kanban — filtros de busca e período

Em `src/pages/app/TenantKanban.tsx`, adicionar uma barra de filtros logo abaixo do título, acima do `<KanbanBoard>`:

- **Busca (texto)**: filtra por `nome_completo`, `whatsapp`, `email`, `facebook_campaign`. Input com ícone de lupa, atualização em tempo real.
- **Período (chips)**: Hoje · 7 dias · 30 dias · 90 dias · Tudo. Aplica sobre `created_at`. Default: "Tudo" (mantém comportamento atual).
- **Contador**: substituir "95 leads" por "X de 95 leads" quando algum filtro estiver ativo.

Implementação:
- Novos states: `search: string`, `rangeDays: number | null` (null = tudo).
- `filteredLeads = useMemo(...)` aplicando ambos os filtros sobre `leads`.
- Passar `filteredLeads` para `<KanbanBoard leads={...} />` e para o export CSV.
- Layout dos filtros: `flex flex-wrap gap-2` — input de busca à esquerda (max-w-sm) + chips de período à direita, alinhado com o botão Exportar CSV.

Nenhuma mudança em `KanbanBoard.tsx` — ele já recebe a lista pronta.

## Fora do escopo
- Não mexer em lógica de drag-and-drop, realtime ou stages do Kanban.
- Não alterar filtros do Dashboard.
