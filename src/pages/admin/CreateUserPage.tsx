import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Copy, Loader2, ShieldCheck, RefreshCw, Trash2, KeyRound, Plus, UserPlus, Search, X,
} from "lucide-react";

type Tenant = { id: string; name: string };
type TenantLink = { tenant_id: string; role: string; active: boolean; tenant_name: string | null; tenant_slug: string | null };
type ManagedUser = {
  id: string; email: string; created_at: string; last_sign_in_at: string | null;
  email_confirmed_at: string | null; global_roles: string[]; tenants: TenantLink[];
};

const GLOBAL_ROLES = [
  { v: "admin", l: "Admin Master" },
  { v: "comercial_admin_master", l: "Comercial Master" },
  { v: "admin_tenant", l: "Admin da Clínica" },
  { v: "comercial_tenant", l: "Comercial da Clínica" },
  { v: "user", l: "Usuário" },
];
const TENANT_ROLES = [
  { v: "owner", l: "Owner" },
  { v: "admin", l: "Admin" },
  { v: "vendedor", l: "Vendedor" },
  { v: "recepcao", l: "Recepção" },
  { v: "viewer", l: "Somente leitura" },
  { v: "comercial_tenant", l: "Comercial" },
];

const MASTER_TENANT_ID = "00000000-0000-0000-0000-000000000001";

function randomPwd(len = 12) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

function CredentialBox({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm font-medium text-primary">
        <span className="flex items-center gap-2"><KeyRound className="w-4 h-4" /> Credenciais de {email}</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}><X className="w-3 h-3" /></Button>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-2 py-1 rounded bg-background border border-border font-mono text-sm">{password}</code>
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(password); toast.success("Copiado"); }}>
          <Copy className="w-3.5 h-3.5" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Envie ao usuário. Ele pode trocar depois em "Esqueci minha senha".</p>
    </div>
  );
}

export default function CreateUserPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);

  // create form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(randomPwd(12));
  const [globalRole, setGlobalRole] = useState("admin_tenant");
  const [tenantId, setTenantId] = useState<string>("");
  const [tenantRole, setTenantRole] = useState("admin");
  const [submitting, setSubmitting] = useState(false);
  const tenantBound = globalRole === "admin_tenant" || globalRole === "comercial_tenant";

  const loadTenants = async () => {
    const { data } = await supabase.from("tenants").select("id,name").order("name");
    setTenants(((data as any) || []).filter((t: Tenant) => t.id !== MASTER_TENANT_ID));
  };
  const loadUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-list-users", { body: {} });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Falha ao listar");
      setUsers([]);
    } else {
      setUsers((data as any).users || []);
    }
    setLoading(false);
  };
  useEffect(() => { loadTenants(); loadUsers(); }, []);

  const submitCreate = async () => {
    if (!email) return toast.error("Informe o e-mail");
    if (tenantBound && !tenantId) return toast.error("Selecione a clínica");
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        email: email.trim().toLowerCase(),
        password,
        global_role: globalRole,
        tenant_id: tenantBound ? tenantId : null,
        tenant_role: tenantBound ? (globalRole === "comercial_tenant" ? "comercial_tenant" : tenantRole) : null,
      },
    });
    setSubmitting(false);
    const err = (data as any)?.error || error?.message;
    if (err) return toast.error(err);
    const d = data as any;
    setCreds({ email: d.email, password: d.password });
    toast.success(d.created ? "Usuário criado" : "Usuário existente atualizado");
    setEmail(""); setPassword(randomPwd(12));
    loadUsers();
  };

  const setGlobalRoleFor = async (u: ManagedUser, role: string) => {
    const { data, error } = await supabase.functions.invoke("admin-update-user", {
      body: { action: "set_global_role", user_id: u.id, role },
    });
    const err = (data as any)?.error || error?.message;
    if (err) return toast.error(err);
    toast.success("Papel atualizado");
    loadUsers();
  };
  const removeTenantLink = async (u: ManagedUser, tid: string) => {
    const { data, error } = await supabase.functions.invoke("admin-update-user", {
      body: { action: "remove_tenant", user_id: u.id, tenant_id: tid },
    });
    const err = (data as any)?.error || error?.message;
    if (err) return toast.error(err);
    loadUsers();
  };
  const toggleTenantActive = async (u: ManagedUser, tid: string, active: boolean) => {
    const { data, error } = await supabase.functions.invoke("admin-update-user", {
      body: { action: "set_tenant_active", user_id: u.id, tenant_id: tid, active },
    });
    const err = (data as any)?.error || error?.message;
    if (err) return toast.error(err);
    loadUsers();
  };
  const resetPassword = async (u: ManagedUser) => {
    const pwd = randomPwd(12);
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { user_id: u.id, password: pwd },
    });
    const err = (data as any)?.error || error?.message;
    if (err) return toast.error(err);
    setCreds({ email: u.email, password: (data as any).password });
    toast.success("Senha redefinida");
  };
  const deleteUser = async (u: ManagedUser) => {
    if (!confirm(`Excluir ${u.email}? Esta ação é permanente.`)) return;
    const { data, error } = await supabase.functions.invoke("admin-delete-user", { body: { user_id: u.id } });
    const err = (data as any)?.error || error?.message;
    if (err) return toast.error(err);
    toast.success("Usuário excluído");
    loadUsers();
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return users.filter((u) => {
      if (s && !u.email?.toLowerCase().includes(s)) return false;
      if (filterRole !== "all" && !u.global_roles.includes(filterRole)) return false;
      return true;
    });
  }, [users, search, filterRole]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-3xl">Gestão de Usuários</h1>
        <p className="text-muted-foreground text-sm">
          Crie contas direto (sem verificação de e-mail), atribua papéis globais e vincule às clínicas.
        </p>
      </div>

      {creds && <CredentialBox {...creds} onClose={() => setCreds(null)} />}

      <Tabs defaultValue="create">
        <TabsList>
          <TabsTrigger value="create"><UserPlus className="w-4 h-4 mr-2" /> Criar usuário</TabsTrigger>
          <TabsTrigger value="manage"><ShieldCheck className="w-4 h-4 mr-2" /> Gerenciar ({users.length})</TabsTrigger>
        </TabsList>

        {/* CREATE */}
        <TabsContent value="create">
          <Card>
            <CardHeader><CardTitle>Novo usuário</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>E-mail</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@empresa.com" />
              </div>
              <div className="space-y-1">
                <Label>Senha</Label>
                <div className="flex gap-2">
                  <Input value={password} onChange={(e) => setPassword(e.target.value)} />
                  <Button variant="outline" onClick={() => setPassword(randomPwd(12))} title="Gerar aleatória"><RefreshCw className="w-4 h-4" /></Button>
                  <Button variant="outline" onClick={() => { navigator.clipboard.writeText(password); toast.success("Copiado"); }}><Copy className="w-4 h-4" /></Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Papel global</Label>
                <Select value={globalRole} onValueChange={setGlobalRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{GLOBAL_ROLES.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {tenantBound && (
                <>
                  <div className="space-y-1">
                    <Label>Clínica</Label>
                    <Select value={tenantId} onValueChange={setTenantId}>
                      <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                      <SelectContent>{tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {globalRole === "admin_tenant" && (
                    <div className="space-y-1">
                      <Label>Cargo interno</Label>
                      <Select value={tenantRole} onValueChange={setTenantRole}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{TENANT_ROLES.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}
              <div className="md:col-span-2 flex justify-end">
                <Button onClick={submitCreate} disabled={submitting} className="gap-2">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  Criar usuário
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* MANAGE */}
        <TabsContent value="manage">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 max-w-2xl">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Buscar por e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={filterRole} onValueChange={setFilterRole}>
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os papéis</SelectItem>
                    {GLOBAL_ROLES.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="ghost" size="sm" onClick={loadUsers} className="gap-2">
                <RefreshCw className="w-4 h-4" /> Atualizar
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>E-mail</TableHead>
                      <TableHead className="w-56">Papel global</TableHead>
                      <TableHead>Clínicas vinculadas</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum usuário</TableCell></TableRow>
                    )}
                    {filtered.map((u) => {
                      const primaryRole = u.global_roles[0] || "user";
                      return (
                        <TableRow key={u.id}>
                          <TableCell>
                            <div className="font-medium">{u.email}</div>
                            <div className="text-xs text-muted-foreground font-mono">{u.id.slice(0, 8)}…</div>
                          </TableCell>
                          <TableCell>
                            <Select value={primaryRole} onValueChange={(v) => setGlobalRoleFor(u, v)}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>{GLOBAL_ROLES.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1.5 items-center">
                              {(primaryRole === "admin" || primaryRole === "comercial_admin_master") && (
                                <Badge className="bg-primary/15 text-primary border-primary/30 gap-1">
                                  <ShieldCheck className="w-3 h-3" /> Conta Admin (Master)
                                </Badge>
                              )}
                              {u.tenants.filter((t) => t.tenant_id !== MASTER_TENANT_ID).map((t) => (
                                <div key={t.tenant_id} className="flex items-center gap-1 rounded-md border border-border bg-muted/40 pl-2 pr-1 py-0.5">
                                  <span className="text-xs font-medium">{t.tenant_name || t.tenant_slug}</span>
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">{t.role}</Badge>
                                  <Switch className="scale-75" checked={t.active} onCheckedChange={(v) => toggleTenantActive(u, t.tenant_id, v)} />
                                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => removeTenantLink(u, t.tenant_id)}>
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              ))}
                              <AddTenantButton user={u} tenants={tenants} onDone={loadUsers} />
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" className="gap-1" onClick={() => resetPassword(u)} title="Redefinir senha">
                                <KeyRound className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={() => deleteUser(u)} title="Excluir">
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AddTenantButton({ user, tenants, onDone }: { user: ManagedUser; tenants: Tenant[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [tid, setTid] = useState("");
  const [role, setRole] = useState("admin");
  const [busy, setBusy] = useState(false);
  const available = tenants.filter((t) => !user.tenants.some((ut) => ut.tenant_id === t.id));

  const submit = async () => {
    if (!tid) return toast.error("Selecione uma clínica");
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-update-user", {
      body: { action: "upsert_tenant", user_id: user.id, tenant_id: tid, tenant_role: role, active: true },
    });
    setBusy(false);
    const err = (data as any)?.error || error?.message;
    if (err) return toast.error(err);
    toast.success("Clínica vinculada");
    setOpen(false); setTid(""); onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-6 gap-1 text-xs" disabled={available.length === 0}>
          <Plus className="w-3 h-3" /> Clínica
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Vincular clínica a {user.email}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Clínica</Label>
            <Select value={tid} onValueChange={setTid}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>{available.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Cargo interno</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TENANT_ROLES.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
