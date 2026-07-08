## Objetivo
Adicionar um botão/painel "Resumo do Lead" na página `/admin/leads` que abre um modal com dados cadastrais, linha do tempo completa e um resumo curto gerado por Claude (Anthropic), com opção de exportar em PDF. Não altera a listagem existente.

## Onde entra
- Novo componente `src/components/leads/LeadResumoModal.tsx` (independente do `LeadDetailModal` atual).
- Novo botão "Resumo" em cada linha da tabela em `src/pages/admin/LeadsPage.tsx` (só o botão — o resto da listagem fica intacto).
- Nova edge function `supabase/functions/lead-summary/index.ts` que chama a API da Anthropic.
- Novo secret `ANTHROPIC_API_KEY` (a ser fornecido pelo usuário via `add_secret`).

## Estrutura do modal

**Cabeçalho** — nome do lead + status atual (badge) + botão "Exportar PDF".

**Seção 1 — Dados cadastrais** (lê da tabela `leads`)
- Nome, WhatsApp, e-mail
- Empresa/CNPJ, cidade
- Origem (`origem`), Formulário de origem (`facebook_form_name`, fallback `facebook_form_id`)
- Data de entrada (`created_at`)
- Campanha (`facebook_campaign` / `utm_campaign`)
- Owner responsável (`owner_user_id` → email do usuário)

**Seção 2 — Linha do tempo cronológica** (merge de várias fontes)
1. **Entrada do lead** — evento sintético "Lead recebido via {origem}/{form_name}" com `leads.created_at`.
2. **Mudanças de status** — `lead_status_events` (from_status → to_status, changed_by, source, changed_at).
3. **Marcos de funil** — datas não nulas em `leads.reuniao_agendada_em`, `reuniao_realizada_em`, `proposta_enviada_em`, `fechado_em`.
4. **Mensagens WhatsApp** — via `conversations.lead_id = leads.id` → `messages` (direção in/out, preview de 120 chars, timestamp). Limite últimas 50 para não estourar o modal.
5. **Tarefas** — `lead_tasks` filtradas por `lead_id` (criação, marcada como feita).
6. **Envios CAPI/automação** — `facebook_capi_logs` e `automation_executions` relacionados ao lead (só se existirem).

Ordenação por timestamp desc (mais recente no topo). Cada item com ícone por tipo, cor por categoria (status = âmbar, mensagem = azul, tarefa = violeta, marco = esmeralda).

**Seção 3 — Resumo gerado por IA** (2-4 frases)
- Botão "Gerar resumo" (evita chamada automática desnecessária que consome créditos).
- Chama edge function `lead-summary` enviando: dados cadastrais + timeline compactada (últimos 20 eventos).
- Edge function chama Claude com prompt estruturado, retorna JSON `{ estagio, engajamento, proxima_acao }` + texto corrido.
- Cache: grava o último resumo em `leads.extras.ai_summary = { text, generated_at, model }` para reabrir sem re-gerar. Botão "Regenerar" força nova chamada.

**Seção 4 — Exportar PDF**
- Botão gera PDF client-side usando `jspdf` + `jspdf-autotable` (já usado no projeto? checar em `src/components/relatorios/export/exportToPdf.ts`).
- Conteúdo do PDF: cabeçalho POSION + dados cadastrais + resumo IA + tabela cronológica (título, tipo, data, descrição curta). Nome do arquivo: `lead-{nome_slug}-{yyyymmdd}.pdf`.

## Detalhes técnicos

**Edge function `lead-summary`**
- Modelo: `claude-3-5-sonnet-latest` (usa Anthropic direto conforme pedido).
- Auth: exige JWT válido + `has_role(uid, 'admin')` OR `is_agency_member(uid)`.
- Body: `{ lead_id: uuid, force?: boolean }`.
- Lê o lead + timeline via service role, monta prompt, chama Anthropic, valida resposta, persiste em `leads.extras`.
- Retorna `{ summary_text, generated_at }`.

**Prompt para o Claude**
```
Você é um SDR sênior. Analise o lead abaixo e escreva 2-4 frases em PT-BR descrevendo:
1) Estágio atual e há quanto tempo está nele
2) Nível de engajamento (baseado em mensagens/tarefas/tempo desde último toque)
3) Próxima ação recomendada e por quê
Dados: {json}
Timeline (mais recente primeiro): {eventos}
Responda APENAS o texto corrido, sem cabeçalhos.
```

**Trigger no botão**
Na tabela `/admin/leads` adiciono uma coluna extra "Ações" com `<button>Resumo</button>` que chama `setSummaryLeadId(lead.id)` → abre `LeadResumoModal`.

## Fora de escopo
- Não altera `LeadDetailModal`, `AgencyPipelinePage`, nem a estrutura das tabelas do banco.
- Não cria histórico de resumos (só o último, sobrescreve).
- Não substitui `observacoes` por notas com histórico.

## Perguntas antes de implementar
1. **API da Anthropic vs Lovable AI Gateway**: o Lovable já oferece Claude via gateway (sem precisar de secret extra e mais barato). Prefere mesmo assim a API direta da Anthropic (você fornece a `ANTHROPIC_API_KEY`)?
2. **Modelo**: `claude-3-5-sonnet-latest` ou `claude-3-5-haiku-latest` (mais rápido/barato para resumos curtos)?
3. **PDF**: layout minimalista preto e branco, ou usar a identidade POSION (dourado sobre fundo escuro) igual à página?
