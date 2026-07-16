## Objetivo

Garantir que **toda mensagem** (formulário ou não, entrada ou saída, de qualquer dispositivo) seja vinculada ao **tenant correto** — nunca mais caindo na conta Admin Master por engano. Para isso: cada tenant cadastra e valida o(s) número(s) de WhatsApp da sua instância, e o webhook passa a rotear por número, não só por URL.

## Diagnóstico da causa raiz

Hoje o webhook resolve o tenant apenas por `?tenant=<slug>` na URL + fallback por `instance_name`. Se a Evolution disparar um evento sem o slug esperado, ou se o `instance_name` bater com o da instância `POSIONGROWTHLEADS` (master, `tenant_id NULL`), a mensagem cai no admin master. Não existe hoje uma "trava" que diga: "o número dono desta mensagem é 5511965022801 → tenant DRMATHEUS, obrigatório".

Também não temos nenhum lugar onde o cliente do tenant **veja e confirme** qual número de WhatsApp está ligado à conta dele.

## O que vai ser construído

### 1. Banco: números oficiais do tenant

Nova tabela `tenant_whatsapp_numbers`:

- `tenant_id` (fk tenants)
- `phone_e164` (ex: `5511965022801`) — normalizado
- `phone_jid` (`5511965022801@s.whatsapp.net`)
- `label` (ex.: "Recepção", "Comercial")
- `zapi_connection_id` (fk opcional — vincula à instância Evolution)
- `verified_at`, `verified_owner_jid` (o JID que a Evolution retornou no `fetchInstances`)
- `status` (`pending` | `verified` | `mismatch`)
- `is_primary` boolean
- RLS: tenant admin gerencia os seus; admin master vê todos

Índice único por `(phone_e164)` global — nenhum número pode pertencer a dois tenants ao mesmo tempo (evita o problema atual).

### 2. Tela de configuração por tenant

Nova aba em `TenantConfig.tsx` → **"Números de WhatsApp"** com um card `TenantWhatsAppNumbersCard.tsx`:

- Lista os números cadastrados (label, número, status: Verificado / Pendente / Divergente).
- Botão **"Adicionar número"** → modal com label + número (com máscara `+55 (11) 99999-9999`).
- Botão **"Validar agora"** em cada número → chama edge function que:
  1. Consulta `GET /instance/fetchInstances` na Evolution do tenant.
  2. Pega o `ownerJid` real da instância conectada.
  3. Compara com o número cadastrado.
  4. Se bater → marca `verified_at` + `status='verified'` e mostra ✅.
  5. Se não bater → `status='mismatch'` + mostra o número real detectado e oferece "Usar o número detectado".
- Botão **"Definir como principal"**.
- Indicador global no topo do card: "3 números cadastrados · 2 verificados · 1 divergente".

### 3. Edge function: `tenant-whatsapp-number-verify`

- Input: `{ tenant_id, phone_number_id }`.
- Autoriza: usuário deve ser `tenant_admin` do tenant ou super admin.
- Busca `zapi_connections` do tenant, chama Evolution `/instance/fetchInstances/<instance_name>`, extrai o `ownerJid`, atualiza o registro.
- Retorna `{ verified: boolean, owner_jid, mismatch_reason? }`.

### 4. Webhook: roteamento por número (a trava definitiva)

Em `supabase/functions/whatsapp-webhook/index.ts`:

- Extrair `ownerJid` do payload da Evolution (código já sabe fazer isso — `body?.ownerJid`, `body?.data?.ownerJid`, etc., linhas 200–250).
- **Antes** de aceitar o `resolvedTenantId` vindo da URL/`instance_name`:
  1. Normalizar `ownerJid` → E.164.
  2. `SELECT tenant_id FROM tenant_whatsapp_numbers WHERE phone_e164 = <owner> AND status='verified'`.
  3. Se achou e é **diferente** do `resolvedTenantId` → sobrescreve com o do número, loga `tenant_reroute_by_owner` e usa o correto.
  4. Se não achou nenhum tenant dono → **não** salvar como admin master; grava em `unrouted_leads` com `reason='unknown_owner_jid'` e sai com 200 (pra Evolution não reenfileirar).
- Isso vale para inbound **e** outbound (mensagens enviadas de "outro dispositivo" também trazem `ownerJid`).

### 5. Backfill (opcional, um clique)

Botão "Reatribuir mensagens antigas para este tenant" na tela nova:
- Roda uma função que procura em `conversations` / `messages` do admin master toda linha cujo `remote_jid` ou `metadata->>'owner_jid'` bate com um número verificado do tenant, e move `tenant_id` para o correto.
- Mostra prévia do total de conversas/mensagens que vão ser movidas antes de confirmar.

### 6. Pesquisa & boas práticas aplicadas

- Evolution API expõe `ownerJid` em `/instance/fetchInstances` e em todo evento `messages.upsert` — é a fonte canônica para saber o dono da instância.
- Padrão de "phone-number ownership table" é o mesmo usado por Twilio (`IncomingPhoneNumbers`) e Meta Cloud (`phone_number_id`): cada número pertence a exatamente uma conta, o webhook cruza por número antes de aceitar o payload.
- Fallback obrigatório para `unrouted_leads` quando o número não é reconhecido — nunca "assumir" o master.

## Detalhes técnicos

**Arquivos novos:**
- `supabase/functions/tenant-whatsapp-number-verify/index.ts`
- `src/components/tenant/TenantWhatsAppNumbersCard.tsx`
- migration criando `tenant_whatsapp_numbers` + policies + índice único por `phone_e164`

**Arquivos editados:**
- `supabase/functions/whatsapp-webhook/index.ts` — bloco de roteamento por `ownerJid` antes de gravar
- `src/pages/app/TenantConfig.tsx` — inclui o novo card

**Não muda:** tabelas `zapi_connections`, `whatsapp_connections`, `conversations`, `messages`, `leads` (a menos que o botão de backfill seja acionado pelo usuário).

## Fora do escopo

- Não altera provisionamento da instância Evolution (QR/reconexão continua no `ReconnectSessionCard`).
- Não move mensagens antigas automaticamente — só via botão explícito de backfill.
