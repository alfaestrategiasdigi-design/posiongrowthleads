import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, Plus, ExternalLink, Building2, Users, CalendarIcon, TimerReset } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { TenantUsersDialog } from "@/components/admin/TenantUsersDialog";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Tenant { id: string; slug: string; name: string; plan: string; status: string; segment: string | null; created_at: string; trial_active?: boolean; trial_ends_at?: string | null }


export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [usersFor, setUsersFor] = useState<Tenant | null>(null);

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tenants")
      .select("*")
      .neq("id", "00000000-0000-0000-0000-000000000001")
      .order("created_at", { ascending: false });
    setTenants((data || []) as Tenant[]);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!name || !slug) return;
    setCreating(true);
    const { error } = await supabase.from("tenants").insert({ name, slug, plan: "starter", status: "active", segment: "clinica" });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Clínica criada!");
    setName(""); setSlug(""); setOpen(false);
    refresh();
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clínicas Clientes</h1>
          <p className="text-muted-foreground">Gestão de tenants do SaaS Posion</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Nova clínica</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Clínica</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2"><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Clínica Exemplo" /></div>
              <div className="space-y-2">
                <Label>Slug (URL)</Label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="clinica-exemplo" />
                <p className="text-xs text-muted-foreground">Acesso: /app/{slug || "slug"}/dashboard</p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={create} disabled={creating || !name || !slug} className="gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> Tenants</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clínica</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="font-mono text-xs">{t.slug}</TableCell>
                    <TableCell><Badge variant="outline">{t.plan}</Badge></TableCell>
                    <TableCell><Badge className={t.status === "active" ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20" : ""}>{t.status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(t.created_at).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" className="gap-2" onClick={() => setUsersFor(t)}>
                          <Users className="w-3 h-3" /> Usuários
                        </Button>
                        <Button asChild size="sm" variant="outline" className="gap-2">
                          <Link to={`/app/${t.slug}/dashboard`}><ExternalLink className="w-3 h-3" /> Abrir</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TenantUsersDialog
        tenantId={usersFor?.id ?? null}
        tenantName={usersFor?.name ?? ""}
        open={!!usersFor}
        onOpenChange={(v) => !v && setUsersFor(null)}
      />
    </div>
  );
}
