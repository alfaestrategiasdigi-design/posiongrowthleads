import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Facebook, Copy, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const FacebookConfigPage = () => {
  const [verifyToken, setVerifyToken] = useState("");
  const [configId, setConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const webhookUrl = `https://${projectId}.supabase.co/functions/v1/facebook-leads-webhook`;

  useEffect(() => {
    supabase.from("facebook_webhook_config").select("*").limit(1).maybeSingle().then(({ data }) => {
      if (data) { setConfigId(data.id); setVerifyToken(data.verify_token); }
      setLoading(false);
    });
  }, []);

  const generateToken = () => {
    const t = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    setVerifyToken(t);
  };

  const save = async () => {
    if (!verifyToken || verifyToken.length < 12) {
      toast.error("Token precisa ter pelo menos 12 caracteres"); return;
    }
    setSaving(true);
    if (configId) {
      await supabase.from("facebook_webhook_config").update({ verify_token: verifyToken, updated_at: new Date().toISOString() } as any).eq("id", configId);
    } else {
      const { data } = await supabase.from("facebook_webhook_config").insert({ verify_token: verifyToken } as any).select("id").single();
      if (data) setConfigId(data.id);
    }
    setSaving(false);
    toast.success("Configuração salva");
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Facebook className="w-6 h-6 text-blue-500" /> Facebook Lead Ads
        </h1>
        <p className="text-muted-foreground text-sm">Receba leads de formulários instantâneos do Facebook direto no Kanban.</p>
      </div>

      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-foreground">1. Verify Token</h2>
        <p className="text-xs text-muted-foreground">Um segredo que o Facebook usa para validar a chamada inicial. Gere um, salve, e cole no Gerenciador de Eventos da Meta.</p>
        <div className="flex gap-2">
          <Input value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} placeholder="cole ou gere um token..." className="font-mono text-xs" />
          <Button variant="outline" onClick={generateToken} title="Gerar token aleatório"><RefreshCw className="w-4 h-4" /></Button>
          <Button onClick={save} disabled={saving} className="gradient-accent">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span className="ml-2">Salvar</span>
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-foreground">2. URL do Webhook</h2>
        <p className="text-xs text-muted-foreground">Cole esta URL como Callback URL no app da Meta (Webhooks → Leadgen).</p>
        <div className="flex gap-2">
          <Input readOnly value={webhookUrl} className="font-mono text-xs" />
          <Button variant="outline" onClick={() => copy(webhookUrl, "URL")}><Copy className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="bg-accent/5 border border-accent/20 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-foreground">Como configurar no Facebook</h2>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Acesse <b>developers.facebook.com</b> → seu app → <b>Webhooks</b>.</li>
          <li>Em "Page", adicione subscription para o campo <code className="bg-muted px-1 rounded">leadgen</code>.</li>
          <li>Cole a URL acima como <b>Callback URL</b> e o token como <b>Verify Token</b>.</li>
          <li>Em <b>Lead Ads Testing Tool</b>, dispare um teste — o lead aparece no Kanban como "Facebook Ads".</li>
          <li>Alternativa simples: use <b>Zapier/Make</b> apontando para a mesma URL com JSON <code className="bg-muted px-1 rounded">{`{nome, whatsapp, email, ...}`}</code>.</li>
        </ol>
      </div>
    </div>
  );
};

export default FacebookConfigPage;
