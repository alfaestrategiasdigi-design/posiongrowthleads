import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Camera, Loader2, Save, UserRound } from "lucide-react";
import { initialsFrom } from "@/hooks/useUserProfile";

export default function ProfilePage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const u = session?.user;
      if (!u) { navigate("/login"); return; }
      setUserId(u.id);
      setEmail(u.email || "");
      const { data } = await supabase
        .from("user_profiles")
        .select("full_name,phone,avatar_url")
        .eq("user_id", u.id)
        .maybeSingle();
      if (data) {
        setFullName(data.full_name || "");
        setPhone(data.phone || "");
        setAvatarUrl(data.avatar_url || null);
      }
      setLoading(false);
    })();
  }, [navigate]);

  const handleAvatar = async (file: File) => {
    if (!userId) return;
    if (file.size > 4 * 1024 * 1024) {
      toast({ title: "Imagem muito grande", description: "Envie uma foto de até 4MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${userId}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "0" });
    if (upErr) {
      toast({ title: "Erro ao enviar foto", description: upErr.message, variant: "destructive" });
      setUploading(false); return;
    }
    const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60 * 24 * 365);
    const url = signed?.signedUrl || null;
    setAvatarUrl(url);
    setUploading(false);
    toast({ title: "Foto atualizada", description: "Não esqueça de salvar as alterações." });
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase.from("user_profiles").upsert({
      user_id: userId,
      full_name: fullName.trim() || null,
      phone: phone.trim() || null,
      avatar_url: avatarUrl,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Perfil atualizado", description: "Suas informações foram salvas." });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto space-y-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground hover:text-amber-300 transition-colors"
      >
        <ArrowLeft className="w-3 h-3" /> Voltar
      </button>

      <div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-amber-400/80 mb-1 font-mono">Conta · Posion OS</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Meu perfil</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Personalize sua identidade dentro do sistema. Estas informações aparecem para você em qualquer conta ou clínica.
        </p>
      </div>

      <Card data-no-float className="premium-card rounded-2xl p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center gap-6 pb-6 border-b border-amber-500/15">
          <div className="relative">
            <Avatar className="h-24 w-24 border-2 border-amber-500/40">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName || email} /> : null}
              <AvatarFallback className="bg-amber-500/15 text-amber-200 text-2xl font-mono uppercase">
                {initialsFrom(fullName, email)}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full premium-kpi-icon flex items-center justify-center border border-amber-500/60 hover:scale-105 transition-transform disabled:opacity-60"
              title="Trocar foto"
              aria-label="Trocar foto de perfil"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Camera className="w-4 h-4 text-white" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleAvatar(e.target.files[0])}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-mono uppercase tracking-[0.18em] text-amber-400/80">Como você aparece</div>
            <div className="text-xl font-semibold truncate mt-1">{fullName || "Sem nome definido"}</div>
            <div className="text-sm text-muted-foreground truncate">{email}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-6">
          <div className="space-y-2">
            <Label htmlFor="full_name" className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Nome completo</Label>
            <Input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ex.: Maria Silva"
              className="bg-background/60 border-amber-500/20 focus-visible:border-amber-400/60"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone" className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Telefone</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-0000"
              className="bg-background/60 border-amber-500/20 focus-visible:border-amber-400/60"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">E-mail</Label>
            <Input value={email} readOnly disabled className="bg-muted/30" />
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Identificação</Label>
            <div className="rounded-md border border-muted/40 bg-muted/20 px-3 py-2 text-xs font-mono text-muted-foreground flex items-center gap-2">
              <UserRound className="w-3.5 h-3.5" /> {userId?.slice(0, 8)}…
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-6 mt-4 border-t border-amber-500/15">
          <Button variant="ghost" onClick={() => navigate(-1)} disabled={saving}>Cancelar</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gap-2 bg-amber-500/90 hover:bg-amber-500 text-black font-semibold"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar alterações
          </Button>
        </div>
      </Card>
    </div>
  );
}
