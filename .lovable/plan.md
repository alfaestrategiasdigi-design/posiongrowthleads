## Diagnóstico READ-ONLY — direção de mensagens no WhatsApp

Auditei todos os pontos que gravam/leêm `direction` (webhook, envio, sync, UI). Segue o mapa e os desvios.

### Onde a direção é decidida hoje

**Fonte da verdade (correto):** `supabase/functions/whatsapp-webhook/index.ts:1121`
```ts
const fromMe: boolean = Boolean(key?.fromMe ?? m?.fromMe);
...
// linha 1528
direction: fromMe ? "outbound" : "inbound",
status:    fromMe ? "sent"     : "delivered",
sender:    fromMe ? "usuario"  : "cliente",   // linha 1523
```
Vem direto do `fromMe` da Evolution. ✅ Aderente à spec (item 1).

**Outros writers de `messages`:**
- `evolution-send/index.ts:167` — envio pelo painel, hardcoded `direction: "outbound"`, `sender: "usuario"`. ✅ Correto (só é chamado no envio).
- `whatsapp-cloud-webhook/index.ts:162` — canal Cloud API, hardcoded `direction: "inbound"`. ✅ (essa função só processa recebidos).
- `evolution-sync-messages/index.ts` e `evolution-sync-messages-bulk` — **não inserem direto**; fazem replay POST no `whatsapp-webhook` preservando `key.fromMe` do histórico da Evolution. ✅ (linha 109 do sync-messages).

**Verdicto do backend:** nenhum lugar infere direção. `direction` é sempre derivado do `fromMe` do payload.

### Desvios da spec

#### 🔴 Desvio 1 — UI não usa `direction`, usa `sender`
`src/pages/admin/WhatsAppChat.tsx`
- Linha 1169: `const isOut = msg.sender === "usuario";`
- Linha 919: `isFromOtherDevice` também depende de `sender === "usuario"`.
- Linha 929: `renderStatus` idem.

Contraria a spec (item 2: "inbound sempre à esquerda, outbound sempre à direita"). Hoje o lado do balão depende de `sender`, não de `direction`. Como todos os writers gravam os dois campos coerentes, isso funciona por coincidência — mas qualquer regressão futura em `sender` (ex.: um novo writer esquecer de setar) vai renderizar do lado errado sem que ninguém perceba. **Ponto a corrigir:** trocar `msg.sender === "usuario"` por `msg.direction === "outbound"` em `WhatsAppChat.tsx` (linhas 919, 929, 1169) — e usar `direction` como fonte única na UI.

Validação: a query `SELECT direction, sender, COUNT(*) FROM messages GROUP BY 1,2` retornou só 2 combinações (`inbound/cliente` = 3365, `outbound/usuario` = 2321). Nenhum caso divergente no banco hoje — mas exatamente por isso o bug relatado deve estar vindo de outro lugar (ver Desvio 2 e 3).

#### 🟠 Desvio 2 — ACKs criam mensagem "delivered" nova quando não achavam o wamid
`supabase/functions/whatsapp-webhook/index.ts:1013-1037` (branch `messages.update`).
- Se o `wamid` do ACK não bate com nenhuma linha, cai no fallback "última outbound sem ACK no conversation por JID/telefone" e faz `UPDATE`. Isso está OK.
- **Porém**, o ACK **não gera INSERT** — bom, atende a spec (item 3). ✅
- Detalhe potencialmente ruim: quando o fallback casa, ele grava `wamid` **do ACK** numa mensagem que originalmente foi inserida sem `wamid`. Se o `evolution-send` (linha 160) enviou a mensagem antes de a Evolution devolver `wamid`, o `wamid` do ACK pode não corresponder ao wamid real da mensagem (o send salva `wamid = j?.key?.id ?? null` — se vier null, essa linha fica órfã e pode absorver o wamid errado de um ACK subsequente de outra mensagem no mesmo contato).
- Não afeta direção diretamente, mas leva ao Desvio 3.

#### 🟠 Desvio 3 — Dedup por conteúdo em janela de 15s pode "adotar" mensagem física com direção certa mas texto igual
`whatsapp-webhook/index.ts:1495-1511`
- Quando chega um evento `fromMe=true` (echo de mensagem enviada de outro aparelho) e existe uma linha outbound recente com o mesmo `conteudo`, o webhook **não insere**; só faz UPDATE do `wamid` e `status="delivered"` na linha existente.
- Isso está correto conceitualmente, mas depende de conteúdo idêntico + 15s. Se a mensagem física demorar >15s pra chegar como echo, entra como INSERT novo (correto: `direction: outbound`). Se chegar <15s de uma mensagem outbound diferente com mesmo texto (ex.: "ok"), pode absorver o wamid errado. Não gera direção invertida, mas pode fazer o ACK de uma mensagem cair na outra — dando aparência de "não marcou".

#### 🟡 Desvio 4 — Não há teste manual de webhook na UI
Rebusquei em `src/pages/admin/ConexaoWhatsappPage.tsx` e todo o `src/`: **não existe um botão "Testar webhook" que POSTe um payload sintético no `whatsapp-webhook`**. Só existem os testes Deno em `whatsapp-webhook/*_test.ts` (arquivos `routing_test.ts`, `outbound_integration_test.ts`) — esses são executados via `deno test`, não pela UI, e usam a função pura `resolveRemoteJid` (não passam pelo INSERT em `messages`), então **não contaminam dados reais**. ✅ Spec item 5 já está atendida por ausência: nenhum caminho especial de "teste" grava com direção diferente.

Se você quer **adicionar** um botão de teste manual na tela de configuração, aí sim a spec passa a exigir que o payload leve `fromMe` explícito e caia no mesmo pipeline sem branch especial — hoje esse botão simplesmente não existe.

#### 🟢 Dedup por `wamid` antes de insert
`whatsapp-webhook/index.ts:1491-1494` — faz `SELECT id FROM messages WHERE wamid=? .maybeSingle()` e faz `continue` se encontrar. ✅ Aderente à spec (item 4).

### Resumo do que precisa mudar (sem aplicar)

| # | Arquivo | Linhas | Problema | Correção sugerida |
|---|---|---|---|---|
| 1 | `src/pages/admin/WhatsAppChat.tsx` | 919, 929, 1169 | UI decide o lado do balão por `sender`, não por `direction` | Trocar para `msg.direction === "outbound"` como fonte única |
| 2 | `supabase/functions/evolution-send/index.ts` | 153, 160-173 | Se Evolution devolve `wamid=null`, a linha outbound fica órfã e pode receber wamid de outro ACK | Não inserir a linha até ter `wamid`, ou marcar `status:"sending"` e reconciliar via `wamid-reconcile` |
| 3 | `supabase/functions/whatsapp-webhook/index.ts` | 1495-1511 | Dedup por conteúdo+15s pode absorver wamid errado quando textos coincidem | Endurecer dedup: exigir `sender="usuario"` **e** `wamid IS NULL` na linha alvo, e casar por `messageTimestamp` também |
| 4 | (opcional) `ConexaoWhatsappPage.tsx` | — | Não há botão de teste manual do webhook | Se for adicionar, POST direto no `whatsapp-webhook` com payload `messages.upsert` real (com `fromMe` explícito), sem branch especial no backend |

### O que **não** precisa mudar
- Lógica de derivação de `direction` a partir de `fromMe` no webhook. ✅
- Dedup por `wamid`. ✅
- ACK como UPDATE (nunca INSERT). ✅
- `evolution-sync-messages*` (só replay, preserva `fromMe`). ✅
- Dados atuais no banco: 100% coerentes entre `direction` e `sender` — não há registro para reparar, apenas endurecer o pipeline pra impedir divergência futura.

Me confirma quais itens você quer que eu implemente (recomendo #1 + #3; #2 é o mais delicado porque muda o fluxo do envio; #4 só se você quiser mesmo a UI de teste).
