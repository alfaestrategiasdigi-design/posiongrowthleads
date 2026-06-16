## Objetivo

Conectar a campanha de Lead Ads do Facebook diretamente ao painel (sem planilhas), importar os leads históricos que estão nos CSVs, e adicionar uma visualização de campanhas/leads dentro de `/admin/facebook`.

---

## Como funciona a integração com Facebook Lead Ads

Existem **3 caminhos** para puxar leads do Facebook. Você precisa escolher um (ou combinar):

### Caminho A — Webhook nativo da Meta (tempo real, mais robusto)
- Você cria um **App no Meta for Developers** (tipo "Business").
- Adiciona o produto **Webhooks** + **Leadgen**.
- Configura nosso endpoint como Callback URL e o Verify Token (já existe `/admin/facebook` para isso).
- A Meta envia apenas IDs (`leadgen_id`, `form_id`, `page_id`). Para ler nome/telefone/email/respostas do formulário, o servidor precisa chamar a **Graph API** usando um **Page Access Token de longa duração** (com permissão `leads_retrieval` + `pages_manage_metadata`). Isso exige **App Review da Meta** (~3–7 dias).
- Vantagem: lead cai em segundos. Desvantagem: precisa revisão da Meta.

### Caminho B — Zapier/Make como ponte (rápido, sem App Review)
- Você cria um Zap: trigger "Facebook Lead Ads → New Lead" → action "Webhooks → POST" para o nosso endpoint.
- Sem App Review, funciona em 5 min. O webhook atual já aceita JSON `{nome, whatsapp, email, ...}`.
- Custo: plano pago do Zapier/Make.

### Caminho C — Polling via Marketing API (sem webhook)
- Edge function roda a cada X minutos e busca `/{form_id}/leads` da Graph API.
- Também precisa Page Access Token com `leads_retrieval`. Atraso de minutos.

**Recomendação:** começar pelo **Caminho B (Zapier)** para já entrar em produção hoje, e em paralelo abrir o App na Meta para migrar ao **Caminho A** depois.

---

## O que vou construir nesta rodada

### 1. Importação dos CSVs históricos (`/admin/facebook` → aba "Importar CSV")
- Componente de upload que lê os CSVs UTF-16 TSV exportados pelo Gerenciador de Anúncios da Meta (formato confirmado dos arquivos `Ad1-Depoimento_Dr.Pedro` e `Ad6-Linhados100mil`).
- Mapeia automaticamente as colunas reais detectadas:
  - `full_name` → nome
  - `phone_number` → whatsapp (remove `p:+`)
  - `email`, `company_name`
  - `id` → `facebook_lead_id` (dedup, evita duplicar)
  - `form_id`, `form_name`, `campaign_name`, `ad_name`, `adset_name`
  - Perguntas customizadas (cirurgias capilar, tráfego pago, faturamento, @instagram) → guardadas em `notes` ou campos existentes (`faturamento_mensal`, `especialidade`).
- Preview da tabela antes de confirmar; insere em `leads` com `origem='facebook_ads'`.

### 2. Reformular `/admin/facebook` em 3 abas
- **Aba Configuração:** o que já existe (Verify Token + Webhook URL) + instruções claras das 3 rotas.
- **Aba Importar CSV:** o uploader acima.
- **Aba Leads do Facebook:** lista filtrada de `leads WHERE origem='facebook_ads'`, agrupada por campanha/anúncio, com contagens (leads por campanha, por dia) e botão "Abrir no Kanban".

### 3. Melhorar o webhook (`facebook-leads-webhook`)
- Já aceita JSON direto (Zapier) e o formato Meta. Vou só:
  - Adicionar mapeamento dos campos customizados do formulário (faturamento, especialidade, instagram) que aparecem no CSV.
  - Salvar `form_name`, `ad_name`, `adset_name` (hoje só salva IDs).

### 4. Documentação no painel
- Caixa "Como configurar" com passo-a-passo do Zapier (Caminho B) — copy/paste pronto, sem mexer em código.
- Texto explicando que o Caminho A (webhook nativo) exige App Review e listando as permissões necessárias.

---

## O que **fica pendente** para você decidir depois

- **Caminho A (webhook nativo):** precisa que você crie o App no Meta for Developers e passe pelo App Review. Quando estiver aprovado, eu adiciono o fluxo de OAuth + armazenamento do Page Access Token (1 secret) e a hidratação via Graph API.
- **Caminho C (polling):** só faz sentido se você não quiser usar Zapier nem revisar app — me avise.

---

## Detalhes técnicos

- Schema: precisa adicionar 3 colunas opcionais em `leads`: `facebook_form_name`, `facebook_ad_name`, `facebook_adset_name` (text). Já existem `facebook_lead_id`, `facebook_form_id`, `facebook_campaign`.
- CSV é **UTF-16 LE com TAB como separador** (não é vírgula). Parser usa `TextDecoder('utf-16le')` no browser.
- Dedup por `facebook_lead_id` (UNIQUE parcial) para reimportar o mesmo CSV sem duplicar.
- Telefone vem como `p:+5531994240025` — normalizar removendo `p:+` e mantendo só dígitos.
- RLS: importação roda como admin (já validado pelo `AdminLayout`).

---

## Pergunta antes de implementar

Confirma que quer **Caminho B (Zapier) + Importação CSV agora**, e o **Caminho A (webhook nativo Meta)** fica para uma segunda etapa quando o App estiver aprovado? Ou prefere que eu já prepare o esqueleto do Caminho A também (sem o Page Access Token, que você cola depois)?