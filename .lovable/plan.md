## Objetivo

Substituir o fluxo atual de convites (que exige e-mail e link) por um **painel completo de gestão de usuários** dentro da conta Admin Master. Toda criação, edição de papel global, vínculo com clínicas e ativação/desativação será feita direto pela interface — sem precisar entrar no banco.

## O que muda na página `/admin/usuarios`

A página `Usuários & Convites` vira **Gestão de Usuários** com 2 abas:

### Aba 1 — Criar usuário (direto, sem convite)
Campos:
- E-mail
- Senha (com botão "gerar senha aleatória")
- Papel global (Admin Master, Comercial Master, Admin de Clínica, Comercial de Clínica, Usuário)
- Clínica vinculada (opcional, aparece só se o papel for de clínica)
- Cargo interno na clínica (owner / admin / vendedor / recepção / viewer)

Botão **"Criar usuário"** cria a conta já confirmada (sem verificação de e-mail), atribui o papel global em `user_roles` e, se selecionada uma clínica, cria o vínculo em `tenant_users`. Ao final mostra a senha em destaque com botão de copiar.

### Aba 2 — Usuários existentes
Tabela listando todos os usuários com:
- E-mail / ID
- Papel global (Select editável — troca em `user_roles` na hora)
- Clínicas vinculadas (chips com papel; botão + para adicionar vínculo, X para remover)
- Ações: **Resetar senha** (gera nova senha temporária), **Ativar/Desativar**, **Excluir usuário**

Filtro de busca por e-mail + filtro por papel global.

## Backend (edge functions)

Criar/atualizar functions com service role (bypassa RLS, permite confirmar e-mail sem SMTP):

1. **`admin-create-user`** — cria usuário com `email_confirm: true`, insere em `user_roles` e opcionalmente em `tenant_users`.
2. **`admin-update-user`** — atualiza papel global, adiciona/remove vínculo de tenant, altera cargo, ativa/desativa.
3. **`admin-reset-password`** — gera nova senha temporária e retorna para exibir.
4. **`admin-delete-user`** — remove de `auth.users` (cascata limpa `user_roles` e `tenant_users`).
5. **`admin-list-users`** — lista consolidada com e-mail (que não vem do PostgREST), papéis e vínculos.

Todas verificam se o chamador tem `has_role(auth.uid(), 'admin')`. Sem isso → 403.

## Diagrama de fluxo

```text
Admin Master  ──►  UI (/admin/usuarios)
                     │
                     ├── Criar        ──►  admin-create-user     ──► auth.users + user_roles + tenant_users
                     ├── Editar papel ──►  admin-update-user     ──► user_roles (upsert/delete)
                     ├── Vincular     ──►  admin-update-user     ──► tenant_users (upsert)
                     ├── Resetar      ──►  admin-reset-password  ──► auth.admin.updateUserById
                     └── Excluir      ──►  admin-delete-user     ──► auth.admin.deleteUser
```

## Segurança

- Signup público continua desativado — o único caminho para criar contas é esta página, chamada apenas por quem tem papel `admin` global.
- Senhas geradas com 12 caracteres seguros; usuário pode trocar em "Esqueci minha senha" depois.
- Papéis globais `admin` e `comercial_admin_master` só podem ser concedidos por outro Admin Master (checagem no backend).
- Não é possível o Admin Master remover o próprio papel `admin` (proteção anti-lockout).

## Arquivos

**Novos:**
- `supabase/functions/admin-create-user/index.ts`
- `supabase/functions/admin-update-user/index.ts`
- `supabase/functions/admin-reset-password/index.ts`
- `supabase/functions/admin-delete-user/index.ts`
- `supabase/functions/admin-list-users/index.ts`

**Modificados:**
- `src/pages/admin/CreateUserPage.tsx` — reescrita em 2 abas (Criar / Gerenciar).

Fluxo antigo de convites/link permanece disponível como fallback, mas deixa de ser o caminho principal.
