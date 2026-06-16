## Evolução da Landing Page Posion

Mantém o design atual (escuro + dourado, geo-pattern, gold gradient) e adiciona 5 blocos novos sem refazer hero/cases/services.

### 1. Nova seção `ResultsSection.tsx` (gráficos Recharts)
Inserida entre `SocialProof` e o footer. Três cards lado a lado em desktop, stack no mobile, todos com tokens existentes (`card-tech`, `gold-gradient-text`):

- **LineChart — Faturamento Antes/Depois (6 meses)**: dados mock realistas (Jan-Jun), linha "Antes" cinza tracejada vs "Depois" dourada, tooltip dark.
- **BarChart — Origem dos Leads**: Facebook, Instagram, Google, Orgânico, Indicação. Barras douradas com radius topo.
- **PieChart (donut) — Distribuição por Especialidade**: Odontologia, Estética, Derma, Plástica, Capilar, Outras. Paleta dourado→âmbar→sépia para manter o tom.

Todos com `ResponsiveContainer`, eixos `#94a3b8`, grid `#2a2a3a`, fundos via tokens.

### 2. Animações CSS (em `index.css`)
Adiciono keyframes/utilities reutilizáveis:
- `fade-in-card` (300ms, stagger via `animation-delay`).
- `count-up` aplicado em hook `useCountUp(target, duration)` para os números do hero (+200, R$ 50M+, 9 dígitos) e nos KPIs antes/depois — anima quando entra no viewport (`IntersectionObserver`).
- `cta-glow` (box-shadow pulsante dourado, 2s infinite) aplicado no CTA principal "Quero meu diagnóstico".
- `pillar-hover` nos cards de BenefitsSection: scale 1.03 + glow + translateY -4px.
- `bounce-soft` para os botões flutuantes (1.2s infinite, suave).

### 3. CTAs Flutuantes (`FloatingCTAs.tsx`)
Componente fixo renderizado em `Index.tsx`:
- **WhatsApp** (bottom-right, verde `#25D366`): abre `https://wa.me/55...` (placeholder configurável).
- **Diagnóstico** (bottom-left, dourado): scroll suave até `#quiz`.
- Ambos circulares 56px, ícone + label expansível no hover, `bounce-soft`, z-50, ocultos quando o hero ainda está visível (opcional via observer).

### 4. Novo `TestimonialsSection.tsx`
6 depoimentos baseados nas imagens já no projeto (`Dr-Pedro`, `Dr-Ruan`, `Dra-Andressa`, `Dra-Patricia`, `Dr_-Diego`, `Dr-Fuvio`). Grid 3 col desktop / 1 col mobile.
- Card: foto circular 64px + nome + especialidade + resultado destacado (ex.: "+R$ 10M em vendas").
- 5 estrelas douradas (lucide `Star` fill).
- Hover: card eleva, mostra parágrafo detalhado oculto (max-height transition), borda dourada acende.

### 5. `BeforeAfterSection.tsx` — Antes/Depois interativo
- Slider horizontal (shadcn `Slider` 0-100) que controla um split entre dois "estados" visuais lado a lado.
- 4 KPIs com count-up reagindo à posição do slider:
  - Faturamento: R$ 28k → R$ 142k
  - Leads/mês: 35 → 380
  - Taxa de conversão: 2% → 11%
  - Ticket médio: R$ 1.8k → R$ 6.5k
- Transição suave nos números (interpolação linear) + barra de progresso dourada por KPI.

### 6. Integração em `Index.tsx`
Ordem final: Header → Hero → Cases → Benefits → Services → Steps → **Results** → **BeforeAfter** → **Testimonials** → SocialProof → Footer + `<FloatingCTAs />`.

### Detalhes técnicos
- Recharts já está no projeto (usado no admin Dashboard).
- Nenhuma mudança de schema/backend.
- Hook utilitário `src/hooks/useCountUp.ts` + `useInView.ts` (IntersectionObserver simples).
- Nenhuma cor hardcoded — só tokens `accent`, `foreground`, `muted-foreground`, `card`, `border` + as classes utilitárias existentes (`gold-gradient-text`, `card-tech`, `card-elevated`, `gradient-accent`).
- Imagens dos médicos da landing posiongrowth.com.br já estão como `.asset.json` em `src/assets/posion/` — reuso direto via import.
- Referência G4 Business é só para densidade/hierarquia editorial; não copio layout, mantenho a identidade Posion.

### Arquivos
**Criados:** `src/components/ui/ResultsSection.tsx`, `src/components/ui/TestimonialsSection.tsx`, `src/components/ui/BeforeAfterSection.tsx`, `src/components/ui/FloatingCTAs.tsx`, `src/hooks/useCountUp.ts`, `src/hooks/useInView.ts`.
**Editados:** `src/pages/Index.tsx` (compor seções + CTAs), `src/index.css` (keyframes), `src/components/ui/HeroSection.tsx` (count-up nos 3 números + glow no CTA), `src/components/ui/BenefitsSection.tsx` (classe `pillar-hover`).

Confirme para eu implementar.