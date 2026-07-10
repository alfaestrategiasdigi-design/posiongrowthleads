
# Integração Kommo CRM — Dr Instituto Roar

Import one-shot completo (leads + custom fields + conversas + tarefas + notas) via OAuth2, com deduplicação por telefone (pular duplicados). Escopo travado ao tenant "Dr Instituto Roar" (instância Dr Matheus Azevedo).

## 1. Setup Kommo (você faz uma vez)

Passo-a-passo que vou colocar na tela de configuração:

1. Kommo → **Configurações → Integrações → + Criar Integração** (botão no print que você mandou).
2. Aba **Chaves e escopos**:
   - Redirect URI: `https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/kommo-oauth-callback`
   - Escopos: `crm`, `notifications`, `push_notifications` (todos os disponíveis).
3. Copia **Integration ID (client_id)**, **Secret Key (client_secret)** e a **subdomain** da sua conta (ex: `roar` de `roar.kommo.com`).
4. Cola os 3 valores no card "Kommo" dentro de `/app/dr-instituto-roar/configuracao`.
5. Clica **Conectar Kommo** → abre popup de consentimento Kommo → volta autenticado.
6. Clica **Importar tudo do Kommo** → roda o import (progress em tempo real).

Guardo `client_id`, `client_secret`, `subdomain`, `access_token`, `refresh_token`, `expires_at` na nova tabela `kommo_connections` (por tenant). Refresh automático quando o token expira durante o import.

## 2. Estrutura de dados

Nova tabela `kommo_connections`:

| campo | uso |
|---|---|
| `tenant_id` | FK tenants (unique) |
| `subdomain` | ex: `roar` |
| `client_id`, `client_secret` | credenciais OAuth |
| `access_token`, `refresh_token`, `expires_at` | tokens |
| `account_id`, `account_name` | metadata retornado |
| `last_import_at`, `last_import_stats` (jsonb) | resumo do último run |
| `status` | `disconnected` / `connected` / `error` |

Nova tabela `kommo_import_map` (evita reimportar):

| campo | uso |
|---|---|
| `tenant_id`, `kommo_entity_type` (`lead`/`contact`/`chat`/`message`/`task`/`note`), `kommo_id` | dedupe |
| `local_id` (uuid) | id no Posion (lead/conversation/message/lead_task) |
| `imported_at` | timestamp |

Ajustes leves em tabelas existentes (sem migração destrutiva): uso `leads.extras` (jsonb) para guardar `{ kommo_id, kommo_pipeline, kommo_status, kommo_custom_fields: {...}, kommo_tags: [] }`. Mesma ideia em `conversations.metadata` e `lead_tasks.extras` — sem novas colunas.

## 3. Edge Functions novas

1. **`kommo-oauth-start`** — recebe `tenant_id`, retorna URL `https://<subdomain>.kommo.com/oauth?client_id=...&state=...&mode=post_message`. Popup abre isso.
2. **`kommo-oauth-callback`** — troca `code` por tokens, salva em `kommo_connections`, faz `window.postMessage` de sucesso pro pai.
3. **`kommo-refresh-token`** — helper interno, chamado quando `expires_at < now + 60s`.
4. **`kommo-import-run`** — motor do import. Recebe `{ tenant_id }`. Fases sequenciais, cada uma gravando progresso em `kommo_connections.last_import_stats`:
   - **Fase A — Pipelines/Statuses**: `GET /api/v4/leads/pipelines` → mapeia `kommo_status_id → status local` (heurística: nomes tipo "Ganho"→`ganho`, "Perdido"→`perdido`, "Novo"→`lead`, resto vira `lead` com o nome original salvo em `extras.kommo_status`).
   - **Fase B — Custom fields catálogo**: `GET /api/v4/leads/custom_fields` e `/contacts/custom_fields` → guarda esquema em `kommo_connections.last_import_stats.fields_catalog` (id→nome/tipo).
   - **Fase C — Contatos + Leads** (paginado 250/página): `GET /api/v4/contacts?with=leads` e depois `GET /api/v4/leads?with=contacts,catalog_elements`. Para cada:
     - Normaliza telefone (mesma `normalize_phone` do banco).
     - **Se telefone já existe em `leads` do tenant → SKIP** (grava só o mapeamento em `kommo_import_map`).
     - Senão insere `lead` com: `nome_completo`, `whatsapp`, `email`, `status` mapeado, `origem='kommo_import'`, `valor_proposta` do lead Kommo, `extras` = todos os custom fields nomeados + tags + pipeline.
   - **Fase D — Chats/Mensagens**: `GET /api/v4/chats` + `GET /api/v4/chats/{id}/messages`. Cria/atualiza `conversations` (dedup por telefone) e insere `messages` marcadas com `metadata.kommo_message_id`, respeitando `direction` (in/out) e timestamps originais. Não replay pelo whatsapp-webhook — insere direto pra preservar timeline.
   - **Fase E — Tarefas + Notas**: `GET /api/v4/tasks` e `/api/v4/leads/{id}/notes`. Tasks → `lead_tasks`. Notas → `lead_task_comments` no lead correspondente (ou anexadas como comentário na primeira task auto-criada "Notas migradas do Kommo").
5. **`kommo-import-status`** — GET, retorna `last_import_stats` pra UI fazer polling durante o run.

Todas com `verify_jwt = true` + checagem `has_tenant_access(user, tenant_id)` — só admin ou membro do tenant Dr Instituto Roar acessa.

## 4. UI — `/app/dr-instituto-roar/configuracao`

Novo card **"Kommo CRM"** (só aparece se `tenant.slug === 'dr-instituto-roar'` OU role admin):

- **Estado desconectado**: 3 inputs (Subdomain, Client ID, Client Secret) + botão "Conectar Kommo".
- **Estado conectado**: badge verde com `account_name`, botão "Importar tudo do Kommo", botão "Desconectar".
- **Durante import**: barra de progresso com fase atual + contadores em tempo real (pipelines: ✓, custom_fields: ✓, contatos: 234/490, chats: 12/57, mensagens: 340/2100, tarefas: 45/60). Polling a cada 2s em `kommo-import-status`.
- **Após import**: card verde "Importação concluída" com resumo (X leads criados, Y pulados por duplicata, Z conversas, W mensagens, N tarefas) + botão "Ver leads importados" (filtra kanban por `origem=kommo_import`).

## 5. Escopo travado

- Card só aparece pro tenant Dr Instituto Roar.
- Edge function `kommo-import-run` valida: `tenant.slug === 'dr-instituto-roar'` ou erro 403 (proteção extra).
- Nenhuma alteração em `/admin/whatsapp-status` — Kommo mora só na configuração do tenant.

## Detalhes técnicos

- **Rate limit Kommo**: 7 req/s. Uso `Promise.all` em lotes de 5 com `await sleep(800ms)` entre lotes.
- **Retry**: 3x com backoff exponencial em 5xx e 429.
- **Idempotência**: rodar o import 2x não duplica nada (`kommo_import_map` UNIQUE em `tenant_id, kommo_entity_type, kommo_id`).
- **Timeout edge function**: import roda em background usando `EdgeRuntime.waitUntil()`. Retorno imediato, UI acompanha via polling.
- **Custom fields**: guardo `extras.kommo_custom_fields = { "CNPJ": "12.345.678/0001-99", "Cidade": "São Paulo", ... }` — chave é o nome do campo no Kommo (não o ID), pra ficar legível na UI de detalhes do lead.

## Arquivos

**Novos (edge)**: `supabase/functions/kommo-oauth-start/index.ts`, `supabase/functions/kommo-oauth-callback/index.ts`, `supabase/functions/kommo-import-run/index.ts`, `supabase/functions/kommo-import-status/index.ts`, `supabase/functions/_shared/kommo-api.ts` (fetch com refresh automático + rate limit).

**Novos (frontend)**: `src/components/tenant/KommoIntegrationCard.tsx`, `src/components/tenant/KommoImportProgress.tsx`.

**Editados**: `src/pages/app/TenantConfig.tsx` (adicionar `<KommoIntegrationCard />` condicional).

**Migração**: cria `kommo_connections` + `kommo_import_map` com RLS por tenant e GRANTs padrão.

## Fora de escopo

- Sync contínuo/webhooks do Kommo (só one-shot agora, conforme sua resposta).
- Aplicar pra outros tenants — só Dr Instituto Roar. Pra habilitar em outro, é remover 1 linha de guard.
- Importar arquivos anexos das mensagens (só texto + metadata na primeira carga; se quiser mídia, viramos fase F depois).
