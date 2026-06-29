import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Link2, Copy, ExternalLink, CreditCard } from "lucide-react";
import { toast } from "sonner";

interface Plan {
  id: string; code: string; interval: string; name: string;
  amount_cents: number; currency: string; lookup_key: string;
}
interface Tenant { id: string; slug: string; name: string }
interface Sub { tenant_id: string; lookup_key: string | null; status: string; mp_init_point: string | null }

const BRL = (cents: number, cur = "brl") =>
  ((cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: (cur || "brl").toUpperCase() });

export function GenerateLinkCard({
  tenants, plans, subByTenant, onCopy,
}: {
  tenants: Tenant[];
  plans: Plan[];
  subByTenant: Map<string, Sub>;
  onCopy: (text: string, label: string) => void;
}) {
  const [tenantId, setTenantId] = useState<string>("");
  const [lookupKey, setLookupKey] = useState<string>("");
  const [payerEmail, setPayerEmail] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string>("");

  const sortedTenants = useMemo(
    () => [...tenants].sort((a, b) => a.name.localeCompare(b.name)),
    [tenants],
  );
  const selectedPlan = plans.find(p => p.lookup_key === lookupKey);

  const generate = async (mode: "copy" | "open") => {
    if (!tenantId || !lookupKey) {
      toast.error("Selecione cliente e plano");
      return;
    }
    const email = payerEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      toast.error("Informe o e-mail do pagador");
      return;
    }
    setBusy(true);
    setLink("");
    const { data, error } = await supabase.functions.invoke("mp-subscription-checkout", {
      body: {
        tenant_id: tenantId,
        lookup_key: lookupKey,
        payer_email: email,
        back_url: `${window.location.origin}/admin/planos?mp=success`,
      },
    });
    setBusy(false);
    const url = (data as any)?.init_point as string | undefined;
    if (error || !url) {
      const msg = (data as any)?.error || (error as any)?.context?.error || (error as any)?.message || "Falha ao gerar link";
      toast.error(typeof msg === "string" ? msg : JSON.stringify(msg));
      return;
    }
    setLink(url);
    if (mode === "open") {
      window.open(url, "_blank", "noopener");
      toast.success("Checkout aberto em nova aba");
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado");
    }
  };

  return (
    <Card className="bg-[#0E1730] border-white/10">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="w-4 h-4 text-primary" /> Gerar link de cobrança por cliente
        </CardTitle>
        <CardDescription>
          Crie um link de assinatura Mercado Pago para enviar ao cliente por e-mail ou WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Cliente (clínica)</Label>
            <Select value={tenantId} onValueChange={(v) => { setTenantId(v); setLink(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
              <SelectContent>
                {sortedTenants.map(t => {
                  const sub = subByTenant.get(t.id);
                  return (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} {sub?.status === "authorized" || sub?.status === "active" ? "✅" : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Plano</Label>
            <Select value={lookupKey} onValueChange={(v) => { setLookupKey(v); setLink(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione um plano" /></SelectTrigger>
              <SelectContent>
                {plans.map(p => (
                  <SelectItem key={p.id} value={p.lookup_key}>
                    {p.name} — {BRL(p.amount_cents, p.currency)} / {p.interval === "quarter" ? "trimestre" : "mês"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">E-mail do pagador</Label>
          <Input
            value={payerEmail}
            onChange={(e) => { setPayerEmail(e.target.value); setLink(""); }}
            type="email"
            inputMode="email"
            placeholder="cliente@email.com"
            className="bg-[#070A18] border-white/10"
          />
          <p className="text-[11px] text-muted-foreground">
            O Mercado Pago exige um e-mail para criar o link de assinatura.
          </p>
        </div>

        {selectedPlan && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            <CreditCard className="inline w-3 h-3 mr-1 text-primary" />
            Valor: <strong className="text-foreground">{BRL(selectedPlan.amount_cents, selectedPlan.currency)}</strong>
            {" — "}cobrança {selectedPlan.interval === "quarter" ? "trimestral" : "mensal"} via Mercado Pago.
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={() => generate("copy")} disabled={busy || !tenantId || !lookupKey || !payerEmail.trim()} className="flex-1 gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
            Gerar e copiar link
          </Button>
          <Button onClick={() => generate("open")} disabled={busy || !tenantId || !lookupKey || !payerEmail.trim()} variant="outline" className="gap-2">
            <ExternalLink className="w-4 h-4" /> Abrir
          </Button>
        </div>

        {link && (
          <div className="space-y-1.5">
            <Label className="text-xs">Link gerado</Label>
            <div className="flex gap-2">
              <Input value={link} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => onCopy(link, "Link")}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Envie esse link para o cliente. Ao pagar, a assinatura é ativada automaticamente.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
