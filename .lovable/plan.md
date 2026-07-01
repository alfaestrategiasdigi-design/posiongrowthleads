## Problema
Os 112 leads do formulário continuam no banco (`leads`), mas o item "Kanban" do menu foi redirecionado para o novo **Pipeline Agência**, que lê de `agency_leads` (vazio). Por isso parece que sumiram — na verdade só o atalho está errado.

## Correção (pequena, cirúrgica)

1. **Restaurar o Kanban de leads do formulário**
   - `src/App.tsx`: trocar o redirect `/admin/kanban → /admin/pipeline` de volta para renderizar o `KanbanPage` original (que consulta `from("leads")`).
   - `src/components/admin/AppSidebar.tsx`: adicionar item **"Kanban de Leads"** no grupo *Marketing*, apontando para `/admin/kanban`, ícone `KanbanSquare`.

2. **Manter o Pipeline Agência intacto**
   - `/admin/pipeline` continua com `AgencyPipelinePage` para vendas da agência POSION (funil de fechar novas clínicas). Sem mudança nesse arquivo.

3. **Aplicar o visual "novo Kanban" no Kanban de leads**
   - Reaproveitar o mesmo estilo de coluna/card usado em `AgencyPipelinePage` (ícones, cores, contadores) dentro de `src/components/admin/KanbanBoard.tsx` — o componente já existe e usa `PIPELINE_STAGES`; ajustar apenas paddings/tipografia para bater com o Pipeline Agência.
   - Nada é apagado, nenhum lead é migrado.

## Resultado esperado
- **`/admin/kanban`** → mostra os 112 leads do formulário (Facebook + site + whatsapp) no funil de 8 etapas, com o visual novo.
- **`/admin/pipeline`** → continua sendo o funil de vendas da agência (clínicas prospectadas).
- **`/admin/leads`** → tabela dos leads do formulário (já corrigida antes).

## Escopo
Somente 2 arquivos alterados (`App.tsx`, `AppSidebar.tsx`) + refino de estilo em `KanbanBoard.tsx`. Sem migration, sem edge function, sem risco para os dados.