## Objetivo

Toda configuração da integração Facebook Lead Ads (Page Access Token, Verify Token, App Secret) passa a ser colada **dentro do próprio app** em `/admin/facebook → Configuração`. Removemos o Zapier do fluxo e adicionamos um botão que **valida o webhook ponta-a-ponta**.

---

## 1. Banco de dados

Estender `facebook_webhook_config` (já existe) com colunas para guardar credenciais com segurança:

- `page_access_token` (text, criptografado em repouso pelo Postgres — leitura **só** via Edge Function com service role)
- `app_secret` (text, opcional — usado para validar assinatura `X-Hub-Signature-256` do webhook)
- `page_id` (text, opcional — para chamar `/subscribed_apps`)
- `last_validated_at` (timestamptz)
- `last_validation_result` (jsonb)

**RLS:** somente `admin` lê/escreve via cliente. Edge Functions usam `service_role` e ignoram RLS.
Importante: o cliente **nunca** receberá `page_access_token` de volta — a coluna fica oculta nas leituras do client via uma `SECURITY DEFINER` view que devolve só metadados (`has_token: boolean`, `last_validated_at`, `page_id`).

---

## 2. UI — `/admin/facebook → Configuração`

Refatorar `src/pages/admin/FacebookConfigPage.tsx` (componente `ConfigTab`):

**Remover:**
- Card "Caminho B — Zapier"
- Bloco inteiro "Como conectar via Zapier (5 min)"
- Menções a Zapier/Make no texto da Webhook URL

**Adicionar uma única seção "Credenciais Meta" com 3 inputs:**
1. **Page Access Token** — campo password com olho para mostrar/esconder, botão "Salvar". Mostra `••••••••` se já existe um salvo.
2. **App Secret** (opcional) — idem.
3. **Page ID** (opcional) — input simples.

Salvar chama uma nova Edge Function `facebook-config-save` (service role) que persiste em `facebook_webhook_config`. O cliente nunca lê o valor.

**Botão "Validar webhook completo"** (substitui o atual "Testar Graph API"):
Chama Edge Function `facebook-webhook-validate` que executa, em sequência, e devolve status de cada passo:

1. ✅ Verify Token salvo
2. ✅ GET na própria Webhook URL com `hub.mode=subscribe&hub.verify_token=...&hub.challenge=ping` → confirma resposta `ping`
3. ✅ Page Access Token presente e válido (`GET /me`)
4. ✅ Permissões corretas (`leads_retrieval`, `pages_show_list`, `pages_manage_metadata`)
5. ✅ Lista formulários de Lead Ads (`GET /{page-id}/leadgen_forms`)
6. ⚠️ App Secret presente (avisa se ausente; só warning, não bloqueia)

Cada passo aparece como linha com ícone verde/vermelho/amarelo e mensagem.

**Manter:** Webhook URL (com botão copiar), Verify Token (com gerar/salvar), guia "Como configurar webhook nativo da Meta" (atualizado, sem Zapier).

---

## 3. Edge Functions

### Nova: `supabase/functions/facebook-config-save/index.ts`
- POST autenticado (admin) com `{ page_access_token?, app_secret?, page_id?, verify_token? }`.
- Valida role admin via `has_role(auth.uid(), 'admin')`.
- `upsert` em `facebook_webhook_config` usando service role.

### Nova: `supabase/functions/facebook-webhook-validate/index.ts`
- POST autenticado (admin).
- Lê token do banco (não mais de `Deno.env`).
- Executa os 6 passos acima e retorna `{ steps: [{ id, ok, message, detail? }] }`.

### Atualizar: `facebook-leads-webhook/index.ts`
- Trocar `Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN")` por leitura do banco (`facebook_webhook_config.page_access_token`).
- Se `app_secret` estiver salvo, validar `X-Hub-Signature-256` no POST da Meta (HMAC-SHA256 do raw body).

### Atualizar: `facebook-graph-test/index.ts`
- Mesma mudança: ler token do banco em vez de env. (Mantido como utilitário interno chamado pela validação.)

### Secret `FACEBOOK_PAGE_ACCESS_TOKEN`
- Não é mais necessário. Removível depois que a migração estiver validada.

---

## 4. Arquivos tocados

```text
supabase/migrations/<novo>.sql                              (novo)
supabase/functions/facebook-config-save/index.ts            (novo)
supabase/functions/facebook-webhook-validate/index.ts       (novo)
supabase/functions/facebook-leads-webhook/index.ts          (editar)
supabase/functions/facebook-graph-test/index.ts             (editar)
src/pages/admin/FacebookConfigPage.tsx                      (editar — remover Zapier, novos campos, novo painel de validação)
```

---

## 5. Fora do escopo

- App Review da Meta (continua sendo passo manual do usuário no painel da Meta).
- Importação CSV (aba existente, sem mudanças).
- Botão "Assinar Página ao app" automático — pode ser adicionado depois se quiser.
