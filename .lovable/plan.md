
## Parte A — Estado atual das 4 conexões Evolution

| # | Instância | Tenant | `webhook_url` registrada tem `?secret=` correto? | Formato do `webhook_secret` no DB | Diagnóstico |
|---|---|---|---|---|---|
| 1 | POSIONGROWTHLEADS | — (master) | ✅ sim (`?secret=ea5c…347b0`) | UUID 36 chars | **OK** |
| 2 | DRMATHEUS | Dr Instituto Roar | ✅ sim (`?tenant=clinica-matheus-azevedo&secret=b457…ec78`) | UUID 36 chars | **OK** |
| 3 | donnaface | Clínica Donna Face | ❌ **falta `?secret=`** (só `?tenant=donna-face`) | UUID 36 chars (`28eda183-…`) | **precisa resubscribe** |
| 4 | drgabriel | Clínica Dr Gabriel Lourenço | ❌ **falta `?secret=`** (só `?tenant=gabriel-lourenco`) | **48 chars, NÃO UUID** (`895ddcd4ca0daddba7823deb20987d96f401e9af1d62cf71`) — formato hex de 24 bytes, provavelmente gerado por um `randomBytes(24).toString('hex')` de uma versão antiga do `evolution-connect` | **precisa resubscribe — mas ver §Ambiguidade** |

### Ambiguidade a esclarecer antes de mexer no drgabriel

O `webhook_secret` do `drgabriel` **não é UUID** — é um hex de 48 chars. Isso é diferente das outras três. Duas hipóteses:

1. **Foi gerado assim mesmo por uma versão antiga do `evolution-connect`**, é o segredo real, e o único problema é que a `webhook_url` na Evolution nunca foi reescrita com esse valor. Nesse caso, o resubscribe usando o secret atual (`895d…cf71`) resolve.
2. **É lixo de uma migração antiga** e a Evolution nunca conheceu esse secret. Nesse caso, resubscribing com ele funciona também (o `evolution-resubscribe` regrava a URL na Evolution, então a Evolution passa a enviar exatamente esse secret a partir daí).

Nas duas hipóteses o resubscribe é seguro — o `evolution-resubscribe` reescreve a URL na Evolution com o secret que está no DB, então após a chamada o webhook e a Evolution ficam sincronizados. **Vou usar o secret atual do DB** para as duas (`895d…cf71` para drgabriel, `28eda183…` para donnaface). Se você preferir rotacionar para UUID novo antes, me avise — mas não é necessário.

## Parte A — Plano de ação

1. Chamar `supabase.functions.invoke('evolution-resubscribe', { body: { connection_id: 'baaa940b-aa10-45f0-a53f-990c80c9eda9' } })` (drgabriel) — a função vai construir a URL correta (`…?tenant=gabriel-lourenco&secret=895d…cf71`), gravar na Evolution e atualizar `zapi_connections.webhook_url`.
2. Idem para `b00041e5-9235-4f1f-b4ed-90f28458e6d2` (donnaface) — URL final: `…?tenant=donna-face&secret=28eda183-…`.
3. Após cada chamada, ler `zapi_connections.webhook_url` para confirmar que a URL agora contém `?secret=`.
4. Consultar os logs do `whatsapp-webhook` dos ~2 minutos seguintes e confirmar que:
   - **param** os `invalid_secret { instanceName: "drgabriel" }` (que hoje aparecem várias vezes por segundo).
   - passam a existir logs de `messages.upsert` / `chats.upsert` para essas instâncias.
5. **Não** rodar `evolution-sync-chats` como parte deste bloco — você pediu só corrigir o webhook. Se quiser recuperar mensagens perdidas nas últimas 24-36h, é uma segunda ação separada.

Não vou tocar em POSIONGROWTHLEADS nem em DRMATHEUS (já estão OK — reassinar por reassinar só gera risco).

## Parte A — Proposta de prevenção (só proposta, não implemento agora)

Duas camadas complementares:

- **A1. Guard-rail no webhook**: quando o webhook recebe evento cujo `instanceName` bate com uma conexão registrada mas o `?secret=` não vem OU está divergente, além de retornar 401, gravar em uma tabela `whatsapp_webhook_health` (novo) uma linha com `{connection_id, event_at, reason}`. Assim o problema fica visível sem depender de leitura manual de logs.
- **A2. Cron diário chamando `evolution-webhook-audit`** com `dry_run:false` para cada conexão `evolution` ativa. A função já sabe verificar a URL registrada, os eventos inscritos, e reescrever se faltar — atualmente ela só roda quando alguém aperta o botão. Um pg_cron de 1x/dia às 03:00 BRT resolveria silenciosamente 100% desse tipo de regressão.
- **A3. (opcional, mais agressivo)** o próprio webhook, ao detectar `invalid_secret` mais de N vezes em X minutos para uma mesma conexão, dispara internamente o `evolution-resubscribe`. Mais complexo, mais risco de loop — só recomendo se A1+A2 não bastarem.

Preferência default se você aprovar depois: **A1 + A2**.

## Parte B — Esclarecimento sobre `zapi_connections`

**Q4.** Distintos em `provider` hoje:

```
provider   | count
-----------+------
evolution  |  4
```

**Todas** as 4 conexões WhatsApp ativas usam `provider='evolution'`. Não existe nenhuma linha com `provider='zapi'` (nem qualquer outro valor). O default da coluna ainda é `'zapi'` por herança histórica, mas nenhuma linha o usa.

**Q5.** Sobre "dados obsoletos de Z-API":

- **Zero linhas** em `zapi_connections` com `provider='zapi'`. Nada a limpar aqui.
- A **tabela** `zapi_connections` continua sendo a fonte de verdade para Evolution — o nome é herança histórica (o projeto começou com Z-API, migrou para Evolution reaproveitando a mesma tabela). Renomear a tabela seria trabalhoso (todas as edge functions `evolution-*`, `whatsapp-webhook`, `whatsapp-lid-*` referenciam esse nome) e sem ganho funcional. **Recomendo manter o nome**.
- Existe também a tabela `whatsapp_connections` (20 colunas) — essa parece ser uma tabela paralela mais antiga. Vou inspecioná-la em uma etapa separada se você pedir; não é do escopo desta ação.

## O que quero autorização para fazer agora

Somente os passos 1-4 da Parte A: rodar `evolution-resubscribe` para `donnaface` e `drgabriel`, ler as URLs finais e conferir nos logs que os 401 pararam. Aprova?
