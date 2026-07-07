
## Problema

No teste "teste123", o nó de **Botões** não chegou como botões — apareceu apenas texto cru misturando `{{lead.whatsapp}}{{lead.nome}}`. Isso indica dois defeitos:

1. A chamada `POST /message/sendButtons/{instance}` na Evolution API está com **payload no formato antigo** (`buttonId`/`buttonText`/`type:1`) e sem cabeçalho/`textMessage`. As versões atuais da Evolution rejeitam esse formato e caem no comportamento errado (envia o `description` como texto ou apenas ecoa variáveis).
2. Os campos do editor de Botões estão limitados a `text` + `buttons[]`, mas o dispatcher também espera `title`, `footer`. Sem eles a interpolação fica confusa.

E como o fluxo pausa em Botões, os nós seguintes (kanban, agenda, mensagens) nunca executam — falta ainda garantir o **roteamento pós-clique** por `sourceHandle` do botão.

## O que vai ser feito

### 1. Nó Botões — envio nativo correto (Evolution v2)

Reescrever o branch `buttons` em `sendWhatsapp` para o payload aceito pela Evolution atual:

```json
POST /message/sendButtons/{instance}
{
  "number": "5577...",
  "title": "…",
  "description": "…",     // corpo da mensagem (interpolado)
  "footer": "…",
  "buttons": [
    { "type": "reply", "displayText": "Sim", "id": "btn_sim" },
    { "type": "reply", "displayText": "Não", "id": "btn_nao" }
  ]
}
```

- Interpolar `description`, `title` e `footer` com `{{lead.nome}}`, `{{clinica.nome}}`, etc. antes do envio.
- Guardar `buttonId` estável (`b.id`) para casar com a resposta.
- Após envio bem-sucedido, gravar em `automation_executions`: `status='waiting_response'`, `current_node = <buttonsNodeId>`, e persistir o mapa `{ button_id → target_node_id }` em `context.button_map` para roteamento determinístico.

### 2. Roteamento após clique/resposta

No dispatcher, ao receber `message_received` com uma execução em `waiting_response`:

- Ler `button_map` do `context` da execução.
- Casar a resposta do usuário nesta ordem:
  1. `buttonId` retornado pela Evolution (quando disponível no payload do webhook).
  2. `label` do botão vs texto recebido (case-insensitive).
  3. `sourceHandle`/`label` das arestas saindo do nó de botões vs texto.
- Retomar a partir do `target` da aresta correspondente e continuar executando **todos** os nós subsequentes (mensagens, kanban, agenda) sem parar até o próximo `wait_response`, `buttons`, `list`, `wait` ou `end`.

Ajustar `whatsapp-webhook/index.ts` para incluir no payload do dispatch: `context.button_id` (extraído de `messages[0].message.buttonsResponseMessage.selectedButtonId` ou `templateButtonReplyMessage.selectedId`) além do `text`.

### 3. Editor de Botões — campos completos

Em `NodeEditorPanel.tsx`, para `type === "buttons"` expor:
- `title` (opcional, curto)
- `text`/`description` (obrigatório, com botão de inserir variáveis já existente)
- `footer` (opcional)
- Lista de botões (já existe, mantém limite de 3)

### 4. Interpolação robusta em Mensagem / Áudio / Mídia

- Garantir que `loadFullContext` **sempre** popule `vars.lead.nome` mesmo quando o lead não está cadastrado (fallback a `ctx.name` do pushName do WhatsApp — hoje só popula quando não há lead, mas o ramo do `lead` sobrescreve com `null` se `nome_completo` estiver vazio). Trocar por `vars.lead.nome = lead.nome_completo || ctx.name || ""`.
- Interpolar `caption` da mídia e `text` do áudio (quando houver legenda).
- Corrigir template padrão do `notify_team` para não vazar objetos.

### 5. Kanban (mover / criar / atualizar / tag) e Agenda (criar / link / confirmar / cancelar)

Já implementados no dispatcher, mas atualmente **não são alcançados** porque o fluxo trava em Botões. Após correções 1-2 eles passam a executar. Verificações extras nesta rodada:

- `kanban_move`: validar que `d.value` está entre os status permitidos (`lead|qualificado|reuniao|proposta|negociacao|ganho|perdido`) antes do `UPDATE`, logando erro claro caso contrário.
- `kanban_create`: definir `tenant_id` da execução e retornar novo `lead_id` para o `ctx`, para que nós seguintes (ex.: `appointment_create`) já usem esse lead.
- `appointment_create`: aceitar `d.date_time` relativa (`+1d`, `+2h`) além de ISO; usar `tenant_id` correto e vincular `lead_id` do contexto.
- `appointment_link`: separar `text` e `url` em campos distintos no editor (hoje concatena via string), e enviar como uma única mensagem interpolada.

### 6. Log e verificação

- Cada passo continua gravando em `steps[]` de `automation_executions` com `ok`, `detail` e `node_type` para diagnóstico na aba Histórico.
- Adicionar no `detail` do nó `buttons`: quantidade de arestas mapeadas e IDs dos botões, para debug rápido.

## Arquivos afetados

- `supabase/functions/automation-dispatch/index.ts` — payload Evolution v2 para botões, `button_map` no contexto, roteamento por `button_id`/label na retomada, fallback de nome, interpolação de mídia, validações de kanban/agenda.
- `supabase/functions/whatsapp-webhook/index.ts` — extrair `selectedButtonId` do payload da Evolution e incluir em `context.button_id` ao chamar `automation-dispatch`.
- `src/components/automations/NodeEditorPanel.tsx` — campos `title` e `footer` no editor de Botões; separar `text` e `url` no `appointment_link`.

## Fora do escopo desta rodada

- Cron para retomar `wait` de horas/dias (estrutura já existe no banco).
- Botões nativos via WhatsApp Cloud API (usuário confirmou que Evolution suporta no número dele).
- Fallback de texto numerado (usuário optou por só nativos).

Após aprovado, implemento e testo com `teste123` no seu número para validar que os botões aparecem e que o fluxo prossegue para os nós de kanban/agenda após o clique.
