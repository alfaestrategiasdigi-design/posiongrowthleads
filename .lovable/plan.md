## Bloco 1 — WhatsApp Roar + Gatilhos de automação

Escopo desta entrega: fazer o WhatsApp do tenant **Dr Instituto Roar** (`f259af97-…`) sair de "Pareando" e receber/enviar mensagens de verdade, e fazer os **gatilhos de automação** do tenant realmente dispararem. Os outros itens (pipeline na ficha, roteamento de formulários, refactor de Fechamentos) ficam para blocos seguintes.

---

### O que eu encontrei

**WhatsApp Roar**
- Existe uma conexão Z-API para o Roar (`Dr Matheus Azevedo`) mas o `status` está travado em `connecting` — por isso o cabeçalho mostra "Pareando".
- Ao mesmo tempo, mensagens ESTÃO chegando na tabela `messages` para esse tenant (última: hoje 14:40). Ou seja: o webhook funciona, mas ninguém atualiza o `status` para `connected`, e a UI trata a conexão como não pareada (bloqueando envios, banner de aviso, etc.).
- A conexão Cloud API (Meta) global também está com token expirado desde 19/jun — está sujando o diagnóstico da tela de admin mas não afeta o Roar (que usa Z-API).

**Automações do Roar**
- Todos os fluxos do tenant Roar estão em `paused` ou `draft` (só `message_received` está `active`).
- O trigger `trg_fire_automation_lead` dispara `automation-dispatch` corretamente — a prova é que os fluxos do MASTER (`is_admin_master=true`) estão executando (várias `completed` hoje).
- Ou seja: o dispatcher funciona, mas a função `automation-dispatch` provavelmente só está pegando fluxos `status='active'` e/ou não está considerando `tenant_id` do lead ao buscar fluxos do tenant. Preciso confirmar (leitura rápida da função) e garantir que:
  1. Fluxos com `status='paused'` fiquem visíveis na UI para o usuário ativar (hoje aparentemente estão sendo criados como `paused` sem o usuário perceber).
  2. Quando um lead entra com `tenant_id = X`, o dispatcher busque fluxos onde `tenant_id = X AND status = 'active'` (e não misture com Master).

---

### Plano de execução

**1. WhatsApp Roar — destravar "Pareando"**
- Ler `supabase/functions/evolution-status/index.ts` e `evolution-connect/index.ts` para entender a máquina de estados.
- Ler `supabase/functions/whatsapp-webhook/index.ts` (Z-API) e, quando chegar qualquer evento (mensagem, ack, conexão), sincronizar `zapi_connections.status = 'connected'` para o `tenant_id` correspondente.
- Adicionar botão "Reparear/Sincronizar status" na tela `TenantWhatsApp` que chama `evolution-status` e força a atualização do status a partir do estado real da instância na Z-API.
- Corrigir a UI (`TenantWhatsApp` / header do chat) para: se houve mensagem nas últimas 24h daquele `tenant_id`, considerar como "Conectado" mesmo que o campo `status` esteja atrasado (fallback defensivo).

**2. Automações do tenant — fazer os gatilhos dispararem**
- Ler `supabase/functions/automation-dispatch/index.ts` e confirmar o filtro por `tenant_id` + `status='active'`.
- Corrigir o dispatcher para:
  - Buscar fluxos **do próprio tenant** do lead/appointment (nunca cruzar tenants).
  - Buscar fluxos `is_admin_master=true` apenas quando o evento não tem tenant (funil Master).
  - Logar em `automation_executions` (com `last_error`) sempre que um trigger dispara mas nenhum fluxo bate — hoje não há rastro disso.
- Na página de Automações do tenant (`TenantRecall`/`AutomationsPage`), garantir que fluxos criados via seed (`trg_seed_form_greeting_flow`) sejam criados com `status='active'` (hoje o do Roar está `paused`) e mostrar um alerta "X fluxos pausados — ativar" no topo.
- Adicionar botão "Testar disparo" por fluxo (dispara um `automation-dispatch` com um contexto fake do próprio tenant e mostra o resultado).

**3. Verificação**
- Reprocessar o status da conexão Z-API do Roar e confirmar UI = "Conectado".
- Ativar o fluxo "Boas-vindas após formulário" do Roar, inserir um lead de teste com `tenant_id` do Roar e conferir `automation_executions` gerando execução `completed` do fluxo do Roar (não do Master).
- Consultar `messages` e `automation_executions` para confirmar isolamento por `tenant_id` (nada com `tenant_id NULL` deve entrar aqui).

---

### Isolamento por tenant (regra que atravessa tudo)
Toda query nova (dispatcher, status, UI) filtra estritamente por `tenant_id` do contexto. Nenhum fallback silencioso para `tenant_id IS NULL` (funil Master) em telas de clínica. Isso vale também para os blocos seguintes.

---

### Próximos blocos (não incluídos aqui — confirmo antes de começar cada um)
- **Bloco 2**: pipeline correto na ficha do paciente das clínicas (`Lead Novo → Início Atend. → Agendar Consulta → Proposta → Negociação → Ganho → Paciente Ativo → Perdido`) — hoje aparece o do Master.
- **Bloco 3**: refactor de "Registrar Fechamento" — Procedimento vindo de `tenant_products` (por tenant), Canal como combobox criável persistido em `tenant_custom_options` com `tenant_id`, edição de fechamento existente na listagem, histórico preservado.
- Sobre "formulários do Roar não marcam em Leads": as 9 regras de roteamento já estão corretas no banco. Os leads recentes que chegaram nas últimas 72h vieram do form `1732941891349945` (Master), não dos 9 do Roar — vou investigar isso junto do Bloco 2 (é sync do Facebook, não roteamento).

Posso implementar o Bloco 1 agora?
