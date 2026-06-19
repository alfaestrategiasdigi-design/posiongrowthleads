## Visão geral

Transformar a plataforma em um **hub master de aquisição B2B** onde você (admin) controla 1 app Meta com todas as permissões, distribui leads para clínicas-cliente via roteamento por `form_id`/campanha, e cada clínica acessa WhatsApp Cloud API oficial, Kanban comercial e métricas de campanha — tudo dentro do sistema, com estética dark premium alinhada à proposta de valor: **"Do clique no anúncio ao fechamento, sem perder lead no caminho."**

---

## 1. Roteamento Meta → Tenant (Admin Master)

Nova tela `/admin/roteamento-leads`:

- Tabela `lead_routing_rules` (tenant_id, match_type [form_id|campaign_id|page_id|adset_id], match_value, ad_account_id, priority, active)
- UI: lista formulários/campanhas detectados via Graph API + dropdown de tenant para cada um
- Edge function `facebook-leads-webhook` atualizada: ao receber leadgen, consulta rules → grava `lead.tenant_id` correto (fallback: `default_tenant_id`)
- Backfill respeita as mesmas regras
- Validação automática a cada 6h: token Page, assinaturas webhook, permissões — auto-correção quando possível, alerta visual quando não

## 2. WhatsApp Cloud API oficial (renomeação + setup in-app)

Sidebar: "Conexão WhatsApp" (substitui "Conexão"). Página `/admin/conexao-whatsapp`:

- **Aba "Cloud API" (padrão)**: campos para WABA ID, Phone Number ID, Access Token, App Secret, Verify Token; botão "Validar conexão" testa via Graph; exibe URL do webhook para colar no Meta
- **Aba "Templates"**: lista templates aprovados via API, permite enviar template para iniciar conversa (janela 24h)
- **Aba "Z-API (legado)"**: mantém a integração atual como fallback
- Tabela `whatsapp_connections` (tenant_id, provider [cloud|zapi], waba_id, phone_number_id, display_number, status, verified_at)
- Edge functions novas:
  - `whatsapp-cloud-webhook` — recebe mensagens, mídia, status; cria/atualiza `conversations` + `messages` + `leads` (cria lead novo se número desconhecido)
  - `whatsapp-cloud-send` — envia texto, template, mídia
  - `whatsapp-cloud-validate` — testa token + webhook + número
- Inbox `/admin/whatsapp` passa a unificar Cloud + Z-API (filtro por origem)

> Cloud API não usa QR. Para QR, fica a opção Z-API legado (já existente).

## 3. Marketing Insights completo (todas as métricas)

Expandir `facebook-campaigns-sync`:

- Tabela `campaign_insights` (campaign_id, date, level [campaign|adset|ad], spend, impressions, reach, clicks, ctr, cpc, cpm, frequency, leads, cost_per_lead, purchases, purchase_value, roas, video_views, link_clicks)
- Tabela `campaign_insights_breakdown` (insight_id, breakdown_type [age|gender|region|placement|device|publisher_platform], breakdown_value, métricas…)
- Cron diário 03:00: puxa últimos 30 dias por `ad_account_id` (todas as contas do admin), nível ad + breakdowns
- Tela `/admin/meta-ads` ganha aba "Insights" com filtros (período, conta, campanha, breakdown) e gráficos

## 4. Kanban comercial reformulado

Estágios novos (substituem MQL atual): **Qualificado → Oportunidade → Reunião Agendada → Negociação → Proposta Aceita → Perdido**

- Migration: rename de status no enum + atualização de `KanbanBoard.tsx`, `LeadCard.tsx`, `pipeline stages` config
- Cada coluna mostra contagem + valor potencial somado
- Drag-and-drop dispara automações (ex.: "Reunião Agendada" cria evento na agenda; "Proposta Aceita" gera contrato)
- Motivo de perda obrigatório ao mover para "Perdido"

## 5. Dashboard principal premium

`/admin/dashboard` redesenhado:

- **Funil de aquisição**: gasto → impressões → cliques → leads → MQL → reunião → fechamento (com CPL, CAC, taxa de conversão por etapa)
- **Cards de topo**: leads hoje/semana/mês, CPL médio, ROAS, ticket médio, ciclo de venda
- **Gráficos**: leads por dia × gasto, performance por campanha (top 5), origem dos leads (Facebook/Instagram/orgânico), heatmap de horários
- **Saúde do sistema**: status do token Meta, último webhook recebido, conexão WhatsApp, sincronização (badges verde/amarelo/vermelho)
- **Por tenant**: filtro global no topo permite ver consolidado ou por clínica

## 6. Identidade visual — dark premium "B2B tech"

Sobrescrever `index.css` + `tailwind.config.ts`:

- **Fundo**: preto profundo `#05050A` com camadas `#0B0B14` / `#11111F`
- **Acento primário**: roxo elétrico `#7C3AED` → azul `#3B82F6` (gradiente)
- **Sucesso/alerta**: verde neon `#10F2A0` / âmbar `#F59E0B` / vermelho `#EF4444`
- **Tipografia**: Space Grotesk (headings) + Inter (body) via `@fontsource`
- **Glassmorphism sutil** em cards (`bg-white/[0.03]` + `backdrop-blur` + borda `white/10`)
- **Microanimações**: fade-up nos cards, contagem progressiva nos KPIs, pulse no status verde
- 100% responsivo (sidebar colapsa em mobile, tabelas viram cards)
- Substituir todos os `text-white`/`bg-black` hardcoded por tokens semânticos

---

## Seção técnica

### Migrations
1. `lead_routing_rules` + grants + RLS (admin only)
2. `whatsapp_connections` + grants + RLS
3. `campaign_insights` + `campaign_insights_breakdown` + índices por data
4. Rename enum status do lead (qualificado, oportunidade, reuniao_agendada, negociacao, proposta_aceita, perdido) + migração de dados existentes

### Secrets (vou pedir)
`META_APP_SECRET`, `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_WABA_ID`, `WHATSAPP_CLOUD_VERIFY_TOKEN` (você já tem `FACEBOOK_PAGE_ACCESS_TOKEN`)

### Edge functions novas
- `whatsapp-cloud-webhook`, `whatsapp-cloud-send`, `whatsapp-cloud-validate`
- `meta-insights-sync` (cron diário)
- `meta-health-check` (cron 6h — valida token, webhook, permissões; auto-renova quando possível)

### Ordem de execução
1. Identidade visual (base para todo o resto)
2. Migrations (rotas + WA + insights + kanban enum)
3. Roteamento Meta → Tenant + auto-validações
4. WhatsApp Cloud API (conexão + webhook + inbox)
5. Insights API completa + breakdowns
6. Kanban reformulado
7. Dashboard premium

---

## Fora do escopo desta entrega
- Conversions API (Pixel server-side) — pode entrar em fase 2
- WhatsApp Business On-Premise (descontinuado pela Meta)
- Integração com CRMs externos (HubSpot/RD/Pipedrive)