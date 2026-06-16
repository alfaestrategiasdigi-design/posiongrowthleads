# Posion — Plano Final de Implementação

Os 4 PDFs cobrem ~5 semanas de trabalho. Vou entregar em **5 fases independentes**, cada uma testável sozinha. Você aprova cada fase antes da próxima — assim não quebro nada que já funciona e você vê valor a cada passo.

---

## Fase 1 — Banco de dados (fundação)
**Migration única** alinhando o schema atual aos PDFs:

- `clinic_leads`: adicionar `responsible_role`, `last_contact_by`, `contact_count`, `evaluation_attended_at`, `negotiation_value`, `facebook_lead_id`, `facebook_campaign_id`, `utm_*`, `source_landing_page`, `metadata jsonb`, `tags text[]`, `status` (ativo/inativo/arquivado). Garantir `stage` com os 9 valores oficiais.
- `sales`: adicionar `procedure_category`, `amount_paid`, `amount_pending` (gerada via trigger), `facebook_campaign_id`, `utm_source`, `utm_campaign`, `metadata jsonb`. CHECK `amount > 0` e `amount_paid <= amount`.
- Triggers: `update_updated_at_column`, `update_sales_pending` (recalcula `amount_pending`), `increment_contact_count`.
- Índices: `(tenant_id, stage)`, `(tenant_id, created_at DESC)`, `responsible_user_id`, `facebook_lead_id`, `channel` em `clinic_leads`; `(tenant_id, created_at)`, `clinic_lead_id`, `seller_id`, `payment_status`, `facebook_campaign_id` em `sales`.
- RLS revisada: `SELECT/INSERT/UPDATE` via `has_tenant_access`; `DELETE` apenas via `is_tenant_admin`. Reforçar `leads` (global) como admin-only.
- Realtime ligado em `clinic_leads` e `sales`.

## Fase 2 — Fluxo Kanban → Sales (núcleo operacional)
- `src/types/admin.ts`: novos `PIPELINE_STAGES` (Novo, Qualificado, Avaliação Agendada, Compareceu, Em Negociação, Fechado Ganho, Fechado Perdido, Sem Resposta, Cancelado), `LEAD_CHANNELS`, `LEAD_TYPES`, `PIPELINE_TRANSITIONS` + `isValidTransition()`.
- `TenantKanban` reescrito sobre `clinic_leads` (tenant-scoped) com realtime, cards maiores, badge de tempo no estágio, hover com preview.
- Drop em "Fechado Ganho" → `SaleModal` (procedimento, valor, forma de pagamento, data, notas) → cria `sales` copiando `channel/utm_*/facebook_campaign_id`.
- Validações: transição válida, valor > 0, sem venda duplicada para o mesmo `clinic_lead_id`.
- Filtros no topo: produto, canal, período, busca.

## Fase 3 — UI/UX Premium (Dashboard + Tabelas + Kanban)
- **KPI cards** redesenhados: ícone 24px, valor 32px+, delta vs período anterior em verde/vermelho, sparkline.
- **Dashboard tenant + admin** com Recharts (funil 5 estágios, ROI vs Investimento, evolução diária 30d) e filtro de período (Hoje/7d/30d/Custom).
- **Tabelas** (Leads, Vendas, Pacientes): padding 12px+, zebra, busca em tempo real, filtros acima, ações inline (ligar/WhatsApp/agendar), scroll horizontal mobile.
- Tokens HSL revisados em `src/index.css` para contraste WCAG AA mantendo `#01083c` + roxo.

## Fase 4 — KPIs Agência de Tráfego (`/admin/campanhas`)
Nova página com:
- Métricas: Leads, Tx Qualificação, Tx Agendamento, Tx Comparecimento, Tx Conversão, CPA, CAC, ROI, Ticket Médio, LTV.
- Gráficos: funil 5 estágios, ROI vs Investimento, performance por campanha/SDR, evolução diária.
- Filtros: período, campanha (multi), tenant (admin master), SDR.
- Input manual de investimento por campanha (nova tabela `campaign_spend` com `tenant_id`, `facebook_campaign_id`, `period`, `amount`) — necessário para CPA/CAC/ROI sem integração Meta Ads completa.

## Fase 5 — Integração Facebook (captura → distribuição → sync)
- Webhook `facebook-leads-webhook` já existe — adicionar dedup robusta e validação Zod.
- **`/admin/leads`**: tabela de leads globais não distribuídos + ação "Distribuir para Tenant" (multi-select) que cria `clinic_leads` copiando campos e UTMs.
- **`/admin/facebook`**: já existe `FacebookConfigPage` — adicionar painel de campanhas conectadas e mapeamento de campos. **OAuth Facebook Business** depende de App Facebook aprovado e App Secret — vai como item opcional pendente de credenciais.
- Sync de status `clinic_leads.stage` → eventos Facebook (Conversions API) fica como **Fase 5.1 opcional**, exige token de longa duração.

---

## Detalhes técnicos relevantes

```text
tenant_users.role já existe (admin/sdr/medico/visualizador, active boolean) — não precisa nova migration de roles.
TenantKanban hoje usa `leads` global; precisa migrar pra `clinic_leads` com tenant_id do useTenant().
Realtime: src/integrations/supabase/client.ts já configurado — basta REPLICA IDENTITY FULL + publication.
```

---

## Fora de escopo desta entrega
- OAuth Facebook completo (precisa App Facebook aprovado + App Secret).
- Conversions API (sync stage→Facebook): requer token longa-duração.
- Relatórios PDF/Excel exportáveis (fase futura).
- Agenda Dr. Matheus isolada da admin master (issue separada que você mencionou — trato em ticket próprio).

---

## Ordem de entrega sugerida
1. **Fase 1 (migration)** — você aprova o SQL antes de rodar.
2. **Fase 2 (Kanban→Sales)** — destrava operação real.
3. **Fase 3 (UI/UX)** — resolve o "visual fraco" que você reclamou.
4. **Fase 4 (Campanhas)** — destrava agência de tráfego.
5. **Fase 5 (Facebook)** — automatiza entrada de leads.

**Posso começar pela Fase 1 (migration)?** Ou prefere reordenar (ex: UI/UX primeiro pra resolver o visual antes da operação)?
