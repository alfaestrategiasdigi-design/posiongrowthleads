
# Implementação P2 → P7

Aviso honesto: são ~7 frentes grandes tocando >15 arquivos + schema novo + cron. Vou entregar tudo em um turno de build, mas priorizando **funcional acima de perfeição estética**. Refinos finos de tema em telas secundárias podem exigir um segundo passe.

## P2 — Tema visual preto POSION

Reescrever tokens em `src/index.css` (e `tailwind.config.ts` se necessário):

- `--background: 0 0% 3.9%` (#0A0A0A), `--card: 0 0% 6.7%` (#111111), `--muted/elevated: 0 0% 9.4%` (#181818), `--input: 0 0% 7.8%` (#141414)
- `--border: 0 0% 16.5%` (#2A2A2A), `--border-subtle: 0 0% 11.8%` (#1E1E1E)
- `--foreground: 0 0% 100%`, `--muted-foreground: 0 0% 60.4%` (#9A9A9A), `--tertiary: 0 0% 37.6%` (#606060)
- `--primary: 44 55% 54%` (#C9A84C dourado), `--primary-hover: 44 58% 60%` (#D4B45C), `--primary-foreground: 0 0% 0%`
- Sidebar tokens: `--sidebar-background: 0 0% 5.1%` (#0D0D0D), item ativo com `border-left: 2px #C9A84C` + fundo `#C9A84C15`
- Recharts helper CSS: grid `#1E1E1E`, labels `#606060`, tooltip fundo `#1A1A1A` + borda `#2A2A2A`

Auditar `src/components/admin/AdminLayout.tsx`, `AppSidebar.tsx` e páginas com cores hard-coded (`#0f0f23`, `bg-slate-*`, roxo/indigo) e trocar por tokens semânticos.

## P3 — Agenda configurável por tenant

**Migração** (`tenant_appointment_config`):

```text
tenant_id (UNIQUE) · appointment_types text[] · team_members jsonb 
  [{name, role}] · working_hours jsonb · default_duration_minutes int
+ GRANT + RLS (has_tenant_access + is_tenant_admin para update)
+ trigger updated_at
```

- `src/pages/app/TenantAgenda.tsx`: modal Novo Agendamento passa a ler tipos/responsáveis/duração da config. Se vazio → input livre. Fallback pros tipos default do enum.
- `src/pages/app/TenantConfig.tsx`: nova aba/seção **Agenda** com:
  - chips editáveis de tipos (add/remove)
  - lista de membros com Nome + Cargo
  - horário por dia da semana com toggle "Fechado"
  - input de duração padrão

## P4 — Fechamentos melhorado

`src/pages/app/TenantSales.tsx`:

- Vendedor: dropdown carregado de `tenant_appointment_config.team_members` (fallback texto livre)
- Procedimento: `Input` texto livre
- Pagamento: select `PIX | Crédito | PIX+Crédito | PayPal | Outro` — se Crédito, aparece select de parcelas 1–12
- Canal: puxa de `channels` do tenant (com fallback livre)
- Compareceu: `Sim | Não | Futura`
- 1º Contato: date picker · Toggle internacional + campo "prevista chegada"
- Tabela: colunas Data/Cliente/Procedimento/Vendedor/Valor/Pagamento/Canal/Status
- Filtros topo: período, vendedor, canal, procedimento + totalizadores (faturamento, nº vendas, ticket)

## P5 — Recall funcional

**Migração**: reaproveitar `recall_campaigns` e `recall_executions` existentes; adicionar campos que faltem (`type` enum: `pos_procedure|birthday|reactivation_90d`, `message_template`, `enabled`, `last_run_at`).

**Edge function** `recall-runner`:
- Para cada tenant com regras ativas:
  - **pos_procedure**: appointments com `status='compareceu'` e `date = today - 1`
  - **birthday**: patients cujo `data_nascimento` bate mês/dia com hoje
  - **reactivation_90d**: patients sem appointment nos últimos 90d
- Renderiza template com `{nome} {procedimento} {data_ultimo_atendimento}` e chama `evolution-send-message` na instância do tenant
- Registra em `recall_executions`

**pg_cron**: agendar diariamente 09:00 (via `supabase--insert`, não migração — contém anon key).

**UI** `src/pages/app/TenantRecall.tsx`: tabela dos 3 tipos (ativo/inativo), editor de mensagem com variáveis, histórico últimos 30d (enviados / respostas via mensagens inbound subsequentes).

## P6 — Dashboard tenant (reforço)

Em `src/pages/app/TenantDashboard.tsx` (já tem alertas + ranking + sparklines):

- **Alertas**: adicionar regra "leads sem follow-up 48h" (leads sem `updated_at` recente) e link "Ver leads"
- **Card Agenda de hoje**: query em `appointments` para `date = today` do tenant, ordenar por hora, mostrar até 6 com botão "Ver agenda completa"
- Confirmar ranking (já existe) com janela 30d como opção

## P7 — Pacientes útil

`src/pages/app/TenantPatients.tsx`:

- Modal **Novo Paciente**: nome*, telefone*, nascimento, email, origem (channels), observações
- Row clicável → drawer/página com **4 abas**:
  1. Dados pessoais (edit inline)
  2. Agendamentos (query `appointments` por `patient_id` ou telefone)
  3. Compras (query `sales` por telefone/nome)
  4. WhatsApp (link `/app/{slug}/whatsapp?jid={telefone}`)
- Coluna **Total Gasto** = soma `sales.amount` por telefone/nome (computado client-side na listagem)

## Detalhes técnicos

**Schema novo:**
- `tenant_appointment_config` (UNIQUE tenant_id, RLS: SELECT via has_tenant_access, UPDATE/INSERT via is_tenant_admin)
- Alterações em `recall_campaigns` se necessário

**Edge functions:**
- `recall-runner` (novo) — verify_jwt=false, service role, itera tenants
- Reutiliza `evolution-send-message` existente

**Cron:** `select cron.schedule('posion-recall-daily', '0 12 * * *', ...)` — 09h BRT = 12 UTC

## Ordem de execução no build

1. Migração `tenant_appointment_config` + ajustes `recall_campaigns`
2. Tokens de tema (`index.css` + `tailwind.config.ts`)
3. `TenantConfig` (aba Agenda) → `TenantAgenda` (modal usa config)
4. `TenantSales` (equipe da config + campos novos + filtros)
5. `recall-runner` edge function + cron + `TenantRecall` UI
6. `TenantDashboard` (agenda do dia + alerta 48h)
7. `TenantPatients` (modal + perfil com abas)
8. Auditoria visual rápida das telas admin para remover azul/roxo residual

## Fora de escopo deste turno

- P1 (Leads de Campanhas no menu do tenant) — não pediu explicitamente, marcar como próximo passo
- Refino pixel-perfect em telas admin secundárias (Contracts, Facebook config) — trocar só tokens
- Testes automatizados
