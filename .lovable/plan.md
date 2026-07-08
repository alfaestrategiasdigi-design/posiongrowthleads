## Problema
Na tabela `/admin/leads`, todos os leads aparecem apenas como "Facebook Ads" na linha, sem indicar de qual formulário vieram — dá a sensação de que estão todos amarrados ao primeiro formulário.

## Objetivo
Mostrar o nome real do formulário de cada lead na tabela e permitir filtrar por formulário.

## Alterações em `src/pages/admin/LeadsPage.tsx`

1. **Coluna "Nome" — subtítulo com o formulário**
   - Substituir o texto fixo "Facebook Ads" por: `Facebook Ads · <nome do formulário>` usando `lead.facebook_form_name` (fallback para o `facebook_form_id` quando não houver nome, e para "Facebook Ads" quando nenhum dos dois existir).

2. **Nova coluna "Formulário"** (entre "Clínica" e "Cidade")
   - Exibe `facebook_form_name` do lead; quando vazio, mostra o `facebook_form_id` em fonte mono. Para leads sem origem Facebook, mostra "—".
   - Ajustar o `colSpan` do estado vazio de 9 para 10.

3. **Filtro por formulário**
   - Adicionar um `<select>` na barra de filtros existente, populado a partir de `availableForms` (já carregado no state). Opções: "Todos os formulários" + cada `form_name` (ou `form_id`).
   - Aplicar o filtro em `filtered` (comparando `lead.facebook_form_id`).

4. **KPI/Resumo**
   - Manter o card "Origem Facebook Ads" como está (já agrupa por form). Sem mudanças aqui.

Sem mexer em backend, edge functions ou schema — os dados `facebook_form_id` / `facebook_form_name` já vêm nos leads.
