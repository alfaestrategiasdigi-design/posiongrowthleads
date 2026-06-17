# Diagnóstico do que está travando hoje

Li a configuração atual no banco e identifiquei exatamente por que nada funciona:

| Item | Status atual | Causa |
|---|---|---|
| Token | "User Token · Posion Growth" | Está salvo um **User Token**, não um **Page Access Token** → por isso `leadgen_forms` retorna 0 e webhooks não disparam |
| Ad Account ID | `act_123456789` | É **placeholder fake** → daí o erro "Permissão ausente: ads_read" em Campanhas (a chamada nem chega na Meta com conta válida) |
| Página conectada | Posion Growth ✓ | OK |
| Default tenant para leads | vazio | Leads importados não têm para onde ir |
| Permissões | Não validáveis | Esperado com User Token, mas precisamos do Page Token |

**Conclusão:** o app Meta existe e a página está autorizada, mas a tela hoje tem caminhos demais (App ID, App Secret, Verify Token, Webhook URL, Backfill, CSV, Validação, Reinscrever, Campanhas, Ads Read...) — e dois campos críticos estão errados. Por isso parece que nada funciona.

# O que vou implementar

## 1. Reescrever `/admin/facebook` como fluxo de 3 passos

Esconder tudo que é diagnóstico atrás de um accordion "Avançado / Diagnóstico". A tela principal fica:

```text
┌─ Passo 1 · Conectar Meta ────────────────┐
│  [ Conectar com Facebook ]  (FB Login JS) │
│  ✓ Conectado como: Posion Growth          │
└───────────────────────────────────────────┘
┌─ Passo 2 · Conta de Anúncios ────────────┐
│  Conta: [ Posion Growth — act_172… ▼ ]   │
│  (lista puxada de /me/adaccounts)        │
└───────────────────────────────────────────┘
┌─ Passo 3 · Para onde mandar os leads ────┐
│  Clínica padrão: [ Posion Master ▼ ]     │
│  ☑ Inscrever webhook (leadgen)            │
│  ☑ Importar últimos 30 dias agora        │
│  [ Concluir configuração ]                │
└───────────────────────────────────────────┘
```

O botão **Concluir** faz em sequência (uma única edge function `facebook-connect-finalize`):
1. Troca user token curto → user token longo
2. Pega o **Page Access Token** da página escolhida (esse é o token que será salvo, corrigindo o problema #1)
3. Salva `page_id`, `page_access_token`, `ad_account_id` real, `default_tenant_id`
4. `POST /{page_id}/subscribed_apps?subscribed_fields=leadgen`
5. Roda backfill dos últimos 30 dias (reaproveita `facebook-backfill-leads`)
6. Retorna um resumo: "✓ Página conectada · ✓ Webhook ativo · ✓ 47 leads importados"

## 2. Corrigir a página de Campanhas

- Tirar o "Conta padrão para campanhas" duplicado (já vem do passo 2).
- Antes de chamar a Graph API, validar `ad_account_id` ≠ placeholder; se for, mostrar CTA "Voltar para conexão Meta".
- A mensagem "permissão ads_read ausente" só aparece se a Meta realmente retornar esse erro — hoje ela aparece porque a conta é fake.

## 3. UTMs automáticos (estilo Tintim)

Ao importar um lead via webhook ou backfill, gerar e salvar UTMs derivados do próprio anúncio (já temos `campaign_name`, `ad_name`, `adset_name`):

```
utm_source   = facebook
utm_medium   = paid  (ou organic se is_organic)
utm_campaign = <campaign_name normalizado>
utm_content  = <ad_name>
utm_term     = <adset_name>
```

Já existe parcialmente — vou padronizar e aplicar em `facebook-leads-webhook`, `facebook-backfill-leads` e `facebook-leads-export-csv`.

## 4. Esconder/agrupar telas hoje confusas

Mover para um único bloco "Avançado" (collapsed por padrão):
- Verify Token / Webhook URL / App Secret
- Validação Meta (6. checklist de permissões)
- Reinscrever página
- Auditoria de eventos
- Importar histórico CSV
- Backfill manual por form

O usuário comum não toca em nada disso — só usa os 3 passos.

# O que você (usuário) precisa fazer 1 vez no app Meta

Para o passo 2 funcionar e Campanhas pararem de dar "ads_read ausente", o app Meta precisa ter estas permissões aprovadas (App Review):

- `pages_show_list` · `pages_read_engagement` · `pages_manage_metadata`
- `leads_retrieval`
- **`ads_read`** ← essa é a que falta hoje
- `ads_management` (opcional, só se quiser editar campanhas pela plataforma)

Em **Modo de Desenvolvimento** do app, basta você ser admin/dev/tester do app — sem App Review. Para liberar para outros usuários (modo Live), precisa enviar para revisão.

# Arquivos que serão alterados

- `src/pages/admin/FacebookConfigPage.tsx` — reescrita do topo (3 passos), todo o resto vai para `<Accordion>` "Avançado"
- `src/pages/admin/CampanhasPage.tsx` — remove duplicação + guard de ad_account_id fake
- `supabase/functions/facebook-connect-finalize/index.ts` — **nova**, orquestra passos 1–6
- `supabase/functions/facebook-leads-webhook/index.ts` — UTMs padronizados
- `supabase/functions/facebook-backfill-leads/index.ts` — UTMs padronizados
- `supabase/functions/facebook-leads-export-csv/index.ts` — UTMs padronizados

# Fora de escopo (proposto)

- Não vou criar um app Meta novo — o seu já existe.
- Não vou submeter App Review por você (precisa ser feito no painel do Meta).
- Não vou trocar Z-API/WhatsApp.

Confirma que sigo por aí? Se quiser, posso também já remover de vez as telas avançadas (em vez de só esconder) — me diga.
