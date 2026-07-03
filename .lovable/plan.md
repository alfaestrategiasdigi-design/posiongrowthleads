## Objetivo
Transformar a rota `/` numa "Central do Cliente" minimalista, com a mesma estética premium preta do /login, e remover completamente a landing pública antiga.

## Nova tela `/` — Central do Cliente
Layout centralizado, fundo `bg-black`, mesma linguagem visual do LoginPage:
- Logo Posion no topo
- Selo mono uppercase: `Posion OS · Área Restrita`
- Card `rounded-2xl border border-white/10 bg-black` com:
  - Ícone (Lock/ShieldCheck) num quadrado `bg-white/5`
  - Título: **Central do Cliente**
  - Subtítulo: "Acesso exclusivo para clínicas parceiras, equipe comercial e administradores Posion."
  - Botão primário branco: **Entrar na plataforma** → navega para `/login`
- Rodapé mono: "Sessão criptografada · TLS 1.3"
- Se o usuário já estiver logado, redireciona automaticamente via `getPostLoginRedirect()` (mesmo comportamento do LoginPage)

## Remoções (landing pública antiga)
Apagar arquivos que só serviam à captação pública:
- `src/pages/Index.tsx` (substituído pela nova Central)
- `src/pages/Obrigado.tsx`
- `src/components/ui/HeroSection.tsx`
- `src/components/ui/CasesSection.tsx`
- `src/components/ui/BenefitsSection.tsx`
- `src/components/ui/FinalCTASection.tsx`
- `src/components/ui/FloatingCTAs.tsx`
- `src/components/ui/Header.tsx`
- `src/components/ui/Footer.tsx`
- `src/components/ui/BeforeAfterSection.tsx`, `ResultsSection.tsx`, `ServicesSection.tsx`, `SocialProof.tsx`, `StepsSection.tsx`, `TestimonialsSection.tsx`
- `src/components/forms/QualificationForm.tsx`
- Rota `/obrigado` removida do `App.tsx`

Componentes shadcn em `src/components/ui/*` (button, card, input, etc.) permanecem — são infra do design system.

## Ajustes técnicos
- `src/App.tsx`: nova página `CentralPage` em `/`, remover import de `Obrigado` e rota `/obrigado`
- `index.html`: atualizar `<title>` e `meta description` para "Posion OS — Central do Cliente" (removendo copy de marketing)
- Sem mudanças de backend, RLS, ou lógica de auth — só apresentação e limpeza.

## Verificação
Após implementar, rodar Playwright em `http://localhost:8080/` para confirmar tela preta com card "Central do Cliente" + botão que leva a `/login`, e checar console sem erros de imports quebrados.