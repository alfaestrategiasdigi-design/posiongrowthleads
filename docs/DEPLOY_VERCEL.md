# Deploy no Vercel

Passos rápidos para copiar e hospedar este projeto no Vercel:

1. Se ainda não tiver, suba este repositório para um provedor Git (GitHub, GitLab ou Bitbucket).
2. No Vercel, clique em "New Project" → import from Git → selecione o repositório.
3. Configure as Environment Variables no painel do projeto (Settings → Environment Variables):
   - `VITE_SUPABASE_URL` = https://<your-project>.supabase.co
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = <your-publishable-key>
   - `VITE_SUPABASE_PROJECT_ID` = <project-id>
   (não envie `SUPABASE_SERVICE_ROLE_KEY` para o frontend)
4. Build Command: `npm run build`
   Output Directory: `dist`
5. Deploy: clique em Deploy. O Vercel irá construir e publicar o site.

Observações:
- Edge Functions do Supabase devem permanecer no Supabase — se precisar hospedar funções, use Supabase Edge Functions e configure `SUPABASE_SERVICE_ROLE_KEY` apenas no painel de Environment Variables do Supabase.
- Rotacione chaves se algum segredo foi exposto neste repositório.

Se quiser, eu posso: criar um novo branch pronto para deploy, remover `.env` do histórico (instruções), e gerar as variáveis necessárias no formato para colar no painel do Vercel.