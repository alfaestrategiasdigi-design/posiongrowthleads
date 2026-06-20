## Objetivo

Padronizar todo o painel admin master (Alfa) na paleta Midnight Indigo, eliminar resíduos amarelos/dourados, refinar o hero da landing e transformar a página de Qualificação em um construtor modular de formulário.

---

## 1) Padronização do branding (remover amarelo)

Pontos identificados com amber/gold legado:

- `src/pages/admin/Dashboard.tsx`
  - Linha 34 `COLORS` — paleta dos charts ainda começa em `hsl(45 75% 70%)` (amarelo). Trocar para paleta indigo/violet/sky/emerald.
  - Linha 268 — badge "X de Y ativos" usa `bg-amber-500/10 border-amber-500/40 text-amber-300`. Trocar por tokens neutros/indigo (`bg-primary/10 border-primary/30 text-primary`) quando incompleto; manter emerald quando 100%.
  - `KpiTile accent="gold"` (Facebook Ads, CPL) — substituir por `accent="indigo"` / `violet`.
  - Linha 279 — `gradient-accent text-[hsl(232_65%_5%)]` no toggle de período: ajustar o texto ativo para `text-primary-foreground`.
- `src/components/admin/dashboard/SalesPanel.tsx`
  - Linha 34 `COLORS` — mesma troca de paleta.
  - Qualquer `accent="gold"` / classes amber.
- `src/components/forms/QualificationForm.tsx`
  - Várias cores hardcoded `hsl(38 60% 55%...)` (dourado). Refazer usando tokens semânticos (`primary`, `accent`, `border`, `secondary`).
- Varredura final via `rg "amber|gold|hsl\(38|hsl\(45 7"` em `src/pages/admin` e `src/components/admin` para pegar resíduos.

Resultado: dashboard, sales panel e formulário 100% em indigo/violeta, sem amarelo.

## 2) Refinar visual do Hero

`src/components/ui/HeroSection.tsx`:

- Reforçar grid técnico de fundo (sobrepor `tech-bg` ao aurora indigo) e adicionar um sutil "noise" overlay para textura premium.
- Substituir os 3 KPIs inline por cápsulas com micro-divisores verticais luminosos e label uppercase mais arejado.
- Headline: encurtar a quebra, adicionar segundo eyebrow "B2B · Clínicas Premium" e um sublinhado em gradiente indigo→violeta sob a palavra-chave.
- Card direito (`premium-form-shell`): adicionar borda gradiente animada + glow indigo pulsante leve.
- Limpar parallax: reduzir amplitude de 8/5/6 para 4/2/3 (mais discreto).
- Garantir que o `QualificationForm` herdou os tokens (após item 1) — assim o card vira indigo.

## 3) Qualificação modular (construtor de formulário)

Hoje `QualificacaoPage.tsx` só edita "respostas que desqualificam" para 4 campos fixos hardcoded; `QualificationForm.tsx` tem `steps[]` hardcoded. Vamos torná-lo um construtor real.

### Nova tabela `qualification_fields`

```
id, position (int), key (text, slug), label (text),
question (text), type ('text'|'tel'|'choice'|'email'),
placeholder (text), options (jsonb array of strings),
required (bool), active (bool),
disqualify_values (jsonb array),
created_at, updated_at
```

Seed inicial: migrar os 10 steps atuais do `QualificationForm` para esta tabela (admin pode editar/desativar/reordenar depois). RLS: leitura pública (form anônimo); escrita só admin.

### Nova UI em `src/pages/admin/QualificacaoPage.tsx`

- Lista em cards com drag-to-reorder (dnd-kit já no projeto via shadcn? se não, usar setas ↑↓ simples para evitar dependência nova).
- Cada card permite editar inline: label, pergunta, tipo, placeholder, obrigatório, ativo, opções (chips editáveis), respostas que desqualificam (chips toggle).
- Botão "Novo campo" abre dialog para escolher tipo e key.
- Botão "Pré-visualizar formulário" abre dialog com o `QualificationForm` renderizado a partir do schema dinâmico.
- Indicador de quais campos do banco (`leads`) cada `key` mapeia.

### `QualificationForm.tsx` dirigido por dados

- Buscar `qualification_fields` ativos ordenados por `position`.
- Construir `steps[]` e o objeto Zod dinamicamente a partir dessa lista.
- Manter mapping `key → coluna em leads` (objeto explícito no código para não inserir colunas inexistentes; chaves desconhecidas vão para um `extras jsonb` em `leads` — se ainda não existir, adicionar nesta migration).
- Fallback: se a tabela vier vazia, usar o array atual hardcoded (resiliência).

## Detalhes técnicos

- Migrations Supabase: criar `qualification_fields` (com GRANTs anon SELECT, authenticated all, service_role all), policies (`SELECT` público, `INSERT/UPDATE/DELETE` só admin via `has_role`), trigger `updated_at`, e seed dos 10 campos atuais. Se necessário, `ALTER TABLE leads ADD COLUMN extras jsonb DEFAULT '{}'::jsonb` para receber campos extras.
- A tabela legada `qualification_criteria` permanece (sem uso) para não quebrar nada — pode ser removida em migration futura após confirmação.
- Tokens: nenhuma cor hex/HSL hardcoded nos componentes — só `text-primary`, `bg-accent/10`, etc.

## Entregáveis

1. Migration `qualification_fields` + seed + (opcional) `leads.extras`.
2. `QualificacaoPage.tsx` reescrito como construtor modular com preview.
3. `QualificationForm.tsx` data-driven.
4. `Dashboard.tsx` + `SalesPanel.tsx` sem amarelo (paleta de charts e badges em indigo/violet/emerald).
5. `HeroSection.tsx` refinado (grid + KPIs em cápsulas + borda gradiente no card + parallax mais sutil).
