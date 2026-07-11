## Objetivo
Corrigir `TenantPatients.tsx` para listar pacientes reais da tabela `patients` (fonte da verdade), enriquecendo com métricas de `sales` por `patient_id`. Vendas sem paciente cadastrado deixam de virar linhas fantasma e passam a ser expostas apenas como contador discreto.

## Mudanças

### `src/pages/app/TenantPatients.tsx`
1. **Fonte da lista = `patients`**
   - Query: `patients.select("*").eq("tenant_id", tenant.id).is("promotion_reverted_at", null).order("name")`.
   - Remover o merge com `sales` que criava entradas `id: "sale:..."`.

2. **Enriquecimento com vendas**
   - Continuar buscando `sales` do tenant.
   - Agregar por `patient_id` (não por nome): `{ total, count, last }`.
   - Fallback: quando `sales.patient_id` for null mas `patient_name` casar exatamente (case-insensitive) com um paciente, agregar por nome — puramente cosmético, não cria linha.

3. **Vendas órfãs (sem `patient_id` e sem match por nome)**
   - Contar quantas são e exibir um aviso discreto acima/abaixo da tabela:
     `N venda(s) sem paciente cadastrado` com tooltip: "Serão vinculadas no backfill (Fase 7)."
   - Não renderizar linhas fantasma.

4. **Clique sempre abre `ClientPanel`**
   - Todas as linhas são pacientes reais → `onClick={() => setPanelId(p.id)}`, cursor pointer, hover normal.
   - Remover a lógica `isRealPatient` / ícone `Info` / tooltip "Sem cadastro de paciente" (não é mais necessária).
   - Remover imports não utilizados após a limpeza (`Tooltip*`, `Info`, `TooltipProvider`).

5. **Contagem**
   - `p.muted-foreground` "X pacientes" continua refletindo o total real da lista filtrada.

6. **"Novo Paciente"**
   - Intocado; segue inserindo em `patients` e recarregando.

## Fora de escopo (confirmado)
- Não altera banco, triggers, automações, webhooks, envio.
- Backfill de `sales` órfãs → Fase 7.
- Não mexe em `ClientPanel`, `TenantsPage`, `useClientData`, entity-fields.
- Não altera nada relacionado ao Dr. Alessandro além do que já vem via Fase 6 (ele deve aparecer naturalmente na lista assim que houver `patients` para o tenant dele — a mudança desta fase é o que torna isso visível).

## Como testar
1. Abrir `/app/<tenant>/pacientes` como um tenant que já teve leads promovidos a "ganho" (ex: Dr. Alessandro Transplante Capilar) → devem aparecer os pacientes reais da tabela `patients`.
2. Cada linha deve ser clicável → abre `ClientPanel` com a ficha rica.
3. Pacientes com `promotion_reverted_at` preenchido não devem aparecer.
4. Se houver vendas antigas sem `patient_id` correspondente, deve aparecer o contador discreto "N venda(s) sem paciente cadastrado" (sem linhas fantasma).
5. Botão "Novo Paciente" continua criando e a lista atualiza.
6. `tsgo` / build: 0 erros de TypeScript.

## Observação sobre "concluir tudo em aberto"
Esta fase entrega apenas o item pedido (leitura correta em Pacientes Ativos). Itens ainda em aberto que citei em fases anteriores e que NÃO faço aqui sem sua aprovação explícita:
- Fase 5 real (edição do ClientPanel) — hoje a ficha é read-only.
- Fase 7 (backfill de `patients` a partir de `sales` órfãs e vinculação de agency_contracts órfãos).
- Filtro `promotion_reverted_at IS NULL` na lista de Clínicas Clientes do Master (mesmo princípio, mas em `TenantsPage.tsx`).

Se quiser que eu já inclua o filtro de revertidos em `TenantsPage.tsx` nesta mesma fase (é uma mudança pequena e da mesma família), me avise antes de aprovar e eu adiciono ao plano. As demais (Fase 5, Fase 7) recomendo tratar em fases próprias.