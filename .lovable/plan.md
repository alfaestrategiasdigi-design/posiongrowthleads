
## Diagnóstico honesto (antes do plano)

O sistema já é um CRM funcional (WhatsApp, Kanban, Agenda, Financeiro, Pacientes, Automações, Meta Ads, Contratos, Assinaturas). O que trava o "100% amanhã" são 3 lacunas concretas:

1. **WhatsApp não ingere mensagens enviadas de outro dispositivo** — a instância do Dr. Alessandro foi criada antes de a lista de eventos incluir `SEND_MESSAGE` e `MESSAGES_UPSERT` com fromMe. A subscrição *nunca foi reaplicada* na Evolution. O webhook não recebeu nenhum evento nas últimas horas (comprovado no log).
2. **Tenant não tem tela de Leads** — hoje só o Admin Master tem "Leads". O cliente vê leads só no Kanban, sem lista/busca/filtro.
3. **Organização do menu e do dashboard tem quebras visuais** — "Nenhum lead capturado" bate confuso quando é conta nova; falta um onboarding de 1ª tela.

Vou atacar os 3 nessa ordem, sem inventar features novas.

---

## Passo 1 · WhatsApp bidirecional de verdade (P0 — 30 min)

Problema real: a instância Evolution já existente **não está inscrita** em `SEND_MESSAGE`/`MESSAGES_UPSERT` com echo de outros dispositivos. Reaplicar a subscrição resolve.

- Adicionar botão **"Reassinar eventos"** em `WhatsAppStatusPage` (chama `evolution-connect` de novo com a config existente → força `configureWebhook`).
- Rodar reassinatura **agora** para todos os tenants ativos (Alessandro + Master + demais).
- Confirmar no webhook um `fromMe:true` chegando (o filtro `@lid` já foi relaxado no turno anterior; falta só o evento chegar).
- Ajustar UI da conversa para mostrar bolhas outbound à direita mesmo quando `sender=usuario` veio via eco (já está, só validar).

Critério de sucesso: mando uma msg pelo celular, ela aparece no inbox do POSION em <5s à direita.

---

## Passo 2 · Tela de Leads do tenant (P0 — 45 min)

Nova rota `/app/:slug/leads` com:

- Lista de todos os leads do tenant (tabela + busca + filtros por estágio, origem, período).
- Ações rápidas: abrir no Kanban, abrir conversa WhatsApp, criar venda.
- Origem badge (facebook_ads / whatsapp / formulário / manual).
- Item no sidebar entre "WhatsApp" e "Kanban" chamado **"Leads"**.

Fonte: mesma tabela `leads` filtrada por `tenant_id`.

---

## Passo 3 · Organização e polimento (P1 — 45 min)

- **Dashboard vazio**: quando não há venda no período, mostrar bloco de "Primeiros passos" (ligar WhatsApp, cadastrar produto, importar leads) em vez de KPIs zerados travados.
- **Alerta "nenhum lead em 3 dias"**: só disparar se a conta já teve leads antes; conta nova nunca deve receber esse aviso.
- **Sidebar**: agrupar em `Atendimento` (WhatsApp, Leads, Kanban, Pacientes), `Operação` (Agenda, Financeiro, Automações), `Configuração` (Produtos, Planos, Configurações).
- **Header do tenant**: chip com status da instância WhatsApp em tempo real (verde/amarelo/vermelho) — evita descobrir "tá desconectado" só quando a msg não vai.

---

## Passo 4 · Checklist "posso usar amanhã?" (P1 — validação, 20 min)

Rodo pela lista comigo e reporto verde/vermelho antes de você dormir:

- [ ] WhatsApp: recebe + envia (celular e app) + histórico + mídia
- [ ] Leads: entram pelo formulário Meta, entram pelo WhatsApp, aparecem na lista e no Kanban
- [ ] Kanban: mover para "Ganho" dispara CAPI Purchase com valor_proposta
- [ ] Agenda: criar/editar consulta, times/tipos configuráveis funcionando
- [ ] Financeiro: registrar venda, ver KPI de faturamento/ticket, filtrar por range
- [ ] Automações: pelo menos 1 fluxo de recall ativo
- [ ] Produtos: cadastrar e usar no formulário de venda
- [ ] Dashboard: KPIs batendo com Financeiro e Kanban no mesmo range

Se algum item falhar, entro e conserto no mesmo turno.

---

## O que **não** vou fazer nesse ciclo (para não estourar o prazo)

- Não vou reescrever Automações no padrão Kommo completo (fluxo visual drag-and-drop). Fica como Fase 2. O que existe hoje já dispara recall.
- Não vou refatorar cor/tema — a marca atual (preto/dourado POSION) já está aplicada.
- Não vou mexer em Meta Ads / CAPI / Ad Mapping (estão estáveis desde ontem).

---

## Sequência de execução

```text
0h00  Passo 1  WhatsApp reassinar eventos + validar echo
0h30  Passo 2  Página de Leads do tenant + item no sidebar
1h15  Passo 3  Dashboard vazio, alerta condicional, agrupar sidebar
2h00  Passo 4  Rodar checklist e reportar status
```

Total estimado: ~2h de trabalho meu, entrego incremental (não bloqueio tudo até o fim).

Aprova e sigo direto no Passo 1?
