import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UserPlus, Mail, KeyRound, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const CreateUserPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (password !== confirmPassword) { setError("As senhas não coincidem"); return; }
    if (password.length < 6) { setError("A senha deve ter no mínimo 6 caracteres"); return; }

    setCreating(true);
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: window.location.origin }
      });
      if (authError) {
        setError(authError.message.includes("already registered") ? "E-mail já cadastrado" : authError.message);
        setCreating(false);
        return;
      }
      if (data.user) {
        const { error: roleError } = await supabase.from("user_roles").insert({ user_id: data.user.id, role: "admin" as const });
        if (roleError) setError("Usuário criado, mas erro ao definir role");
        else { setSuccess(true); setEmail(""); setPassword(""); setConfirmPassword(""); toast.success("Administrador criado!"); }
      }
    } catch { setError("Erro ao criar usuário"); }
    setCreating(false);
  };

  return (
    <div className="p-6 flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
      <div className="bg-card rounded-2xl border border-border/50 p-8 max-w-md w-full">
        <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <UserPlus className="w-8 h-8 text-accent" />
        </div>
        <h1 className="text-xl font-bold text-foreground text-center mb-1">Criar Administrador</h1>
        <p className="text-muted-foreground text-center mb-6 text-sm">O novo usuário terá acesso total</p>

        {success ? (
          <div className="text-center animate-scale-in">
            <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10 text-green-400" />
            </div>
            <p className="text-foreground font-semibold mb-4">Usuário criado com sucesso!</p>
            <Button onClick={() => setSuccess(false)} variant="outline">Criar outro</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="form-label">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input type="email" placeholder="admin@email.com" value={email} onChange={e => setEmail(e.target.value)} className="pl-10" required />
              </div>
            </div>
            <div>
              <label className="form-label">Senha</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input type="password" placeholder="Mínimo 6 caracteres" value={password} onChange={e => setPassword(e.target.value)} className="pl-10" required minLength={6} />
              </div>
            </div>
            <div>
              <label className="form-label">Confirmar Senha</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input type="password" placeholder="Repita a senha" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="pl-10" required />
              </div>
            </div>
            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}
            <Button type="submit" className="w-full bg-accent hover:bg-accent/90" disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
              {creating ? "Criando..." : "Criar Administrador"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default CreateUserPage;
