const Footer = () => {
  return (
    <footer className="gradient-header border-t border-border/30 py-10 px-4">
      <div className="container mx-auto text-center space-y-3">
        <div className="wordmark text-foreground text-lg">
          POSION <span className="gold-gradient-text">GROWTH</span>
        </div>
        <p className="text-sm text-foreground/70">
          Marketing e vendas high-ticket para médicos e clínicas.
        </p>
        <p className="text-muted-foreground text-xs">
          © {new Date().getFullYear()} Posion Growth. Todos os direitos reservados.
        </p>
      </div>
    </footer>
  );
};

export default Footer;