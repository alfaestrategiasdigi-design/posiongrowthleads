# Prompt replicável: módulo "Campanhas + Conexão Meta"

Objetivo: gerar um documento único (`docs/PROMPT-MODULO-CAMPANHAS-META.md`) que sirva de **prompt completo** para recriar, em outro app Lovable, o módulo de campanhas Meta deste sistema — adaptado a um negócio de tráfego direto (checkout iniciado, recuperação de boleto, suporte pós-venda), sem WhatsApp conversacional.

## Como o módulo funciona hoje (resumo do que será descrito no prompt)

**Conexão Meta (uma vez, no admin)**
- OAuth do Facebook via edge function `facebook-oauth-exchange` → troca `code` por token de usuário de longa duração.
- Token, `ad_account_id`, `page_id` e `default_tenant_id` ficam em `facebook_webhook_config` (1 linha, service-role only).
- `facebook-permissions-check` valida escopos (`ads_read`, `ads_management`, `leads_retrieval`) e sinaliza `need_reconnect` na UI quando faltam.
- Multi-cliente: tabela `tenant_ad_accounts` (tenant_id ↔ ad_account_id + label + active) define quais contas de anúncio cada cliente enxerga.

**Leitura de campanhas (`tenant-campaigns`)**
- Valida sessão, checa `has_tenant_access`, resolve as contas do tenant.
- Lê fuso/moeda da conta (`timezone_name,currency`) e calcula a janela `since/until` **no fuso da conta** — é isso que faz "gasto de hoje" bater com o Ads Manager.
- Lista campanhas (`fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget`), com filtro `active_only`.
- Dois insights por campanha: um com `time_increment=1` (série diária) e um agregado (reach/frequency/rankings reais, deduplicados pela Meta).
- Deriva métricas: spend, impressões, cliques, CTR, CPC, CPM, reach, frequency, leads, compras, valor, ROAS, hook rate (`video_p25/impressions`), hold rate (`thruplay/p25`).
- **Resultado dinâmico por objetivo**: `result_kind` = messaging | leads | purchases | link_clicks, com rótulo e `cost_per_result` correspondentes (evita mostrar "CPL" numa campanha de vendas).
- Cache em memória com TTL de 3 min por chave `campanha|since|until`, concorrência limitada (`mapLimit`) e tratamento de rate limit da Graph (códigos 4/17/32/613/80004) com fallback stale-while-error.

**Cards e critérios de pausa (`TenantCampaigns` + `AlertsPanel`)**
- Card por campanha: status, objetivo traduzido, gasto, resultado + custo por resultado, CTR, ROAS, sparkline diária, badge de conta.
- Filtros: busca, objetivo, ordenação (spend/leads/cpl/roas/ctr/nome), agrupamento por conta ou objetivo, modo comparar até N campanhas, período 1/7/14/30/90 dias.
- Painel de alertas com severidade info/warn/critical e agrupamento (mostra top 3 + "+N"):
  - frequency > limiar → fadiga de criativo (warn)
  - hook rate < 15% → criativo fraco nos 3s iniciais (warn)
  - taxa de show / conversão baixas → crítico no funil
  - custo por resultado acima da meta e gasto sem resultado → recomendação de pausa
- Ações de gestão via `facebook-ads-manage` (`set_status`, `update_budget`, `list_adsets`, `list_ads`, `insights`) — pausar/reativar campanha, adset ou anúncio direto do card.
- Cruzamento com o CRM: atribuição de leads à campanha por `facebook_campaign_id` → `campaign_id_manual` → `utm_campaign` → nome normalizado (fallback fuzzy), gerando funil real (lead → reunião → venda → receita) e CAC/ROI reais ao lado das métricas da Meta.

## O que o documento vai conter

1. Contexto e stack alvo (React + Vite + Tailwind + Lovable Cloud/edge functions).
2. Schema SQL pronto: `ad_accounts_map`, `meta_config`, `campaign_insights`, `campaign_spend`, com GRANT + RLS por tenant.
3. Especificação de cada edge function (entrada, saída, auth, cache, rate limit), com o algoritmo de janela por fuso e de `result_kind`.
4. Especificação da UI: cards, KPIs, filtros, comparação, sheet de detalhe, painel de alertas.
5. **Motor de regras de pausa** parametrizável (limiares de CPA/ROAS/frequency/hook rate/gasto sem conversão), com severidade e ação sugerida.
6. Adaptação ao novo negócio: eventos `InitiateCheckout`, `Purchase` e boleto pendente via CAPI; estágios "compra iniciada", "boleto emitido", "boleto vencido", "pago", "pós-venda"; ROAS e recuperação de boleto como métricas de topo em vez de agendamento/show.
7. Checklist de configuração (app Meta, escopos, pixel/CAPI, secrets) e critérios de aceite.

## Detalhes técnicos

- Nenhuma alteração no app atual: o entregável é apenas o arquivo de documentação/prompt.
- O prompt será escrito em português, em blocos copiáveis, para colar direto no chat do outro projeto Lovable.
