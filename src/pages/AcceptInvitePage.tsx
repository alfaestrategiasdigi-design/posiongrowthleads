import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck, AlertCircle, CheckCircle2 } from "lucide-react";
import posionLogo from "@/assets/posion/logo-posion.png.asset.json";

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) return;
      const { data, error } = await supabase
        .from("invites")
        .select("email, role, tenant_id, tenant_role, expires_at, used_at")
        .eq("token", token).maybeSingle();
      if (error || !data) setErr("Convite inválido ou não encontrado.");
      else if (data.used_at) setErr("Este convite já foi utilizado.");
      else if (new Date(data.expires_at).getTime() < Date.now()) setErr("Convite expirado.");
      else setInvite(data);
      setLoading(false);
    })();
  }, [token]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) return setErr("A senha precisa ter ao menos 8 caracteres.");
    if (password !== confirm) return setErr("As senhas não conferem.");
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("invite-accept", {
      body: { token, password, name },
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      return setErr((data as any)?.error || error?.message || "Falha ao aceitar convite.");
    }
    setDone(true);
    if (invite?.email) await supabase.auth.signInWithPassword({ email: invite.email, password });
    setTimeout(() => navigate("/app", { replace: true }), 1200);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 tech-bg">
      <div className="card-luxe p-8 max-w-md w-full relative z-10">
        <div className="flex flex-col items-center mb-6">
          <img src={posionLogo.url} alt="Posion" className="h-10 mb-4 opacity-95" />
          <h1 className="font-display text-2xl">Ativar acesso</h1>
          <p className="text-sm text-muted-foreground mt-1">Defina sua senha para entrar no Posion</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : err && !invite ? (
          <div className="flex items-start gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
            <AlertCircle className="w-4 h-4 mt-0.5" />{err}
          </div>
        ) : done ? (
          <div className="flex flex-col items-center py-6 gap-2 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <p className="font-medium">Conta ativada!</p>
            <p className="text-xs text-muted-foreground">Redirecionando…</p>
          </div>
        ) : (
          <form onSubmit={handle} className="space-y-3">
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Convite para <b className="ml-1">{invite?.email}</b>
            </div>
            <div>
              <Label>Seu nome</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Como devemos te chamar" />
            </div>
            <div>
              <Label>Senha</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required />
            </div>
            <div>
              <Label>Confirmar senha</Label>
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} minLength={8} required />
            </div>
            {err && <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4" />{err}</div>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Ativar conta
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
