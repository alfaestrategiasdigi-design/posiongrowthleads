## Reformulação visual — sistema todo em tema claro, no padrão da tela "Leads"

Vou unificar POSION num único padrão claro/profissional (fundo creme, cards brancos, texto escuro, dourado só como accent) e deixar o Kanban leve estilo Kommo com seletor de densidade. Sem mexer em regra de negócio.

### 1. Trocar o padrão de fundo do admin (dark → light)
Hoje `tech-shell`, `premium-card`, `premium-hero` e o "black band" do topo estão hardcoded em preto/gradiente escuro. Vou:
- Refatorar essas classes em `src/index.css` para usarem tokens (`hsl(var(--background))`, `hsl(var(--card))`, `hsl(var(--border))`, `hsl(var(--foreground))`) — assim seguem o tema.
- Definir tema **claro como padrão** no `ThemeProvider` (mantendo o toggle para quem quiser escuro).
- Trocar o "black band" do header por uma faixa branca com borda dourada sutil e texto escuro, mantendo a marca POSION visível mas sem peso.
- Ajustar `AdminLayout` e `AppLayout` para o mesmo fundo creme/off-white da tela de Leads.
- Passar por cima de utilitários hardcoded (`text-white`, `bg-black/`, `text-amber-300` em textos) nos componentes de topo/sidebar/dashboard, trocando por tokens semânticos (`text-foreground`, `text-muted-foreground`, `bg-card`, `border-border`).

### 2. Kanban "Pipeline Agência" no padrão claro + estilo Kommo
Em `src/pages/admin/AgencyPipelinePage.tsx`:
- Fundo da página: creme claro (herda do layout).
- Colunas: cartão branco com borda cinza clara, header da coluna com **título em cinza escuro + contador em badge cinza discreto** — remover as cores vermelho/laranja/amarelo por coluna (viraram só um filete dourado de 2px no topo da coluna ativa/hover).
- Header da coluna mostra nome + contagem + valor total do estágio (fmt BRL) em tipografia pequena.
- **Cards compactos, hierarquia Kommo**:
  - **Densidade P (compacto)**: 1 linha — nome + valor à direita. Altura ~40px.
  - **Densidade M (padrão)**: nome (bold), responsável (pequeno cinza), valor (dourado) — altura ~72px.
  - **Densidade G (confortável)**: adiciona origem/etiqueta e "última movimentação há X". Altura ~120px.
- Card: fundo branco, borda sutil, hover eleva 1px, avatar do responsável como bolinha 20px à esquerda, valor à direita alinhado.
- **Seletor de densidade** no topo direito do Kanban (grupo de 3 botões ícone, igual Kommo — linhas finas/médias/grossas). Persiste a escolha em `localStorage` (`posion.kanban.density`).

### 3. Kanban do tenant (`TenantKanban.tsx`) recebe o mesmo tratamento
Mesmas colunas brancas, cards compactos com as 3 densidades, mesmo seletor. Componente `KanbanCard` e `DensityToggle` compartilhados em `src/components/kanban/` para reuso entre admin e tenant.

### 4. Dashboards das clínicas (`TenantDashboard.tsx`) alinhados
- Fundo claro, KPIs em cards brancos com borda cinza fina + accent dourado no ícone/valor destaque.
- Tipografia igual à tela de Leads (títulos `text-foreground font-semibold`, labels `text-muted-foreground uppercase tracking-wide text-[10px]`).
- Substituir gradientes/ruído por superfícies chapadas com sombra suave (`shadow-sm`).
- Manter estrutura de dados/queries — só o wrapper visual muda.

### 5. Tokens de cor centralizados (identidade POSION mantida)
No `:root` de `src/index.css`:
- `--background: 40 32% 96%` (creme papel — já existe, só reforço).
- `--card: 0 0% 100%` (branco puro).
- `--foreground: 220 15% 15%` (cinza-quase-preto para texto).
- `--muted-foreground: 220 10% 45%`.
- `--border: 220 15% 90%`.
- `--primary` / `--accent`: **dourado POSION** (mantém `#E8C468` em HSL) — usado só em ícones-chave, valores destacados, filete de coluna ativa, hover states. **Nunca como cor de fonte de parágrafo.**
- `--ring: gold` para foco visível.
- Sombra padrão: `--shadow-elegant: 0 1px 2px rgba(15,23,42,.04), 0 4px 12px -4px rgba(15,23,42,.08)`.

### 6. Escopo — o que **não** vou mexer
- Nenhuma query, edge function, migração ou lógica de dados.
- WhatsApp Chat interno mantém o dark (é interface de conversa, funciona melhor escura) — só o cabeçalho e a navegação ficam claros para casar com o resto.
- Página de login e telas públicas ficam como estão.
- Toggle de tema continua funcionando; o dark vira "modo alternativo", não o padrão.

### Arquivos que vou tocar
- `src/index.css` (tokens + refactor de `tech-shell`, `premium-card`, `premium-hero`, "black band").
- `src/hooks/useTheme.tsx` (default = light).
- `src/components/AdminLayout.tsx`, `src/components/AppLayout.tsx`, `src/components/TenantSidebar.tsx`, `src/components/AppSidebar.tsx` (remover classes escuras hardcoded).
- `src/pages/admin/AgencyPipelinePage.tsx` (Kanban redesenhado).
- `src/pages/app/TenantKanban.tsx` (mesmo tratamento).
- `src/pages/app/TenantDashboard.tsx` (superfícies claras).
- `src/pages/admin/Dashboard.tsx` (adaptar hero + cards ao tema claro, sem perder o conteúdo rico que acabamos de plugar).
- **Novos**: `src/components/kanban/KanbanCard.tsx`, `src/components/kanban/DensityToggle.tsx`, `src/components/kanban/types.ts`.

### Entrega
Faço tudo numa leva só. Depois abro a preview e você valida página por página; se algum ponto precisar recalibrar (peso do dourado, tamanho da densidade P/M/G, borda de coluna), ajusto pontualmente.