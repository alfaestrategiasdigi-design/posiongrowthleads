## Problema

No `LoginPage.tsx`, o mini-logo dentro do card (acima de "POSION Tools · Acesso") aparece como um quadrado em branco. O arquivo `logo-posion.png` é branco com fundo transparente — funciona no header escuro (`#14120D`), mas some quando colocado num container branco (`PALETTE.card = #FFFFFF`).

## Correção (apenas visual, escopo mínimo)

Em `src/pages/LoginPage.tsx`, no bloco do mini-logo (linhas ~104-114):

- Trocar o `background` do container de `PALETTE.card` (branco) para `PALETTE.header` (`#14120D`), mantendo o mesmo tamanho (`w-14 h-14`), `rounded-2xl` e sombra.
- Ajustar a borda para uma variante dourada discreta (`${PALETTE.gold}33`) para combinar com o header da home.
- Manter a logo branca (`logoAsset.url`) intocada — ela passa a ficar visível sobre o fundo escuro.

Nenhuma outra tela é alterada. Home (`Index.tsx`) já usa a logo sobre header escuro, então continua correta. mantem a logo sempre com fundo preto, nem quer tenha um elemento gradiente atrás

&nbsp;