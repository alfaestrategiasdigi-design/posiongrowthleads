
# Espelhar Admin Master no sistema dos tenants

Três frentes de trabalho, todas voltadas para dar aos tenants a mesma sensação visual do Admin Master (gráficos elegantes, header com logo Posion, área de perfil por usuário).

---

## 1. Redesign do Dashboard do Tenant (`/app/:slug/dashboard`)

Reproduzir a estrutura visual do `admin/Dashboard.tsx` (gráfico de linha grande, KPIs em tiles dourados, funil enxuto, ranking), mas com **os campos da clínica** — não da agência.

**Layout novo, na mesma ordem do Admin Master:**

```text
┌────────────────────────────────────────────────────┐
│ HEADER: título "Central da Clínica" + DateRange   │
├────────────────────────────────────────────────────┤
│ 4 KPI tiles dourados (paleta E8C468 / F5F5F5):    │
│  Faturamento | Vendas | Ticket Médio | Meta %     │
├────────────────────────────────────────────────────┤
│ Card GRANDE: LineChart de faturamento por dia     │
│  (recharts, mesmo estilo do admin — linha dourada)│
├────────────────────────────────────────────────────┤
│ 2 colunas:                                         │
│  ├─ Funil de conversão (Lead→Ganho, barras)       │
│  └─ Ranking top 5 procedimentos / pacotes         │
├────────────────────────────────────────────────────┤
│ 2 colunas:                                         │
│  ├─ Origem dos leads (pizza/barras horizontais)   │
│  └─ Alertas & saúde (WhatsApp, meta, no-show)     │
└────────────────────────────────────────────────────┘
```

- Mesma paleta do Admin Master: dourado `#E8C468`, branco `#F5F5F5`, verde `#4ADE80`, vermelho `#F87171`.
- Reutilizar componentes/estilo já existentes (`tech-pill`, `premium-kpi-icon`, `Card`) para manter consistência.
- Dados continuam vindo de `sales`, `leads`, `monthly_goals`, `whatsapp_connections` filtrados por `tenant_id` — nada muda no back-end.
- Substituir os blocos atuais de cards densos por essa composição mais "editorial".

---

## 2. Header do Tenant com logo Posion

No `AppLayout.tsx` e `TenantSidebar.tsx`:

- **Header (topo):** trocar `{tenant.name}` + "Central da Clínica" pelo mesmo padrão do Admin Master — logo Posion à esquerda + pill "Sistema operacional" + data + email do usuário à direita. O nome da clínica passa para uma linha discreta abaixo (ou é mostrado só no sidebar).
- **Sidebar:** manter a identidade da clínica dentro do bloco do topo do sidebar (ícone Building2 + nome + plano), mas o rodapé fica igual ao master ("Powered by Posion Growth"). Isso preserva a identificação de qual clínica está aberta sem "esconder" a marca Posion no header.

Resultado: o header vira idêntico ao do admin (logo Posion protagonista), e o nome da clínica fica no sidebar como contexto.

---

## 3. Área "Meu Perfil" (todos os usuários)

Nova rota compartilhada `/app/:slug/perfil` (tenant) e `/admin/perfil` (master), ambas apontando para o mesmo componente `ProfilePage.tsx`.

**Conteúdo da página:**
- Avatar circular grande + botão "Trocar foto" (upload).
- Nome completo (editável).
- Email (read-only, vem do auth).
- Telefone (opcional).
- Cargo/role (read-only, informativo).
- Botão "Salvar alterações".

**Back-end (Lovable Cloud):**
- Nova tabela `public.user_profiles`:
  - `user_id uuid PK references auth.users(id) on delete cascade`
  - `full_name text`, `phone text`, `avatar_url text`
  - `updated_at timestamptz default now()`
  - RLS: cada usuário lê/atualiza apenas o próprio (`auth.uid() = user_id`).
  - GRANTs em `authenticated` + `service_role`.
- Novo bucket público `avatars` no Storage, com policy que só deixa o próprio usuário escrever em `avatars/{user_id}/*`.

**Integração visual:**
- No topo do sidebar (tanto master quanto tenant), adicionar um mini-bloco clicável com o avatar + nome do usuário logado, que navega para `/perfil`. Fica bem discreto acima do menu.
- No header, o email atual vira um botão com o avatar ao lado, também linkando para o perfil.

---

## Detalhes técnicos

- **Arquivos criados:** `src/pages/shared/ProfilePage.tsx`, `src/components/shared/UserAvatarMenu.tsx`, migration para `user_profiles` + bucket `avatars`.
- **Arquivos alterados:** `src/pages/app/TenantDashboard.tsx` (redesign completo), `src/components/app/AppLayout.tsx` e `TenantSidebar.tsx` (logo Posion + avatar), `src/components/admin/AppSidebar.tsx` (avatar no topo), `src/App.tsx` (rotas de perfil).
- **Fora do escopo:** não mexer em nenhuma lógica de KPI/faturamento; só reorganizar apresentação. Não alterar Admin Master (só adicionar o link de perfil).

---

## Confirmações rápidas antes de eu implementar

1. **Nome da clínica no header:** ok mover para o sidebar, deixando o header com logo Posion como o master? Ou você prefere manter clínica visível no header (ex.: pequena, ao lado da logo Posion)?
2. **Perfil:** avatar + nome + telefone é suficiente, ou você quer campos extras (bio, LinkedIn, etc.)?
3. **Dashboard:** algum KPI/gráfico específico que você quer garantir que apareça (ex.: pacientes ativos, agendamentos da semana)?
