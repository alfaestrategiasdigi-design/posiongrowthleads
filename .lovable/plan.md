## 1) Cache de insights do Facebook (TTL curto)

**Arquivo:** `supabase/functions/facebook-ads-manage/index.ts`

- Adicionar um `Map` em memória do worker (`insightsCache`) com chave `campaign_id|since|until` e TTL de **180 s** (configurável por env `INSIGHTS_TTL_MS`, default 180000).
- Encapsular o trecho do `case "list_campaigns"` que faz `mapLimit(... fbGet(${c.id}/insights))` em `getCachedInsights(campaign_id, since, until, token)`:
  1. Se houver entrada válida no cache → devolve sem chamar a Graph API.
  2. Em rate-limit (`code 17/4/32/613/80004`), serve o último valor cacheado mesmo expirado (stale-while-error) e marca `stale: true` no payload.
  3. Em sucesso, grava `{ value, expiresAt }`.
- Aplicar o mesmo cache no `case "insights"` (chave `object_id|since|until`).
- Limpeza: ao gravar, se `cache.size > 500`, remover as 50 entradas mais antigas (LRU simples).
- Resposta passa a incluir `cache: "hit" | "miss" | "stale"` por campanha para debug no client.

Resultado esperado: ao apertar "Atualizar" em sequência, só a 1ª janela de 3 min chama a Graph API — elimina o `User request limit reached`.

## 2) Dados errados em Campanhas & Tráfego (print 1)

**Causa raiz confirmada por inspeção do banco:**
- `CampanhasPage.tsx` (linha 297) consulta `clinic_leads` (tabela vazia em produção, 0 registros) usando `l.stage`.
- Os leads reais ficam em `public.leads` com coluna `status`. Por isso o card mostra `Leads 59` (vem do fallback `spends.leads_generated`) mas Qualificados/Agendados/Compareceram/Fechados aparecem **0**, e o `ROI 19816%` / `Ticket R$ 6.406` ficam isolados das vendas.

**Correção** (apenas o frontend de Campanhas, sem mexer em regra de negócio):

- Trocar a consulta de leads para `public.leads` selecionando `id, tenant_id, status, created_at, origem, facebook_campaign, facebook_campaign_id`.
- Recalcular `kpis` mapeando `status` → estágio do funil (alinhando com `PIPELINE_STAGES`):
  - `qualified` ⇢ `mql, sql, reuniao_agendada, reuniao_realizada, proposta, negociacao, ganho, convertido, fechado_ganho`
  - `scheduled` ⇢ `reuniao_agendada, reuniao_realizada, proposta, negociacao, ganho, convertido, fechado_ganho`
  - `attended` ⇢ `reuniao_realizada, proposta, negociacao, ganho, convertido, fechado_ganho`
  - `won` ⇢ `ganho, convertido, fechado_ganho`
- `totalLeads` passa a ser `leads.length` (sem fallback para `leads_generated`, que duplica métricas Meta).
- `perCampaign` agrupa por `facebook_campaign_id || facebook_campaign` (no lugar de `clinic_leads.facebook_campaign_id`).

## 3) WhatsApp — Send/Received e diagnóstico da API oficial

**Estado atual (inspeção do banco):** existe 1 conexão Cloud em status `pending`, **sem `last_validated_at`**, `webhook_subscribed = false`, sem `display_phone_number`. O token está salvo (241 chars) mas a Validação nunca rodou com sucesso. `messages` está vazio.

**Mudanças apenas em `src/pages/admin/ConexaoWhatsappPage.tsx`** (sem alterar a Cloud Function nem schema):

- Novo card "Diagnóstico da API Oficial" exibindo, em badges OK/Falha:
  1. **Credenciais salvas** (waba_id, phone_number_id, access_token presentes).
  2. **Token válido** — chama `whatsapp-cloud-validate` e mostra `display_phone_number` / `business_account_name`.
  3. **Webhook assinado** (`webhook_subscribed`).
  4. **Último erro** (`last_error`).
- Novo card "Tráfego de mensagens (últimas 24h / 7d / 30d)" com 4 métricas vindas de `messages`:
  - **Enviadas** = `direction='out'`
  - **Recebidas** = `direction='in'`
  - **Falhas** = `status='failed'`
  - **Última mensagem** (timestamp + direção)
  - Atualização em tempo real via canal Realtime de `messages`.
- Aviso contextual quando `enviadas=0 e recebidas=0`:
  - se `webhook_subscribed=false` → "Webhook ainda não foi assinado na aba Webhook do app Meta".
  - se `status='pending'` → "Clique em Validar conexão para concluir o handshake".
  - se `last_error` → mostra hint de reconexão.
- Botão "Enviar mensagem de teste" abre input para número E.164 + texto e chama `whatsapp-cloud-send` — útil para confirmar end-to-end sem sair da página.

## Detalhes técnicos

```text
facebook-ads-manage
 ├─ insightsCache: Map<string,{value, expiresAt}>
 ├─ getCachedInsights(campaign_id, since, until, token)
 └─ list_campaigns / insights → usa cache + stale-on-error

CampanhasPage.tsx
 ├─ supabase.from("leads") em vez de clinic_leads
 ├─ kpis mapeados via status (PIPELINE_STAGES)
 └─ perCampaign por facebook_campaign_id

ConexaoWhatsappPage.tsx
 ├─ DiagnosticCard (4 checks)
 ├─ TrafficCard (in/out/failed + realtime)
 └─ SendTestDialog → whatsapp-cloud-send
```

## O que NÃO está no escopo
- Não alterar Cloud Function de WhatsApp (`whatsapp-cloud-validate/send/webhook`); se a validação falhar a página passa a explicar o motivo.
- Não tocar em `clinic_leads`, RLS, schema ou migrations.
- Não alterar o Dashboard principal (`/admin`), só a página Campanhas.
