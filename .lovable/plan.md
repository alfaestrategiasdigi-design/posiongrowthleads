## Resposta rápida

Sim, a Evolution API tem endpoint de botões — pesquisei duas versões da doc oficial:

- **Evolution Foundation v2.3.7** (`docs.evolutionfoundation.com.br`) — `POST /message/sendButtons/{instanceName}` com payload:
  ```json
  { "number": "...", "text": "...", "footerText": "...",
    "buttons": [ { "buttonId": "btn_sim", "buttonText": { "displayText": "Sim" } } ] }
  ```
- **Evo API Cloud / v2.1.x** (`docs.evoapicloud.com`) — mesmo endpoint, mas payload no formato mais novo:
  ```json
  { "number": "...", "title": "...", "description": "...", "footer": "...",
    "buttons": [ { "type": "reply", "displayText": "Sim", "id": "btn_sim" } ] }
  ```

Ou seja: **o recurso existe**, mas o formato do payload depende da versão/fork da Evolution que roda no seu servidor. O código atual está no formato v2.1.x, e o WhatsApp mostrou "Aguardando mensagem" — sinal de que a instância provavelmente é a Foundation (v2.3.x) e rejeitou o payload novo. Por isso caiu no fallback de texto numerado.

Não é preciso remover a configuração — dá para consertar.

## O que fazer

### 1. Detectar a versão da Evolution e usar o payload correto

Antes do primeiro `sendButtons`, chamar `GET /` na base da Evolution (retorna `{ version: "2.3.7" }` ou similar) e cachear em memória por 10 min. Se `version >= 2.3.0` → payload Foundation; senão → payload v2.1.x.

### 2. Reintroduzir o envio nativo em `automation-dispatch`

No branch `buttons` do `sendWhatsapp`:
- Montar payload de acordo com a versão detectada.
- Interpolar `text`/`description`, `title` (só v2.1.x), `footer`/`footerText` com `{{lead.nome}}` etc.
- Persistir `context.button_map = { buttonId → targetNodeId }` a partir das arestas de saída (ordem dos botões = ordem das arestas).
- Marcar execução como `waiting_response`.

### 3. Fallback automático para texto numerado

Se `POST /message/sendButtons` responder `4xx/5xx` ou o webhook não receber resposta em 60s de teste manual, o dispatcher tenta reenviar como texto numerado (código que já existe hoje) e mantém `button_map` casando por número (`1`, `2`, `3`) e por label.

### 4. Roteamento na resposta (já parcialmente pronto)

Em `whatsapp-webhook`, extrair `selectedButtonId` de `buttonsResponseMessage.selectedButtonId` **ou** `templateButtonReplyMessage.selectedId` **ou** `interactiveResponseMessage`, e passar para o dispatch. O dispatcher casa nesta ordem: `button_id` exato → número (`^\s*([1-3])`) → label case-insensitive → primeira aresta.

### 5. UI (`NodeEditorPanel.tsx`)

Manter os campos já existentes (título, texto, rodapé, até 3 botões). Adicionar um pequeno aviso: *"Se o WhatsApp do lead não renderizar os botões nativos, o fluxo envia como lista numerada automaticamente."*

## Arquivos afetados

- `supabase/functions/automation-dispatch/index.ts` — detectar versão, montar payload correto, fallback numerado, `button_map`.
- `supabase/functions/whatsapp-webhook/index.ts` — extrair `selectedButtonId` de todos os formatos.
- `src/components/automations/NodeEditorPanel.tsx` — texto de aviso (pequeno ajuste de cópia).

## Fora do escopo

- Migrar para WhatsApp Cloud API (botões oficiais garantidos).
- Listas interativas (`sendList`) — fica para outra rodada.

Confirma que quer seguir com essa abordagem (tentar nativo + fallback), ou prefere **remover** o nó Botões e usar só texto com opções numeradas?