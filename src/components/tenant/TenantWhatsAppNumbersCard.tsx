import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, RefreshCw, Trash2, Plus, ShieldCheck, Loader2, Star, ArrowRightLeft } from "lucide-react";

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

type NumberRow = {
  id: string;
  tenant_id: string;
  phone_e164: string;
  phone_jid: string | null;
  label: string | null;
  status: "pending" | "verified" | "mismatch";
  is_primary: boolean;
  verified_at: string | null;
  verified_owner_jid: string | null;
  last_check_at: string | null;
  last_check_result: any;
};

function onlyDigits(s: string) {
  return String(s || "").replace(/\D/g, "");
}
function formatBr(digits: string) {
  const d = onlyDigits(digits);
  if (d.length <= 2) return `+${d}`;
  if (d.length <= 4) return `+${d.slice(0, 2)} (${d.slice(2)}`;
  if (d.length <= 9) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4)}`;
  return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9, 13)}`;
}

interface Props { tenantId: string | null }

export default function TenantWhatsAppNumbersCard({ tenantId }: Props) {
  const [rows, setRows] = useState<NumberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});

  const isMaster = tenantId === null;

  async function reload() {
    setLoading(true);
    let q = supabase
      .from("tenant_whatsapp_numbers" as any)
      .select("*")
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
    const { data, error } = await q;
    if (error) {
      console.error(error);
      toast.error("Falha ao carregar números");
    } else {
      setRows((data as any) || []);
    }
    setLoading(false);
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  async function addNumber() {
    const digits = onlyDigits(phone);
    if (digits.length < 10) {
      toast.error("Informe um número válido com DDI + DDD + número");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("tenant_whatsapp_numbers" as any).insert({
      tenant_id: tenantId,
      phone_e164: digits,
      phone_jid: `${digits}@s.whatsapp.net`,
      label: label.trim() || null,
      is_primary: rows.length === 0,
    });
    setSaving(false);
    if (error) {
      if ((error as any).code === "23505") {
        toast.error("Este número já está cadastrado em outro ambiente (tenant ou admin master).");
      } else {
        toast.error(error.message);
      }
      return;
    }
    setPhone(""); setLabel("");
    toast.success("Número cadastrado. Clique em Validar para confirmar.");
    void reload();
  }

  async function verifyNumber(id: string) {
    setVerifying((s) => ({ ...s, [id]: true }));
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const r = await fetch(
        `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/tenant-whatsapp-number-verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ number_id: id }),
        },
      );
      const json = await r.json();
      if (json.verified) toast.success("Número verificado com sucesso");
      else if (json.detected_owner) toast.error(`Divergente: instância pertence a +${json.detected_owner}`);
      else toast.warning(json.reason || "Não foi possível confirmar o número");
      await reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setVerifying((s) => ({ ...s, [id]: false }));
    }
  }

  async function setPrimary(id: string) {
    let clearQ = supabase.from("tenant_whatsapp_numbers" as any).update({ is_primary: false });
    clearQ = tenantId ? clearQ.eq("tenant_id", tenantId) : clearQ.is("tenant_id", null);
    await clearQ;
    const { error } = await supabase.from("tenant_whatsapp_numbers" as any).update({ is_primary: true }).eq("id", id);
    if (error) toast.error(error.message);
    else void reload();
  }

  async function removeNumber(id: string) {
    if (!confirm("Remover este número?")) return;
    const { error } = await supabase.from("tenant_whatsapp_numbers" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
    else void reload();
  }

  const verifiedCount = rows.filter((r) => r.status === "verified").length;
  const mismatchCount = rows.filter((r) => r.status === "mismatch").length;
  const [reassigning, setReassigning] = useState(false);

  async function runReassign() {
    setReassigning(true);
    const payloadBase = isMaster ? { target: "master" } : { tenant_id: tenantId };
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const preview = await fetch(
        `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/whatsapp-reassign-by-owner`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...payloadBase, dry_run: true }),
        },
      ).then((r) => r.json());
      if (preview.error) { toast.error(preview.message || preview.error); return; }
      const convs = preview.conversations_found ?? 0;
      const msgs = preview.messages_found ?? 0;
      const envLabel = isMaster ? "o Admin Master" : "este tenant";
      if (convs === 0) { toast.info(`Nenhuma conversa fora de ${envLabel} precisa ser migrada.`); return; }
      if (!confirm(`Foram encontradas ${convs} conversa(s) e ${msgs} mensagem(ns) em outros ambientes pertencentes a estes números.\n\nConfirmar migração para ${envLabel}?`)) return;
      const applied = await fetch(
        `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/whatsapp-reassign-by-owner`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...payloadBase, dry_run: false }),
        },
      ).then((r) => r.json());
      if (applied.error) toast.error(applied.message || applied.error);
      else toast.success(`Migradas ${applied.conversations_moved} conversa(s) e ${applied.messages_moved} mensagem(ns).`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setReassigning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Números de WhatsApp do tenant
        </CardTitle>
        <CardDescription>
          Cadastre e valide os números conectados a este tenant. O sistema usa esta lista para garantir
          que toda mensagem recebida caia no tenant certo — nunca mais no Admin Master por engano.
        </CardDescription>
        {rows.length > 0 && (
          <div className="flex gap-2 pt-2 text-sm">
            <Badge variant="secondary">{rows.length} cadastrado{rows.length > 1 ? "s" : ""}</Badge>
            {verifiedCount > 0 && <Badge className="bg-emerald-600">{verifiedCount} verificado{verifiedCount > 1 ? "s" : ""}</Badge>}
            {mismatchCount > 0 && <Badge variant="destructive">{mismatchCount} divergente{mismatchCount > 1 ? "s" : ""}</Badge>}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Backfill: reatribuir conversas antigas */}
        {verifiedCount > 0 && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-dashed bg-muted/20">
            <div className="text-sm">
              <div className="font-medium">Migrar conversas antigas para este tenant</div>
              <div className="text-muted-foreground text-xs">
                Procura conversas salvas em outros tenants (ou no admin master) cujo número
                destinatário corresponde a um número verificado acima e move para cá.
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={runReassign} disabled={reassigning}>
              {reassigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
              Migrar agora
            </Button>
          </div>
        )}

        {/* Add form */}
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end p-3 rounded-lg border bg-muted/30">
          <div>
            <Label htmlFor="wa-phone">Número (com DDI e DDD)</Label>
            <Input
              id="wa-phone"
              placeholder="+55 (11) 99999-9999"
              value={formatBr(phone)}
              onChange={(e) => setPhone(onlyDigits(e.target.value).slice(0, 15))}
            />
          </div>
          <div>
            <Label htmlFor="wa-label">Rótulo (opcional)</Label>
            <Input
              id="wa-label"
              placeholder="Ex.: Recepção, Comercial"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
            />
          </div>
          <Button onClick={addNumber} disabled={saving || !onlyDigits(phone)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Adicionar
          </Button>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            Nenhum número cadastrado ainda. Adicione o número do WhatsApp que está conectado à instância deste tenant.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-3 border rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium">{formatBr(r.phone_e164)}</span>
                    {r.is_primary && (
                      <Badge variant="outline" className="gap-1">
                        <Star className="h-3 w-3" /> Principal
                      </Badge>
                    )}
                    {r.status === "verified" && (
                      <Badge className="bg-emerald-600 gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Verificado
                      </Badge>
                    )}
                    {r.status === "mismatch" && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertCircle className="h-3 w-3" /> Divergente
                      </Badge>
                    )}
                    {r.status === "pending" && <Badge variant="secondary">Pendente</Badge>}
                  </div>
                  {r.label && <div className="text-xs text-muted-foreground mt-0.5">{r.label}</div>}
                  {r.status === "mismatch" && r.verified_owner_jid && (
                    <div className="text-xs text-destructive mt-1">
                      Instância conectada pertence a <span className="font-mono">+{onlyDigits(r.verified_owner_jid)}</span>. Ajuste o número cadastrado ou reconecte o WhatsApp certo.
                    </div>
                  )}
                  {r.verified_at && r.status === "verified" && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Confirmado em {new Date(r.verified_at).toLocaleString("pt-BR")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" disabled={verifying[r.id]} onClick={() => verifyNumber(r.id)}>
                    {verifying[r.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Validar
                  </Button>
                  {!r.is_primary && (
                    <Button size="sm" variant="ghost" onClick={() => setPrimary(r.id)} title="Definir como principal">
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => removeNumber(r.id)} title="Remover">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
