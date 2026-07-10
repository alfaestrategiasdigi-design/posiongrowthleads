## Objetivo

Trazer, da conexão da evolution o sistema nao usa mais zapi

"Dr Matheus Azevedo - Agendamento" (tenant Dr Matheus), os **490 contatos** como leads na base e todos os **chats/conversas em aberto** (579 mensagens indicadas) para a caixa de conversas do sistema. Depois desse passo, você envia o export do Kommo para a próxima carga.

## O que já existe

- `evolution-sync-chats` — cria/atualiza registros em `conversations` (nome, telefone, foto, última interação). ✅ pode ser reutilizada.
- `evolution-sync-messages` — puxa histórico de mensagens de cada chat. ✅ pode ser reutilizada.
- `evolution-sync-contacts` — só grava alias @lid ↔ telefone; **não cria lead**. Precisa ser estendida.

## O que muda

### 1. Nova função `zapi-import-contacts-as-leads`

- Entrada: `{ tenant_id, connection_id, create_leads: true, default_status: "lead" }`.
- Chama `/chat/findContacts/{instance}` na Z-API e itera todos os contatos (esperado ~490).
- Para cada contato com telefone válido:
  - Normaliza o número (mesma lógica de `normalizeJid`/`onlyDigits` das funções existentes).
  - Faz **dedupe** pelo índice `idx_leads_phone_norm` (`normalize_phone(whatsapp)`) dentro do `tenant_id`. Se já existe lead com esse telefone → só atualiza nome/foto se estiverem vazios.
  - Se não existe → insere em `leads` com:
    - `nome_completo` = nome do contato (fallback: telefone formatado)
    - `whatsapp` = telefone E.164
    - `tenant_id` = do request
    - `status` = `"lead"`
    - `origem` = `"whatsapp_import"`
    - `extras` = `{ source: "zapi_contacts", jid, imported_at }`
- Retorna: `{ total, created, updated, skipped }`.

### 2. Ajuste em `evolution-sync-chats`

- Aceitar novo flag `link_leads: true`. Após upsert de cada `conversation`, procurar lead pelo telefone (mesmo dedupe) e preencher `conversations.lead_id` se estiver vazio (garante que a caixa mostra a conversa vinculada ao lead recém-importado).

### 3. Botão no card de conexão (Admin → WhatsApp)

Onde já aparece o card com "Dr Matheus Azevedo - Agendamento / 490 / 579 / Connected" (`src/pages/admin/WhatsAppStatusPage.tsx` — card da conexão Z-API): o card nao é da zapi é da evolution msm

- Adicionar botão **"Importar 490 contatos + conversas"**.
- Ao clicar, dispara em sequência, com toast de progresso:
  1. `zapi-import-contacts-as-leads` → cria leads
  2. `evolution-sync-chats` com `link_leads: true, with_pictures: true` → cria/atualiza todas as conversas
  3. `evolution-sync-messages` para cada conversa retornada (limite de últimas N por conversa, ver Configuração abaixo)
- Ao final, mostra resumo: "X leads criados, Y conversas importadas, Z mensagens sincronizadas".

### 4. Configuração da importação (modal do botão)

Antes de disparar, abre um pequeno diálogo com:

- Quantidade de mensagens por chat a puxar (default 50)
- Marcar/desmarcar "criar leads dos contatos"
- Marcar/desmarcar "baixar fotos de perfil"

## Fora de escopo (para o próximo passo)

- Import do CSV/planilha exportada do Kommo — será feito quando você enviar o arquivo. Nesta rodada só preparamos o pipeline Z-API → leads/conversas.

## Arquivos afetados

- **Novo**: `supabase/functions/zapi-import-contacts-as-leads/index.ts`
- **Editado**: `supabase/functions/evolution-sync-chats/index.ts` (flag `link_leads`)
- **Editado**: `src/pages/admin/WhatsAppStatusPage.tsx` (botão + modal de importação)

Nenhuma migração de banco necessária — usamos as tabelas `leads` e `conversations` existentes.