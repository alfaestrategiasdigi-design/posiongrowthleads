# Correção emergencial do login

## Diagnóstico confirmado

- O Lovable Cloud, banco e autenticação estão ativos e saudáveis.
- Os dados não foram apagados: existem **14 tenants, 9.612 leads, 10.033 conversas e 7.765 mensagens**. Os “0 rows” do painel são estimativas internas desatualizadas, não contagens reais.
- O usuário informado existe, está confirmado, não está banido e mantém papel global `admin` e vínculo ativo com a conta Master.
- Há dois problemas distintos nos registros recentes:
  1. sessão local com token malformado (`bad_jwt`), capaz de prender `/login` na tela preta com spinner;
  2. tentativas de senha respondidas pelo servidor como credencial inválida.
- `LoginPage` aguarda `getSession()` sem limite de tempo; se a recuperação da sessão travar, `checking` nunca termina.

## Implementação

1. **Destravar a tela de login**
   - Colocar limite de tempo na restauração inicial da sessão.
   - Garantir que o estado de carregamento termine em sucesso, erro ou timeout.
   - Ao detectar sessão/token inválido, limpar somente a sessão de autenticação corrompida e exibir o formulário imediatamente.

2. **Fortalecer a autenticação e o redirecionamento**
   - Validar a identidade no servidor após o login antes de redirecionar.
   - Proteger a resolução de papel/tenant contra falhas e timeout, sem spinner infinito.
   - Manter o redirecionamento confirmado do usuário admin para `/admin`.
   - Evitar chamadas concorrentes duplicadas de sessão nos layouts que possam reabrir o estado de carregamento.

3. **Mensagens de erro exatas**
   - Separar credencial inválida, indisponibilidade de rede e sessão corrompida.
   - Sempre liberar o botão novamente após qualquer falha.
   - Não mascarar erro de conexão como senha incorreta.

4. **Validação final**
   - Abrir o site publicado sem sessão e confirmar que o formulário aparece, sem tela preta infinita.
   - Testar credencial inválida e confirmar a mensagem correta, sem `Failed to fetch`.
   - Validar com uma sessão autenticada que o usuário Master entra em `/admin` e os dados carregam.
   - Conferir console e requisições de autenticação para garantir ausência de novos `bad_jwt`.

## Escopo técnico

- Alterações apenas no fluxo frontend de autenticação e proteção de rotas.
- Nenhuma migração, exclusão ou alteração dos dados existentes.
- Se a senha real continuar sendo recusada depois da correção do fluxo, a etapa seguinte será redefini-la pelo canal seguro de recuperação — sem expor credenciais no código ou no chat.