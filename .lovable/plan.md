# Plano — WhatsApp Bidirecional Completo + Kanban alinhado

## Diagnóstico

**1) Enviados não aparecem**
- O `whatsapp-webhook` já processa `fromMe=true` (linhas 173/261/267), mas o `evolution-connect` assina apenas os eventos padrão (`MESSAGES_UPSERT, MESSAGES_UPDATE, CONTACTS_UPDATE, CONTACTS_UPSERT, CONNECTION_UPDATE`) — na Evolution v2, mensagens enviadas por **outros dispositivos** (celular do médico, WhatsApp Web nativo) só chegam quando o webhook também escuta `SEND_MESSAGE` e a instância está com `syncFullHistory` ativo. Além disso, o `evolution-send` grava com `sender:"usuario"` mas quando o mesmo texto volta via webhook cai como duplicata silenciosa (o `dup` check por `wamid` funciona só se veio wamid da API — precisa reconciliar por `(conversation_id, wamid)` e por `(remote_jid, timestamp, texto)`).
- O `evolution-sync-chats` (histórico) hoje só puxa inbound. Precisa puxar todo o histórico bidirecional na primeira sincronização.

**2) Recursos WhatsApp incompletos**
- Já renderiza `image/audio/video/document`. Faltam: **sticker, location, contact card, reply/quote (mensagem citada), reactions (👍❤️), forward, edited messages, deleted (revoked), presença "digitando…", indicador online, gravação de áudio in-app, envio de múltiplas mídias, preview de link, busca dentro da conversa, marcar como não lida/fixar/arquivar**.
- Falta ingestão de `stickerMessage`, `locationMessage`, `contactMessage`, `contextInfo.quotedMessage` e eventos `MESSAGES_REACTION` / `MESSAGES_DELETE` / `PRESENCE_UPDATE` / `CHATS_UPDATE`.

**3) Kanban vs Dashboard KPIs**
- `TenantKanban.tsx:21` usa `"Reunião Agendada"` mas `PIPELINE_STAGES` já foi padronizado para `"CONSULTA AGENDADA"`. `TenantDashboard.tsx:22-24` usa `FUNNEL_ORDER` próprio (com label `"R. Agendada"`) — três fontes de verdade divergentes. O funil precisa ser único, vindo de `PIPELINE_STAGES`.

## Escopo desta implementação

### Fase A — WhatsApp bidirecional (o que o usuário está pedindo direto)
1. **`evolution-connect`**: adicionar eventos `SEND_MESSAGE`, `MESSAGES_DELETE`, `MESSAGES_REACTION`, `PRESENCE_UPDATE`, `CHATS_UPSERT`, `CHATS_UPDATE` à assinatura de webhook e ligar `syncFullHistory: true` no create/set-settings.
2. **`whatsapp-webhook`**: 
   - Tratar `send.message`/`SEND_MESSAGE` idêntico a `messages.upsert` com `fromMe=true` (garante que envios feitos do celular do médico apareçam).
   - Ingestão de novos tipos: `stickerMessage`, `locationMessage`, `contactMessage`, `reactionMessage`, `pollMessage`, `templateMessage`.
   - Extração de `contextInfo.quotedMessage` → coluna nova `reply_to_wamid` em `messages`.
   - Evento `messages.delete` → marcar `deleted_at`.
   - Evento `messages.reaction` → nova tabela `message_reactions (message_wamid, emoji, actor_jid, created_at)`.
   - Dedup reforçado: além de `wamid`, checar `(conversation_id, sender, conteudo, created_at±5s)` para blindar contra envios locais que ecoam via webhook.
3. **`evolution-sync-chats`**: puxar histórico bidirecional (endpoint `/chat/findMessages` sem filtro fromMe) e importar N últimas mensagens por conversa.
4. **UI `WhatsAppChat.tsx`**:
   - Renderizar novos tipos (sticker como imagem menor, location como mini-mapa/link, contact card, reply quoted acima da bolha).
   - Renderizar reactions embaixo da bolha (agrupadas por emoji).
   - Riscar mensagens deletadas ("🚫 Mensagem apagada").
   - Indicador "digitando…" (Realtime na tabela `presences`).
   - **Gravador de áudio in-app** (MediaRecorder API → webm → upload → `evolution-send` com `media_type:"audio"`).
   - Preview de link automático (unfurl via edge function nova `link-preview`).
   - Ações por conversa: **fixar, arquivar, marcar não lida** (colunas `pinned_at`, `archived_at` em `conversations`).
   - Busca full-text dentro da conversa selecionada.
   - Botão de responder (reply) em qualquer mensagem → envia com `quoted` para Evolution.
5. **Realtime**: canal em `messages` e `conversations` já existe, adicionar canais em `message_reactions` e `presences`.

### Fase B — Alinhar Kanban ↔ Dashboard
1. Fonte única: `PIPELINE_STAGES` em `src/types/admin.ts`.
2. `TenantKanban.tsx` passa a montar as colunas a partir de `PIPELINE_STAGES` (elimina o array local, corrige "Reunião Agendada" → "CONSULTA AGENDADA").
3. `TenantDashboard.tsx` deriva `FUNNEL_ORDER` e labels de `PIPELINE_STAGES` (mesma ordem, mesmos rótulos). Adiciona bloco "Funil por estágio" clicável — clicar leva ao Kanban filtrado por estágio.
4. Card **Taxas de Conversão** no dashboard já existente passa a usar as taxas canônicas: Lead → Qualificado, Qualificado → Consulta, Consulta → Compareceu, Compareceu → Ganho.

### Fase C — Diferenciais competitivos ("tecnologia que só este sistema vai ter")
1. **Timeline unificada do lead**: novo drawer no Kanban que junta em ordem cronológica — evento de origem (Facebook Ad/form), primeira mensagem WhatsApp, mudanças de estágio, agendamentos, vendas, disparo CAPI. Uma view SQL `lead_timeline` agrega das tabelas `leads`, `messages`, `lead_stage_history`, `appointments`, `sales`, `capi_events`.
2. **Auto-tag por IA na conversa**: edge function `wa-ai-tagger` que, a cada nova mensagem inbound, chama Lovable AI Gateway (Gemini flash) para extrair intenção (`interessado_procedimento`, `pediu_preco`, `agendou`, `objecao_valor`, `frio`) e aplica tag na conversa + move o lead no funil quando detecta "quero agendar" / "posso fechar".
3. **Score de temperatura do lead** (0-100) calculado a cada mensagem: recência + volume + palavras-chave positivas. Coluna `heat_score` em `leads`, badge colorido no card do Kanban e ordenação por temperatura.
4. **Rastreio UTM ponta-a-ponta**: quando o webhook cria lead do WhatsApp, se a última mensagem tem `wa.me/?text=` ou vem de link com UTM registrado (tabela `utm_touches`), atribuir campanha/adset/ad ao lead. Dashboard mostra ROAS real por criativo.
5. **Alerta SLA de resposta**: se conversa inbound ficar > 10min sem resposta, badge vermelho + notificação sonora no navegador + registro na tabela `sla_breaches`. KPI "Tempo médio de 1ª resposta" no dashboard.

## Detalhes técnicos

### Schema
```sql
alter table public.messages
  add column reply_to_wamid text,
  add column deleted_at timestamptz,
  add column edited_at timestamptz,
  add column location jsonb,          -- {lat, lng, name, address}
  add column contact_card jsonb;      -- {name, phones[]}

create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_wamid text not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  actor_jid text not null,
  emoji text not null,
  created_at timestamptz default now(),
  unique(message_wamid, actor_jid)
);

alter table public.conversations
  add column pinned_at timestamptz,
  add column archived_at timestamptz,
  add column marked_unread boolean default false;

alter table public.leads
  add column heat_score int default 0,
  add column heat_updated_at timestamptz;

create table public.sla_breaches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid, conversation_id uuid references public.conversations(id) on delete cascade,
  triggered_at timestamptz default now(), minutes_waited int
);

create table public.utm_touches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid, phone text, utm_source text, utm_medium text,
  utm_campaign text, utm_content text, created_at timestamptz default now()
);

create or replace view public.lead_timeline as
  select 'stage_change' as kind, id::text as ref, tenant_id, lead_id, changed_at as ts, jsonb_build_object('from', from_status,'to', to_status) as data
  from lead_stage_history
  union all select 'message', m.id::text, m.tenant_id, l.id, m.created_at,
    jsonb_build_object('direction', m.direction, 'text', m.conteudo, 'type', m.tipo)
  from messages m join conversations c on c.id = m.conversation_id
  left join leads l on l.tenant_id = c.tenant_id and l.whatsapp = c.telefone
  -- ... appointments, sales, capi_events
;
```
Todos com `GRANT` + RLS por `has_tenant_access`.

### Edge functions novas
- `wa-ai-tagger` — trigger via pg_net após insert em `messages` (inbound only).
- `wa-heat-score` — job pg_cron a cada 5min recalcula `heat_score`.
- `sla-monitor` — pg_cron 1min, detecta conversas inbound sem resposta.
- `link-preview` — POST { url } → { title, description, image }.

### Arquivos afetados
- `supabase/functions/evolution-connect/index.ts` — eventos + syncFullHistory
- `supabase/functions/whatsapp-webhook/index.ts` — novos tipos, dedup reforçado, reactions, delete
- `supabase/functions/evolution-sync-chats/index.ts` — histórico bidirecional
- `supabase/functions/evolution-send/index.ts` — suporte a reply (`quoted`) e reaction
- `src/pages/admin/WhatsAppChat.tsx` — renderers, gravador de áudio, ações, timeline
- `src/pages/app/TenantWhatsApp.tsx` — herdar mesmos renderers
- `src/pages/app/TenantKanban.tsx` — usar `PIPELINE_STAGES` como fonte + badge heat_score + drawer timeline
- `src/pages/app/TenantDashboard.tsx` — funil derivado de `PIPELINE_STAGES`, KPI SLA de resposta
- `src/types/admin.ts` — expor helper `getFunnelOrder()`

## O que fica de fora (aviso honesto)
- Chamadas de voz/vídeo via WhatsApp — Evolution API não expõe endpoint estável para isso; ícones de call ficam decorativos.
- Envio de figurinhas personalizadas (só recebimento) — Evolution v2 não tem `sendSticker` confiável em Baileys.
- Status/Stories — fora do escopo do CRM.

## Ordem de execução (uma ida só, sem quebrar em fases separadas)
1. Migration (schema + view + grants + RLS).
2. Edge functions (connect, webhook, sync-chats, send, wa-ai-tagger, wa-heat-score, sla-monitor, link-preview).
3. UI Kanban unificado com PIPELINE_STAGES + heat badge + drawer timeline.
4. UI Dashboard funil derivado + KPI SLA.
5. UI WhatsAppChat com renderers completos, gravador de áudio, ações (pin/arquivar/reply/reaction), busca in-chat.
6. Reconectar cada instância Evolution existente (script SQL faz upsert nos webhooks para todas as `zapi_connections` ativas).
