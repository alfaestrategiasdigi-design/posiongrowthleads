## Objetivo

Reconstruir `/admin/campanhas` (arquivo `src/pages/admin/CampanhasPage.tsx`) seguindo o layout Lock Edition Admin, corrigindo os números inflados e adicionando o mapeamento por `form_id`.

## O que muda visualmente

Layout single-column, largura contida (`max-w-6xl`), fundo `#050505`, cards `#0A0A0A`, hairlines `border-white/5`, dourado `#C9A84C / #F0D78C`, títulos em Playfair Display.

Estrutura fixa da página, de cima para baixo:

1. Header sticky em uma faixa só: selector de ad account + date range com dois inputs (de / até) + toggle "Apenas ativas" + botão Sincronizar (dourado).
2. Faixa fina de status Marketing API (dot verde pulsante + última sync).
3. Grid de 6 KPIs em display serif dourado: Investido, Leads, CPL, ROAS, Receita CRM, Ativas/Total.
4. Bloco "Mapeamento de Campanhas & Regras" recolhível (fechado por padrão) com tabela editável.
5. Lista de cards de campanha em coluna única — header com nome + ID/objetivo + gasto + ganhos CRM; rodapé com Leads, CPL, CTR e botão "Ver no Ads Manager".

Removidos definitivamente da página: grid de 10 KPIs antigos (ROI, CAC, Ticket, Tx Qualificação, Tx Conversão), card Funil, os dois gráficos de Trend, gráfico horizontal "Performance por Campanha", tabela "Investimentos registrados" e o dialog "Novo investimento".

## Fonte dos números (sem valores irreais)

Toda métrica passa a vir de dois lugares:

- Meta Marketing API (via `facebook-ads-manage` action `list_campaigns` com `with_insights: true`): gasto, impressões, cliques, CTR, CPL, leads reportados.
- Kanban (tabela `agency_leads` + `leads` com stage/status = `ganho`) casado por `utm_campaign` / `facebook_campaign` / `campaign_id_manual` ao nome da campanha Meta com o mesmo algoritmo Jaccard que já existe: alimenta "Receita CRM" e "Ganhos CRM" por card.

Tudo que vinha de `campaign_spend` e `sales` é ignorado no cálculo dos KPIs desta página (por isso Receita 1.185.190 e ROI 98.200% somem).

ROAS = (Purchase value Meta + Receita CRM) / Gasto Meta.  
Se não houver gasto no período, ROAS mostra `—`, não `∞`.

## Configurações refletidas / criadas no front

- Date range real: dois `<input type="date">` controlados, default últimos 30 dias, dispara reload de insights ao mudar. Substitui o Select 30/60/90.
- Ad account: mantém o Select atual, mas movido para dentro do header sticky.
- Toggle "Apenas ativas": migra para o header (não fica dentro do card de listagem).
- Mapeamento por linha (nova UI): dropdown de tenant para cada `ad_account_id` já persistido em `tenant_ad_accounts` (linkar/desvincular); e chips de regras `form_id → tenant` lidas de `lead_routing_rules` (match_type = 'form_id') com botão "+ Adicionar" que abre um mini-form (form_id + tenant) e "×" para remover cada chip. Persistência via inserts em `lead_routing_rules`.

Nenhuma tabela nova é necessária — `tenant_ad_accounts` e `lead_routing_rules` já existem.

## Detalhes técnicos

Arquivo único reescrito: `src/pages/admin/CampanhasPage.tsx` (hoje 1730 linhas → alvo ~700 linhas). Componentes internos novos: `PageHeader`, `KpiTile`, `MappingSection`, `CampaignRow`.

Reaproveitados sem mudança: `syncFacebookAds`, `loadAdAccounts`, `loadMetaCampaigns`, `checkPermissions`, hook de tenants, algoritmo de attribution Jaccard.

Removidos do arquivo: estado `spends`, `form`, `open`, `dailyTrend`, `perCampaign`, `funnel`, funções `submit`, `remove`, e imports do recharts/dialog de "Novo investimento".

Novos handlers: `upsertFormIdRule(form_id, tenant_id)` e `deleteFormIdRule(rule_id)` chamando `supabase.from('lead_routing_rules')`.

Semânticos usados via tokens: `hsl(var(--background))`, `hsl(var(--card))`, `hsl(var(--primary))` etc — o protótipo usa hex direto só como referência; na implementação uso os tokens Posion Black/Gold já definidos em `index.css`.

## Fora de escopo desta rodada

- Editar orçamento diário / status ACTIVE/PAUSED inline no card (permanece via dialog atual, só re-estilizado).
- CAPI por conta (fica em `/admin/capi` como já está).
- Página do tenant `/app/:slug/campanhas` (já entregue no turno anterior — nenhuma mudança).
