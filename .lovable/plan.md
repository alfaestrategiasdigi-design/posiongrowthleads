## Direção visual proposta (aguardando OK)

**Bolhas de mensagem** — abandonar o gradiente dourado saturado atual da bolha enviada. Ambas ficam sobre superfície escura: recebida em `#0f0f0f` alinhada à esquerda com hairline `rgba(201,162,39,0.14)`, enviada em `#1a1712` (grafite quente) alinhada à direita com hairline `rgba(201,162,39,0.32)` e um fio dourado interno de 1px no topo (`inset 0 1px 0 rgba(201,162,39,.12)`). Cantos 14px com o canto de "cauda" reduzido a 4px, sombra única suave (`0 8px 20px -14px rgba(0,0,0,.8)`), texto sempre em `#efe9d8`. Distinção = alinhamento + tom + intensidade da hairline, sem cor saturada.

**Player de áudio** — substituir o `<audio controls>` nativo por um `WhatsAppAudioPlayer` custom em uma linha só: botão circular 32px preto com ícone play/pause dourado (`hsl(var(--wa-gold-soft))`), waveform/track fina de 3px em `rgba(201,162,39,.18)` com progresso preenchido em `hsl(var(--wa-gold) / .85)` e thumb dourado 8px, tempo à direita em JetBrains Mono 10px. Usa `HTMLAudioElement` sob o capô (mesma `msg.media_url`, mesmo comportamento de download/stream) — só a UI muda.

**Escopo adicional já incluído** (sem alteração de comportamento):
- Cabeçalho do contato: nome em Fraunces, telefone em JetBrains Mono, ícones de ação com `.wa-icon-btn` existente e hairline dourado inferior.
- Campo de digitar: reaproveita `.wa-input` (mesma borda, padding, placeholder muted) já usado no search da lista.

**Fora do escopo**: cores, dados, ícones, integrações, upload/gravação de áudio, tipos de mídia — tudo preservado.

Confirma essa direção para eu aplicar?