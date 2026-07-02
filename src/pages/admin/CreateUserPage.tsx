import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Loader2, Mail, ShieldCheck, RefreshCw, Trash2 } from "lucide-react";

type Tenant = { id: string; name: string };
type Invite = {
  id: string; email: string; role: string; tenant_id: string | null;
  tenant_role: string | null; token: string; expires_at: string;
  used_at: string | null; created_at: string;
};

const GLOBAL_ROLES = [
  { v: "admin_tenant", l: "Admin da Clínica (dono)" },
  { v: "comercial_tenant", l: "Comercial da Clínica (limitado)" },
  { v: "comercial_admin_master", l: "Comercial Agência (master)" },
  { v: "admin", l: "Admin Master (acesso total)" },
];

const TENANT_ROLES = [
  { v: "owner", l: "Owner" },
  { v: "admin", l: "Admin" },
  { v: "vendedor", l: "Vendedor" },
  { v: "recepcao", l: "Recepção" },
  { v: "viewer", l: "Somente leitura" },
];

export default function CreateUserPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("admin_tenant");
  const [tenantId, setTenantId] = useState<string>("");
  const [tenantRole, setTenantRole] = useState("admin");
  const [submitting, setSubmitting] = useState(false);

  const isTenantBound = role === "admin_tenant" || role === "comercial_tenant";

  const load = async () => {
    setLoading(true);
    const [{ data: t }, { data: i }] = await Promise.all([
      supabase.from("tenants").select("id,name").order("name"),
      supabase.from("invites").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    setTenants((t as any) || []);
    setInvites((i as any) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!email) return toast.error("Informe o e-mail");
    if (isTenantBound && !tenantId) return toast.error("Selecione a clínica");
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("invite-create", {
      body: {
        email: email.trim().toLowerCase(), role,
        tenant_id: isTenantBound ? tenantId : null,
        tenant_role: isTenantBound ? (role === "comercial_tenant" ? "comercial_tenant" : tenantRole) : null,
      },
    });
    setSubmitting(false);
    const err = (data as any)?.error || error?.message;
    if (err) return toast.error(err);
    const link = (data as any)?.link as string;
    if (link) {
      await navigator.clipboard.writeText(link).catch(() => {});
      toast.success("Convite gerado — link copiado!");
    }
    setEmail("");
    load();
  };

  const copyLink = async (token: string) => {
    const link = `${window.location.origin}/convite/${token}`;
    await navigator.clipboard.writeText(link);
    toast.success("Link copiado");
  };

  const revoke = async (id: string) => {
    const { error } = await supabase.from("invites").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Convite revogado");
    load();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-3xl">Usuários & Convites</h1>
        <p className="text-muted-foreground text-sm">Signup público está desativado. Crie usuários enviando um convite seguro (link válido por 24h).</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="w-4 h-4" /> Novo convite</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="pessoa@empresa.com" />
          </div>
          <div>
            <Label>Papel (role)</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GLOBAL_ROLES.map(r => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isTenantBound && (
            <>
              <div>
                <Label>Clínica (tenant)</Label>
                <Select value={tenantId} onValueChange={setTenantId}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {role === "admin_tenant" && (
                <div>
                  <Label>Cargo interno</Label>
                  <Select value={tenantRole} onValueChange={setTenantRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TENANT_ROLES.map(r => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={submit} disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Gerar convite
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Convites recentes</CardTitle>
          <Button variant="ghost" size="sm" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4" /> Atualizar</Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : invites.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum convite ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                  <tr><th className="py-2">E-mail</th><th>Role</th><th>Clínica</th><th>Status</th><th>Expira</th><th></th></tr>
                </thead>
                <tbody>
                  {invites.map(inv => {
                    const tenant = tenants.find(t => t.id === inv.tenant_id);
                    const expired = new Date(inv.expires_at).getTime() < Date.now();
                    const status = inv.used_at ? "usado" : expired ? "expirado" : "pendente";
                    return (
                      <tr key={inv.id} className="border-b last:border-0">
                        <td className="py-2">{inv.email}</td>
                        <td><Badge variant="outline">{inv.role}</Badge></td>
                        <td className="text-muted-foreground">{tenant?.name || "—"}</td>
                        <td>
                          <Badge variant={status === "pendente" ? "default" : status === "usado" ? "secondary" : "destructive"}>
                            {status}
                          </Badge>
                        </td>
                        <td className="text-muted-foreground text-xs">{new Date(inv.expires_at).toLocaleString("pt-BR")}</td>
                        <td className="text-right">
                          {status === "pendente" && (
                            <Button size="sm" variant="ghost" onClick={() => copyLink(inv.token)} className="gap-1">
                              <Copy className="w-3 h-3" /> Link
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => revoke(inv.id)} className="gap-1 text-destructive">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
