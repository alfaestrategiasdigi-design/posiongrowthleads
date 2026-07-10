## Custo por Reunião (CPR) na página de Campanhas

Adicionar a métrica **CPR — Custo por Reunião (Compareceu)** em cada card de campanha na página `/admin/campanhas`.

### Regra de cálculo
- CPR = `spend da campanha` ÷ `nº de leads com status "compareceu" atribuídos à campanha`
- Se `compareceu = 0`, exibir `—` (evita divisão por zero)
- Mesma lógica de atribuição por nome (`matchCampaign`) já usada para Ganhos/Agendados

### Mudanças em `src/pages/admin/CampanhasPage.tsx`
1. Novo estado `crmCompByCampaign: Record<string, number>` ao lado de `crmApptsByCampaign`.
2. Em `attributeCrm`, adicionar uma segunda query (leads + agency_leads) filtrando `status = "compareceu"` e usar o mesmo helper `attributeAppt` (renomeado internamente ou duplicado como `attributeComp`) para contar por campanha.
3. Passar `crmComp` para o render do card.
4. Grid de micro métricas passa de `grid-cols-5` para `grid-cols-6`, inserindo o bloco **CPR** logo após **CPL**:
   - Label: `CPR`
   - Valor: `BRL(spend / crmComp)` ou `—`
   - Highlight verde quando `crmComp > 0`

### Fora de escopo
- Não altera Kanban, não altera contagem de "Agendados" (segue espelhando a coluna do Kanban).
- Não cria nova tabela nem migração — puro cálculo no frontend.