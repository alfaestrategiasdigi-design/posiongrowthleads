## Fluxo CAPI completo (ViewContent → InitiateCheckout → Lead → Purchase)

Hoje só existe disparo **Purchase** quando o lead vira "ganho" no Kanban. Vou expandir para cobrir toda a jornada com deduplicação server↔browser via `event_id` estável por lead.

### Mapeamento de etapas

| Etapa do funil       | Evento Meta         | Quando dispara                                              | event_id (dedup)                     |
| -------------------- | ------------------- | ----------------------------------------------------------- | ------------------------------------ |
| Visita da página     | `ViewContent`       | Client-side (Pixel) + servidor (CAPI) ao abrir a landing    | `view:{tenant}:{visitor_id}:{path}`  |
| Início do formulário | `InitiateCheckout`  | Client-side + CAPI no primeiro `focus`/`input` do form      | `form_start:{tenant}:{visitor_id}`   |
| Envio do lead        | `Lead`              | Server-side no INSERT em `public.leads` (trigger)           | `lead:{lead_id}`                     |
| Conversão fechada    | `Purchase`          | Server-side quando `leads.status → 'ganho'` (já existe)     | `purchase:{lead_id}`                 |

`event_id` idêntico entre browser (Pixel) e servidor (CAPI) → Meta deduplica automaticamente. Cada `event_id` é gravado em `capi_events_sent` para bloquear reenvios no servidor.

### Mapeamento de campos (user_data)

Enviados server-side, todos hasheados SHA-256 quando exigido:

- `em` ← `leads.email`
- `ph` ← `leads.whatsapp` (dígitos, com DDI 55)
- `fn` / `ln` ← primeiro / último nome de `nome_completo`
- `ct` / `st` ← cidade / UF extraídos de `cidade_estado`
- `zp` ← `leads.cep` quando existir
- `country` ← "br"
- `fbp` / `fbc` ← cookies capturados no browser (repassados ao webhook via URL na origem `formulario`; persistidos em `leads.meta_fbp` / `meta_fbc`)
- `client_ip_address` / `client_user_agent` ← do request original (webhook client-events)
- `external_id` ← `leads.id` (hash)

`custom_data` inclui `value`, `currency: BRL`, `content_name`, `content_category` (especialidade quando houver) e `order_id` no Purchase.

### Mudanças

**Banco**
- Adicionar em `leads`: `meta_fbp text`, `meta_fbc text`, `visitor_id text`, `cep text`.
- Nova tabela `capi_events_sent` (`event_id text PK, tenant_id, lead_id, event_name, sent_at`) para dedup no servidor. Grants + RLS (só service_role escreve; tenant lê os seus).
- Trigger `fire_capi_on_lead` no INSERT de `public.leads` → dispara `facebook-capi-event` com `event_name='Lead'`.
- Manter o trigger `fire_capi_on_won` (Purchase).

**Edge functions**
- `facebook-capi-event` (existente): aceitar `event_name` = `ViewContent | InitiateCheckout | Lead | Purchase`, receber `event_id`, `visitor_id`, `fbp`, `fbc`, `client_ip`, `client_ua`, `custom_data` extra; buscar `leads` só quando faz sentido; gravar em `capi_events_sent` (insert `ON CONFLICT DO NOTHING` — se já existe, retorna `deduped: true` sem chamar Graph API).
- Nova função pública `capi-client-event` (sem JWT): recebe eventos do browser (`ViewContent`, `InitiateCheckout`), resolve `tenant_id` pelo slug/rota, injeta `client_ip_address` do request e chama `facebook-capi-event` internamente. Isso evita expor o service key ao browser.

**Front-end**
- Novo helper `src/lib/tracking/capi.ts`:
  - Gera/persiste `visitor_id` (uuid em `localStorage`).
  - Lê cookies `_fbp` / `_fbc` (grava `_fbc` a partir de `?fbclid=` na URL se ausente).
  - `trackView(tenantSlug)` e `trackFormStart(tenantSlug)` que POST-am para `capi-client-event` com `event_id` estável.
  - Se o Pixel do tenant estiver carregado no browser, também dispara `fbq('track', ..., { eventID })` com o mesmo `event_id`.
- Hook `usePixel(tenantSlug)` que injeta `<script>` do Meta Pixel só quando `tenant_capi_config.pixel_id` estiver configurado (busca via edge function pública read-only ou embutido no HTML da landing).
- Instrumentar:
  - `src/pages/Index.tsx` → `trackView` no mount.
  - Qualquer formulário público de captação de lead → `trackFormStart` no primeiro foco/input, `visitor_id` + `fbp`/`fbc` incluídos no payload de criação do lead.
- No webhook `facebook-leads-webhook` e nos inserts de `leads` originados do site, persistir `meta_fbp`, `meta_fbc`, `visitor_id` recebidos.

### Deduplicação — resumo

1. **Browser Pixel** dispara `fbq('track', 'Lead', {...}, { eventID: 'lead:<lead_id>' })`.
2. **Servidor CAPI** envia o mesmo evento com `event_id: 'lead:<lead_id>'`.
3. Meta descarta o duplicado (janela de 48h).
4. `capi_events_sent` garante que a nossa própria edge function não reenvie o mesmo `event_id`, mesmo em retries do webhook ou re-execução do trigger.

### Não incluído nesta rodada
- UI para o tenant visualizar a taxa de match / EMQ (fica para depois).
- Advanced Matching automático via SDK do Pixel (podemos adicionar depois se necessário).