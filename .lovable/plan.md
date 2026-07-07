## Objetivo

Estender o mesmo sistema visual premium (preto profundo + hairline dourado + paleta 4 cores) já aplicado ao Dashboard da Agência para **todas as telas do tenant (clínica)** e para a **experiência do WhatsApp Master**, mantendo a lógica semântica e removendo o excesso de azul/roxo/teal/emerald que ainda existe.

## Paleta reutilizada (mesma do Dashboard)

| Papel | Uso |
|---|---|
| **Dourado `#E8C468`** | Cor de marca — títulos de seção, ícones ativos, KPI hero, meta atingida, item ativo da sidebar |
| **Branco `#F5F5F5`** | Números principais, linhas primárias de gráfico, texto de dados |
| **Verde `#4ADE80`** | Positivo, faturamento realizado, presença OK, status ativo |
| **Vermelho `#F87171`** | Negativo, perdas, no-show, offline, cancelamentos |
| **Cinzas `#A1A1AA` / `#71717A`** | Labels secundárias, eixos, subtítulos |

Fim do uso de: cyan (`#06b6d4`), indigo/violet/purple, blue-500, emerald/rose específicos das páginas do tenant.

---

## Escopo 1 — Tenant (Clínica)

Aplicar `.premium-card` / `.premium-hero` / `.premium-section-icon` / `.premium-kpi-icon` (já existentes no `index.css`) nas telas:

### TenantDashboard (`src/pages/app/TenantDashboard.tsx`) — maior refactor
- Trocar todos os cards azuis (`from-blue-…`, `to-emerald-…`, `to-purple-…` — screenshot mostra hero cards com halos azul/emerald/purple) por `.premium-card` / `.premium-hero`.
- **KPI hero** (Faturamento / Nº Vendas / Ticket / Maior Venda): superfície preta com hairline dourado, número em branco puro, label dourado suave, ícone em quadrado preto com hairline dourado + glyph branco. Faixa fina dourada na base substitui as barras coloridas atuais.
- **Métricas da Clínica** (Comparecimentos / Faturamento / Ticket Médio): remover os fundos verde-emerald / âmbar / roxo. Todos usam `.premium-card`. Cor semântica só aparece no valor: comparecimentos em verde se ≥ meta / vermelho se < meta, faturamento em branco com sublinha dourada, ticket em branco.
- **Evolução — últimos 30 dias**: linha **branca** com área dourada 0.18, grid `rgba(255,255,255,0.06)`, ticks cinza `#71717A`. Média diária destacada em dourado no canto.
- Badges `+0.0% vs jun`: verde/vermelho/cinza da paleta oficial, sem verde-emerald flat.
- WhatsApp status pill (Online/Offline): verde `#4ADE80` ou vermelho `#F87171`.

### TenantLeads / TenantPatients / TenantSales / TenantCampaigns / TenantPlans / TenantAgenda
- Trocar wrappers `bg-card` / `bg-muted/40` de KPIs por `.premium-card`.
- Cabeçalhos de seção usam o padrão `SectionTitle` (ícone dourado no quadrado com hairline + título branco + subtítulo cinza).
- Tabelas: linhas separadas por `border-white/5`, hover `bg-white/[0.03]`, cabeçalho em cinza mono uppercase, valores em branco tabular, valores monetários positivos em verde quando fizer sentido semântico (Sales, Plans).
- Botões primários mantêm o dourado da marca já configurado em `--primary`.
- Substituir badges coloridas: status "ativo/pago/confirmado" → verde; "pendente/atraso" → dourado; "cancelado/perdido/no-show" → vermelho; demais → cinza neutro.

### TenantKanban
- KanbanColumn: fundo preto (`premium-card`), header com hairline dourado + ícone branco no chip preto, contador em círculo com hairline dourado. Cor da coluna só aparece como fio superior fino (verde para "ganho", vermelho para "perdido", branco para as demais).
- Cards de lead: `.premium-card` compacto, nome em branco, valor em dourado, tags em cinza pill com hairline.

### TenantConfig / TenantProductsConfig / TenantProntuario / TenantRecall
- Cards de configuração passam para `.premium-card`; inputs mantêm os tokens já usados pelo shadcn (não mexemos em `--input`).

### AppLayout + TenantSidebar (tenant)
- Header do tenant (`bg-card/40`) alinhado ao `.tech-header` já usado no admin: fundo `#050505` neutro, hairline dourado inferior.
- Sidebar: item ativo em dourado (fundo `rgba(232,196,104,0.10)` + texto dourado + fio dourado à esquerda 2px), hover em cinza claro. Remover o gradiente âmbar do avatar da clínica — substituir por círculo preto com hairline dourado e iniciais em branco.

---

## Escopo 2 — WhatsApp (Admin Master + tenant)

Ambas as telas (`src/pages/admin/WhatsAppChat.tsx` e `src/pages/app/TenantWhatsApp.tsx`) já usam `.wa-shell`. Ajustes cirúrgicos:

### Lista de conversas (aprovada — manter, apenas reforçar)
- Pill "Conectado" / "Offline": verde `#4ADE80` / vermelho `#F87171` da paleta oficial (hoje usa emerald flat).
- Pill "Somente com lead": fundo `rgba(232,196,104,0.10)` + hairline dourado + texto dourado (hoje mistura tons).
- Pill "Revisar conversas @lid": passar a usar vermelho `#F87171` (é aviso), com hairline vermelho e ícone triângulo — hoje aparece amarelo neon.
- Avatares circulares coloridos (verde/vermelho/rosa/azul/roxo neon vistos no screenshot) → paleta unificada de 4 tons neutros derivados do hash do nome + hairline dourado sempre. Mantém legibilidade sem parecer "arco-íris".
- Timestamp da conversa em cinza mono, badge de não lida em dourado (número escuro sobre dourado).

### Empty state (painel direito)
- Bolha central atual (roxa suave) → ícone dentro de círculo preto com hairline dourado (mesmo `.premium-section-icon`).
- Título "WhatsApp Inbox" em branco Fraunces; subtítulo em cinza `#A1A1AA`.
- Botão "Configurações": secundário com hairline dourado, texto dourado.

### Área de conversa aberta (já refeita na iteração anterior)
- Confirmar consistência: cabeçalho do contato com hairline dourado inferior, bolhas dark aprovadas, `WhatsAppAudioPlayer` gold sobre preto. Sem mudanças estruturais.

### Composer / campo de digitar
- Fundo preto, hairline dourado inferior no foco, botão de enviar circular em dourado com ícone preto (contraste alto). Ícones de anexo/emoji em cinza `#A1A1AA`, hover branco.

---

## Onde as mudanças acontecem

- `src/index.css` — adicionar 2-3 classes utilitárias: `.premium-table-row`, `.premium-badge-*` (positive/negative/neutral/warn), `.premium-avatar` (círculo preto + hairline dourado) — para não repetir estilos inline.
- `src/components/app/AppLayout.tsx`, `src/components/app/TenantSidebar.tsx` — trocar tokens azul/âmbar antigos por dourado da paleta e header preto neutro.
- `src/pages/app/TenantDashboard.tsx` — refactor visual completo (paleta, cards, gráfico da evolução, badges).
- `src/pages/app/{TenantLeads,TenantPatients,TenantSales,TenantCampaigns,TenantPlans,TenantAgenda,TenantConfig,TenantProductsConfig,TenantProntuario,TenantRecall,TenantKanban}.tsx` — swap de classes de card/badge/tabela para a nova paleta. Sem tocar em queries, hooks ou tipos.
- `src/components/admin/KanbanColumn.tsx` — usar o novo tratamento.
- `src/pages/admin/WhatsAppChat.tsx`, `src/pages/app/TenantWhatsApp.tsx` — ajustes cirúrgicos em pills, empty state e composer.
- (Se necessário) `src/components/admin/whatsapp/ContactAvatar.tsx` — nova paleta de 4 tons neutros.

## Fora do escopo

- Nenhuma mudança em dados, RLS, edge functions, roteamento, autenticação, hooks, integrações (Evolution, Facebook, MP), tipos ou lógica de negócio.
- Nenhuma reestruturação de layout: mesma grid, mesmos filtros, mesmas tabs, mesmas ações — só troca de tema visual.
- Nenhuma alteração nos formulários (inputs shadcn continuam intactos).
- Fontes atuais permanecem (Fraunces / Inter / JetBrains Mono já carregadas).
