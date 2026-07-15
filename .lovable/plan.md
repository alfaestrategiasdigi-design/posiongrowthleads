## Diagnóstico

**Causa raiz das mensagens que não chegam no WhatsApp do Instituto Roar (Dr Matheus Azevedo):**

Os logs do `whatsapp-webhook` mostram, exatamente durante os testes que você está fazendo agora (07-15 14:2x UTC), rejeição por segredo inválido:

```
WARNING [whatsapp-webhook] invalid_secret {
  instanceName: "Dr Matheus Azevedo",
  tenant: "f259af97-8ddc-4a07-99ed-19fcb3ba631b"
}
```

O que aconteceu: o `webhook_secret` salvo em `zapi_connections` foi renovado, mas a Evolution API ainda está enviando eventos com o segredo antigo na URL. Resultado: a função devolve 401 e nenhuma mensagem entra no banco. É por isso que a "última interação" desse tenant travou em 14/07 e seus testes de hoje não aparecem — o Evolution está chamando, o webhook está recusando.

Confirmações complementares:
- Nas últimas 48h: 335 mensagens ingressaram para `tenant_id NULL` (instância master `POSIONGROWTHLEADS`) — ela está funcional; só o `Dr Matheus Azevedo` está bloqueado. Os outros tenants (donnaface, drgabriel) também sofrem do mesmo risco silencioso.
- Não existe filtro de servidor "somente lead de formulário". As 412 conversas mostradas são as antigas; o chip "Somente com lead (396/412)" na sua tela está **ligado** (você clicou), então esconde 16. Ao desligar, elas voltam a aparecer. Isso é ortogonal ao problema real das mensagens novas.

## O que vou implementar

### 1. Recuperar o Instituto Roar agora e para sempre

- Executar `evolution-resubscribe` para o tenant `Dr Matheus Azevedo` (via botão exposto — sem SQL manual), o que faz Evolution regravar a URL de webhook com o `webhook_secret` **atual**. Isso destrava o ingest imediatamente.
- Em seguida, `evolution-sync-chats` (já existe) puxa os chats/últimas mensagens que ficaram perdidos durante a janela em que o webhook estava 401.

### 2. Botão "Reassinar webhook" na página WhatsApp de cada tenant

Adicionar, ao lado do "Sincronizar chats" já existente em `WhatsAppChat.tsx` (que serve tanto master quanto tenant), um botão **"Reassinar webhook"** que:
1. chama `evolution-resubscribe` com o `tenant_id` corrente,
2. mostra o resultado (sucesso/erro) em toast,
3. em caso de sucesso, dispara automaticamente `evolution-sync-chats` para recuperar mensagens perdidas,
4. recarrega a lista.

Isso deixa o operador da clínica autossuficiente para o próximo dia em que a Evolution "esquecer" o segredo (reinicialização de container, restauração de backup, etc.).

### 3. Detecção automática + alerta

- Em `WhatsAppChat.tsx`, quando a última mensagem inbound do tenant for maior que **6h** e o status da conexão estiver `connected`, mostrar um banner amarelo no topo da lista:  
  *"Conexão conectada, mas sem mensagens há X horas. Clique em Reassinar webhook."*
- Um segundo indicador vermelho aparece se, ao consultar o status, detectarmos qualquer `invalid_secret` recente (via contagem simples de `messages` recebidas na janela). Assim o problema não fica invisível por dias.

### 4. Endurecer o webhook para se auto-curar quando seguro

No `whatsapp-webhook/index.ts`, quando:
- o `instanceName` do payload bater com uma conexão registrada,
- o `tenantSlug`/`tenant_id` da URL também bater com essa conexão,
- e o `webhook_secret` **estiver vazio** no banco (nunca foi setado),

então gravar o segredo recebido em vez de recusar. Isso resolve o caso "instância nova sem secret ainda". **Não** vamos aceitar segredo diferente do gravado — a proteção anti-spoofing continua.

### 5. Correção secundária no chip "Somente com lead"

- Manter o default **off** (já está), mas persistir a escolha em `localStorage` por tenant para não confundir (hoje ele volta a `false` a cada reload, o que faz o operador clicar sem saber, e depois estranha o filtro).
- Ajustar o rótulo para deixar claro que é um filtro do lado do cliente: **"Filtrar: somente com lead vinculado"**, e mudar o tooltip para *"Oculta conversas de números que ainda não viraram lead. Não altera o que chega no sistema."*

### Detalhes técnicos

Arquivos tocados:
- `src/pages/admin/WhatsAppChat.tsx` — novo botão "Reassinar webhook", banner de detecção, persistência do chip, chamada dupla `evolution-resubscribe` → `evolution-sync-chats`.
- `supabase/functions/whatsapp-webhook/index.ts` — bloco de auto-cura só quando `webhook_secret IS NULL`, sem mudar a lógica atual de rejeição para segredos divergentes.

Nada é alterado em:
- `evolution-resubscribe` (já grava o segredo atual na Evolution — é exatamente o que precisamos).
- Regras de roteamento por `instance_name`/`tenant_id` no webhook (estão corretas).
- Realtime das conversas (já funciona; ele só parece parado porque nada estava sendo gravado).

### Fora do escopo desta iteração

- Não vou mexer no pipeline da ficha do paciente, no modal de fechamento nem no dashboard — essas correções já foram entregues nos blocos anteriores.
- Não vou trocar o provedor Evolution nem mexer no host/porta da instância.
