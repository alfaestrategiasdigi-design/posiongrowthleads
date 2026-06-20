## Dashboard Master: deixar óbvio que só 1 de 4 tenants tem dados

Hoje o Dashboard master (`/admin`) soma silenciosamente todos os tenants, e como só o **Instituto Roar** tem dados, parece que os números são "do admin" — mas são na verdade só de 1 cliente.

Vou adicionar **as duas coisas** ao topo do Dashboard (só quando `tenantFilter === "all"`):

### 1) Badge "X de Y ativos" ao lado do seletor
- Conta tenants com `leads > 0 || receita > 0 || investido > 0` no período.
- Exibe `1 de 4 ativos` em badge âmbar quando `X < Y`, verde quando `X === Y`.
- Tooltip ao passar o mouse: lista os inativos ("Sem dados: Dr Gabriel Lourenço, Donna Face, Dr. Brenda Lima").
- Clique no badge → abre breakdown completo (item 2).

### 2) Card "Distribuição por cliente" (mini-lista)
Card colapsável logo abaixo dos KPIs, com 1 linha por tenant ordenada por receita desc:

```
┌─────────────────────────────────────────────────────┐
│ Distribuição por cliente · 4 clientes               │
├─────────────────────────────────────────────────────┤
│ ● Dr Instituto Roar      R$ 99.810  ·  20 vendas    │
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100%             │
│ ○ Clínica Dr Gabriel L.  R$ 0       ·  sem dados    │
│ ○ Clínica Donna Face     R$ 0       ·  sem dados    │
│ ○ Dr. Brenda Lima        R$ 0       ·  sem dados    │
└─────────────────────────────────────────────────────┘
```

- Cada linha mostra: nome, receita (R$), nº vendas, barra de % da receita total, e badge "sem dados" para tenants vazios.
- Clique numa linha → seta `tenantFilter` para aquele tenant (drill-in).
- Só aparece no modo "Todos locatários" (some quando um cliente está filtrado).

### Arquivo único alterado
`src/pages/admin/Dashboard.tsx`
- Calcular `byTenant = [{ id, name, leads, revenue, invested, sales }]` agregando `fLeads/fSales/fSpends` (já existem no escopo).
- `activeCount = byTenant.filter(t => t.leads || t.revenue || t.invested).length`.
- Renderizar Badge no header (ao lado do select de tenant) e Card de breakdown após a grid de KPIs.

### Fora do escopo
- Não muda lógica de agregação dos KPIs (continuam somando tudo).
- Não toca em RLS, schema ou outras páginas.
