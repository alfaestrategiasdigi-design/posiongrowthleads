## Problema
O painel de alertas está renderizando um card grande para cada campanha com "Hook Rate fraco" (uma linha por campanha), empurrando os cards de campanha para baixo e dominando a tela. Além disso, o alerta dispara mesmo quando o hook rate é baixo por pouco volume de vídeo (falso positivo).

## Mudanças

**1. `src/components/campaigns/AlertsPanel.tsx` — versão compacta e recolhível**
- Renderizar por padrão apenas 1 linha resumo: "⚠️ 8 alertas · 0 críticos" com botão "Ver detalhes" para expandir.
- Se houver 0 alertas, mantém o card verde atual (curto).
- Quando expandido, agrupar por título (ex.: "Hook Rate fraco (8)") em vez de repetir card por campanha; ao clicar no grupo, mostra a lista das campanhas afetadas.
- Reduzir padding e tamanho de fonte para não competir visualmente com os cards.

**2. `src/pages/app/TenantCampaigns.tsx` — regras mais rigorosas para reduzir ruído**
- Só emitir "Hook Rate fraco" quando `impressions >= 1000` **e** `video_views >= 200` (evita alertar campanhas de foto/baixo volume).
- Só emitir "Frequência alta" quando `impressions >= 2000`.
- Limitar a no máximo 3 alertas por regra (os piores casos); adicionar contador "+N campanhas" no grupo.

**3. Posicionamento**
- Mover o `<AlertsPanel>` para **depois** do grid de campanhas (hoje aparece antes), para que os cards fiquem no topo, imediatamente após os KPIs e o funil.

## Resultado esperado
Cards de campanhas ganham destaque no topo da página; alertas ficam como uma faixa fina recolhível abaixo, sem esconder informação (basta um clique para expandir agrupado por tipo).
