# Visão Geral do Projeto: Posion Growth Leads

Este documento resume a arquitetura, fluxos de dados, variáveis de ambiente críticas e passos para rodar/garantir segurança.

**Stack**
- Vite + TypeScript + React
- Tailwind CSS, shadcn-ui (Radix)
- Supabase (Auth, Postgres, Edge Functions)
- Facebook / Meta Lead Ads (webhooks + Graph API)

**Ponto de entrada**
- Frontend: [src/main.tsx](src/main.tsx#L1-L20)
- Roteamento: [src/App.tsx](src/App.tsx#L1-L220)
- Landing/UTM: [src/pages/Index.tsx](src/pages/Index.tsx#L1-L120)
- Supabase client: [src/integrations/supabase/client.ts](src/integrations/supabase/client.ts#L1-L60)

## Diagrama / Fluxo de Dados
```mermaid
flowchart LR
  subgraph Browser["Navegador (Usuário)"]
    U[Usuário] --> B[App React (Vite)]
  end

  subgraph Frontend["Frontend (src/)"]
    B --> LP[Landing page\n(`src/pages/Index.tsx`)]
    B --> Routes[App & Admin Routes\n(`src/App.tsx`)]
    LP --> LocalStorage[LocalStorage (UTMs)]
    LP -->|insert page_view| FEClient[`supabase` client\n(`src/integrations/supabase/client.ts`)]
    Routes -->|auth| SupabaseAuth[Supabase Auth]
    Routes -->|API reads/writes| FEClient
  end

  subgraph Supabase["Supabase (DB + Auth + Functions)"]
    FEClient --> DB[(Database)]
    SupabaseAuth --> DB
    subgraph Functions["Edge Functions (supabase/functions/)"]
      FBWebhook[facebook-leads-webhook]
      FBBackfill[facebook-backfill-leads]
      FBExport[facebook-leads-export-csv]
      FBOAuth[facebook-oauth-exchange / save-page]
      Invite[invite-tenant-user]
      Reminders[send-appointment-reminders]
    end
    FBWebhook -->|writes| DB
    FBBackfill -->|writes| DB
    FBExport -->|reads| DB
  end

  subgraph Facebook["Meta / Facebook"]
    FB_M[Meta Webhooks] -->|POST webhook| FBWebhook
    FBWebhook -->|Graph API fetch| GraphAPI[Facebook Graph API]
    GraphAPI --> FBWebhook
  end

  subgraph AdminTenantUI["UIs que consomem DB"]
    AdminUI[Admin UI (`src/components/admin/AdminLayout.tsx`)]
    TenantUI[Tenant App (`src/components/app/`)]
    DB --> AdminUI
    DB --> TenantUI
  end

  EnvFrontend[VITE_* (.env)]
  EnvFunctions[SUPABASE_SERVICE_ROLE_KEY / FACEBOOK_PAGE_ACCESS_TOKEN (Deno.env / DB)]

  EnvFrontend --> FEClient
  EnvFunctions --> Functions
```

## Principais tabelas e tipos (alto nível)
- Veja o schema tipado em: [src/integrations/supabase/types.ts](src/integrations/supabase/types.ts#L1-L120)
- Tabelas críticas: `tenants`, `tenant_users`, `user_roles`, `leads`, `clinic_leads`, `facebook_webhook_events`, `facebook_webhook_config`, `appointments`, `conversations`.

## Variáveis de ambiente (onde são lidas)
- Frontend (client):
  - `VITE_SUPABASE_URL` — usado por `src/integrations/supabase/client.ts` e para construir webhook URLs (`src/pages/admin/ConexaoPage.tsx`).
  - `VITE_SUPABASE_PUBLISHABLE_KEY` — chave publishable utilizada pelo client.
  - `VITE_SUPABASE_PROJECT_ID` — usado em páginas de configuração.
  - Local: arquivo `.env` (não comitar).

- Edge Functions / Server (Deno.env):
  - `SUPABASE_URL` — lido por funções em `supabase/functions/*`.
  - `SUPABASE_SERVICE_ROLE_KEY` — chave de serviço (sensitive) **NÃO** comitar.
  - `SUPABASE_ANON_KEY` — anon key (quando usada).
  - `FACEBOOK_PAGE_ACCESS_TOKEN` — token da página Facebook para Graph API (sensitive).
  - Os valores de `facebook_webhook_config` (e.g. `app_secret`, `verify_token`, `page_access_token`) podem também ser salvos no DB e lidos pelas functions.

## Ações de segurança recomendadas (prioridade)
1. Remover `.env` do repositório, adicionar a `.gitignore` e criar `.env.example` com placeholders.
2. Rodar ferramenta para limpar histórico caso secrets já tenham sido commitados (BFG / git-filter-repo) e rotacionar chaves comprometidas.
3. Rotacionar em seguida: `SUPABASE_SERVICE_ROLE_KEY`, `FACEBOOK_PAGE_ACCESS_TOKEN`, quaisquer tokens expostos.
4. Manter secrets do frontend apenas como publishable/anon; keys sensíveis apenas em ambiente de servidor ou secret store do provedor.
5. Ativar secret scanning / pre-commit hooks (`git-secrets`) e proteção de push para branches principais.

## Como rodar localmente (mínimo)
1. Instalar dependências:
```bash
npm install
```
2. Criar um `.env` local com as variáveis necessárias (ex.: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`).
3. Rodar dev:
```bash
npm run dev
```
4. Para funções Supabase (se for desenvolver/rodar localmente), use o ambiente Supabase CLI / deploy e configure `SUPABASE_SERVICE_ROLE_KEY` apenas no painel de secrets.

## Pontos para investigação/ação futura
- Revisar `supabase/functions/facebook-*` para compreender todos os fluxos de backfill e export CSV.
- validar que `facebook_webhook_config` na DB contém um `page_access_token` (Page Token) e que o `app_secret` está configurado para validar HMAC nos webhooks.
- Adicionar testes end-to-end para o fluxo: lead webhook → inserção na tabela `leads` → visualização no painel admin.

---
Documento gerado automaticamente; se quiser, posso:
- Exportar este documento para PDF/PNG; 
- Gerar diagrama SVG/PNG e salvar em `docs/`;
- Criar `.env.example` e commitar as mudanças de remoção de `.env` (se autorizar).
