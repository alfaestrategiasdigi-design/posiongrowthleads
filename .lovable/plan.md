## Objetivo
Reorganizar a tabela de Leads (`/admin/leads`) e corrigir a coluna **Faturamento**, que hoje aparece vazia na maioria dos formulários mesmo quando o lead respondeu esse campo.

## 1. Reordenar colunas da tabela

Nova ordem (esquerda → direita):

| # | Coluna | Conteúdo |
|---|--------|----------|
| 1 | **Nome** | Nome completo · **WhatsApp logo abaixo** (com ícone) · e-mail em linha menor abaixo (se houver) |
| 2 | **Formulário** | Nome do formulário + ID (fonte mono, como hoje) |
| 3 | **Data / Hora** | `dd/MM/yy HH:mm` |
| 4 | **Faturamento** | Valor extraído (ver seção 2) |
| 5 | Clínica | Nome da empresa |
| 6 | Cidade | Cidade / estado |
| 7 | Especialidade | Badge, como hoje |
| 8 | Tráfego | Como hoje |
| 9 | Status | Badge de status |

- A coluna antiga **"Contato"** deixa de existir (WhatsApp + e-mail passam para dentro da célula Nome).
- Nada mais muda no cabeçalho, filtros, KPIs ou modal de detalhes.

## 2. Corrigir Faturamento para todos os formulários

**Diagnóstico:** hoje a tela lê apenas `leads.faturamento_mensal`. Esse campo só está preenchido em leads do formulário "FORM CAPILAR (3P+@IG)" — os demais (FORMS MEDICOS, FORM POSION OF, etc.) trazem a resposta dentro de `extras.form_fields`, mas o valor nunca é copiado para a coluna, então a UI mostra "—".

**Correção (no frontend, sem migração):**
- Criar um helper `getFaturamento(lead)` que:
  1. Retorna `lead.faturamento_mensal` quando existir.
  2. Caso contrário, percorre `lead.extras.form_fields[]` procurando um item cujo `name` (ou `label`) contenha `faturamento` / `revenue` / `receita` (case-insensitive, ignorando acentos) e devolve o `value` correspondente.
  3. Se nenhum match, retorna `"—"`.
- Formatar o valor de forma legível quando vier no padrão do Meta (ex.: `de_r$30_mil_a_r$50_mil` → `De R$30 mil a R$50 mil`).
- Usar o helper na coluna Faturamento da tabela e no export CSV (para consistência).

Isso resolve o problema para **todos os leads existentes** sem precisar reprocessar dados no banco.

## Arquivos afetados
- `src/pages/admin/LeadsPage.tsx` — reordenar `<thead>` e `<tbody>`, fundir WhatsApp na célula do nome, aplicar o helper de faturamento no render e no CSV.
- `src/lib/leads/faturamento.ts` (novo) — helper `getFaturamento(lead)` + formatador, reutilizável em outros pontos (kanban/export) no futuro.

## Fora do escopo
- Backfill de `leads.faturamento_mensal` a partir de `extras` (dá pra fazer depois se quiser normalizar no banco).
- Ajustes no webhook do Facebook (já cobre a chave; problema é histórico + formulários novos serão cobertos pelo helper mesmo se a chave mudar).
- Mudanças no modal de detalhes do lead.