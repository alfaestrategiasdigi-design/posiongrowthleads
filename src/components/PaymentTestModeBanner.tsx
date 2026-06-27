const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="w-full bg-red-500/15 border-b border-red-500/40 px-4 py-2 text-center text-xs text-red-200">
        Pagamentos em modo de produção não estão configurados. Conclua o go-live em Pagamentos.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full bg-amber-500/15 border-b border-amber-500/40 px-4 py-2 text-center text-xs text-amber-200">
        Ambiente de testes: todas as cobranças nesta tela são simuladas (use cartão 4242 4242 4242 4242).
      </div>
    );
  }
  return null;
}
