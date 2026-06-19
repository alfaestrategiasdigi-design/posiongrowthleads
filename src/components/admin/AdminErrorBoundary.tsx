import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class AdminErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    // eslint-disable-next-line no-console
    console.error("[AdminErrorBoundary]", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-card/80 backdrop-blur border border-border/60 rounded-2xl p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/15 ring-1 ring-rose-500/30 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7 text-rose-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">Algo deu errado nesta tela</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {this.state.error.message || "Erro inesperado."}
            </p>
          </div>
          <Button onClick={this.reset} className="gradient-accent text-[hsl(232_65%_5%)] font-medium">
            <RefreshCw className="w-4 h-4 mr-2" /> Tentar novamente
          </Button>
        </div>
      </div>
    );
  }
}
