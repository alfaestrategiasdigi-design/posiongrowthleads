## Diagnóstico

Você criou o fluxo no editor, mas ele **não executa** porque o sistema hoje **só salva o JSON** do fluxo em `automation_flows` — não existe nenhum motor que leia esse JSON, escute o gatilho (mensagem, formulário, etc.) e execute as ações (enviar texto, mover Kanban, etc.).

Evidências:
- Não há edge function de execução de fluxos (`automation-dispatch`, `automation-run`, nada equivalente).
- `whatsapp-webhook` não faz nenhuma referência a `automation_flows` — as mensagens recebidas só são gravadas em `conversations/messages`, nunca disparam gatilhos.
- Não há trigger no banco para `leads` (insert) → `automation_flows(trigger_type='form_submitted')`.
- `automation_executions` existe na tabela mas nenhum código escreve nela.
- O botão **Testar** hoje só mostra um `toast.info` — não simula execução real.

Ou seja, o fluxo está *desenhado*, mas o "cérebro" que interpreta e roda os nós ainda não foi construído.

## O que vou construir

Um motor de automação completo, integrado ao WhatsApp (Evolution), Kanban e Agenda que você já usa.

### 1. Edge function `automation-dispatch` (novo)
Ponto único de entrada para qualquer gatilho. Recebe `{ trigger, tenant_id, context }` (context = lead, mensagem, agendamento, etc.), busca fluxos ativos que combinem, e roda cada um passo a passo. Persiste histórico em `automation_executions` (status, current_node_id, variables, erros).

### 2. Executores de nó (todos os nós da paleta)

| Nó | Ação |
| --- | --- |
| `trigger` | ponto de entrada, avança para o próximo |
| `message` | envia texto via Evolution (ou Cloud API, se configurado) — interpola variáveis |
| `buttons` | envia mensagem com até 3 botões; próximo passo escolhido pelo texto do botão clicado |
| `list` | envia lista de opções (Evolution "list message") |
| `audio` | envia áudio (URL do bucket `whatsapp-media`) |
| `media` | envia imagem/documento (URL) |
| `wait_response` | pausa a execução até nova mensagem do mesmo contato; retoma pelo webhook |
| `wait` | agenda retomada em X min/horas/dias (usa `automation_tasks.scheduled_for` + cron `send-appointment-reminders`-like) |
| `condition` | avalia expressão simples (`lead.status = 'ganho'`, `lead.origem contains 'facebook'`) — decide caminho |
| `split` | A/B aleatório 50/50 |
| `kanban_move` | `UPDATE leads SET status = <coluna>` |
| `kanban_create` | `INSERT INTO leads` com dados do contexto |
| `kanban_update` | atualiza campo do lead |
| `kanban_tag` | grava tag em `leads.observacoes` ou tabela de tags |
| `appointment_create` | insere em `appointments` vinculado ao lead |
| `appointment_link` | envia link do formulário público de agenda |
| `appointment_confirm` / `cancel` | muda `appointments.status` |
| `notify_team` | envia mensagem para números dos `tenant_users` marcados |
| `end` | encerra execução, marca `automation_executions.status='completed'` |

Interpolação de variáveis (`{{lead.nome}}`, `{{lead.whatsapp}}`, `{{lead.email}}`, `{{agendamento.data}}`, `{{clinica.nome}}`) é resolvida com dados do contexto no momento da execução.

### 3. Integração dos gatilhos com o resto do sistema

- **`message_received`** — `whatsapp-webhook` chama `automation-dispatch` sempre que chega mensagem de contato; filtra por `trigger_config.keywords` + `match` (contém / exato / começa com / regex).
- **`form_submitted` / `lead_entered`** — trigger no banco `after insert on leads` chama a função (ou hook no `facebook-leads-webhook`). Filtro por `form_name` opcional.
- **`kanban_moved`** — trigger em `leads.status` update.
- **`appointment_created/confirmed/cancelled`** — trigger em `appointments`.
- **`lead_won`** — trigger em `leads.status = 'ganho'`.
- **`birthday`** — cron diário que compara `patients.birth_date`.
- **`time_delay`** — cron a cada 5 min processando `automation_tasks` com `scheduled_for <= now`.
- **`manual`** — endpoint HTTP acionado pelo botão **Testar** e por "iniciar fluxo" manual.

### 4. Botão **Testar** funcional
Envia payload de teste (lead fictício ou o lead selecionado) para `automation-dispatch` com `dry_run=true` → executa nós em memória sem enviar mensagem real e mostra o log passo a passo em um painel lateral no editor.

### 5. Log e observabilidade
- Nova aba "Execuções" na página de automações listando as últimas rodadas por fluxo (status, contato, tempo, erro).
- Cada nó executado grava um passo em `automation_executions.steps` (jsonb).

### 6. Aprovação e segurança
- `automation_tasks.requires_approval` respeitado para envios em massa.
- Rate limit por tenant (evita loop se fluxo se autodispara).
- Loop-guard: se `automation_executions` da mesma sessão passar de 50 passos, aborta.

### 7. Correções complementares
- Diálogo do nó `list`, `audio`, `media`, `notify_team`, `wait_response`, `split`, `kanban_create`, `appointment_*` — hoje só existem edição para `message/buttons/wait/condition/kanban_*`. Vou adicionar os formulários que faltam no `NodeEditorPanel`.
- Salvar `trigger_config.keywords` como array (hoje é string separada por vírgula) para o motor consumir direto.

## Escopo desta rodada

Entrego todos os itens **1 a 5** e as correções da seção **7** na próxima passagem. Itens 6 (rate limit avançado, aprovação em massa) ficam mínimos: só loop-guard e respeito a `requires_approval` já existente — sem UI de aprovação nova, para caber no ciclo.

## Perguntas rápidas antes de implementar

1. Confirmar que o canal de envio é **Evolution API** (`evolution-send`) — vejo tanto Evolution quanto WhatsApp Cloud API no projeto. Uso o que já estiver conectado no tenant.
2. Áudio e mídia: aceito que o usuário cole URL pública (ou do bucket `whatsapp-media`) no editor? Ou quer upload direto dentro do nó?

Se as respostas forem "sim, Evolution" e "URL basta por enquanto", parto direto.