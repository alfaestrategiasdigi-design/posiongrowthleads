
## Objetivo
Criar, para **todos os tenants**, uma automação padrão que dispara assim que um lead preenche um formulário (Facebook Ads / qualquer form) enviando uma mensagem no WhatsApp avisando que a equipe entrará em contato.

## O que será feito

### 1. Migration — seed de automação por tenant
Criar migration que insere em `automation_flows` um fluxo para cada tenant existente que ainda não tenha um fluxo com a chave `auto_form_greeting` (para evitar duplicatas em re-runs):

- `name`: "Boas-vindas após formulário"
- `trigger_type`: `form_submitted`
- `trigger_config`: `{ "form_name": "", "key": "auto_form_greeting" }` (vazio = qualquer formulário)
- `status`: `active`
- `nodes`:
  1. `trigger` (form_submitted)
  2. `message` com texto padrão (ver abaixo)
- `edges`: trigger → message

**Texto padrão da mensagem:**
> Olá {{lead.nome}}! 👋 Recebemos seu contato e nossa equipe já foi notificada. Em instantes um especialista vai falar com você por aqui. Obrigado pelo interesse!

### 2. Trigger para novos tenants
Adicionar function + trigger `AFTER INSERT ON public.tenants` que cria automaticamente o mesmo fluxo padrão para qualquer tenant novo — assim a cobertura continua "todos os tenants" no futuro sem intervenção manual.

### 3. Garantir disparo no webhook de formulários
Verificar que `facebook-leads-webhook` (e criação manual de lead com origem formulário) chama `automation-dispatch` com `trigger: "form_submitted"`. Se já chama, nenhuma mudança de código; se não, adicionar o invoke.

## Fora do escopo
- Não altera o editor de automações nem a UI.
- Não sobrescreve fluxos já existentes do tenant.
- Não muda o texto de fluxos que o tenant já customizou.

## Confirmações necessárias
1. Texto da mensagem acima está OK ou você quer outro?
2. Disparar em **qualquer** formulário, ou apenas nos vindos do Facebook Ads?
