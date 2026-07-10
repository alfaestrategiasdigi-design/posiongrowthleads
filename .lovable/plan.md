## Corrigir espaço preto vazio no card "Faturamento do período"

**Causa:** o grid `lg:grid-cols-3` (linha 343 de `src/pages/app/TenantDashboard.tsx`) estica por padrão todas as colunas para a mesma altura. A coluna direita tem 3 KPIs empilhados e fica alta; o hero à esquerda, com gráfico fixo em `h-40` (~160px), estica junto e sobra área preta abaixo do gráfico.

### Alterações em `src/pages/app/TenantDashboard.tsx`

1. **Grid do hero (linha 343):** trocar
   ```
   <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
   ```
   por
   ```
   <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
   ```
   Assim o card de faturamento passa a ter altura automática e não é mais esticado até a altura da coluna de KPIs.

2. **Altura do gráfico (linha 387):** trocar `h-40` por `h-[280px]` para dar ao gráfico uma altura proporcional e legível. `ResponsiveContainer width="100%" height="100%"` continua válido porque o wrapper agora tem altura fixa definida.

3. Nenhum `min-height` ou `padding-bottom` extra a remover — o problema é só o stretch do grid + gráfico curto.

### Fora do escopo
- Sem mudanças em cores, tipografia, KPIs da direita, filtros ou lógica de dados.
- Sem mexer em `premium-hero` / `premium-card` no CSS global.
