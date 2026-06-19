import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Play, Pause, Archive, Plus, RefreshCw, Loader2, ChevronRight, DollarSign } from "lucide-react";
import { reconnectFacebook } from "@/lib/facebook-reconnect";

type Campaign = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
};
type AdSet = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
};
type Ad = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
};

const OBJECTIVES = [
  "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS", "OUTCOME_APP_PROMOTION",
];

const BRL = (cents?: string) => {
  if (!cents) return "—";
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "ACTIVE") return "default";
  if (s === "PAUSED") return "secondary";
  if (s === "DELETED" || s === "ARCHIVED") return "outline";
  return "outline";
}

async function call(action: string, params: Record<string, any> = {}, opts?: { didReconnect?: boolean }) {
  let { data, error } = await supabase.functions.invoke("facebook-ads-manage", {
    body: { action, ...params },
  });
  if (error && !data) {
    try {
      const ctx: any = (error as any).context;
      if (ctx && typeof ctx.json === "function") data = await ctx.json();
      else if (ctx && typeof ctx.text === "function") {
        const t = await ctx.text();
        try { data = JSON.parse(t); } catch { data = { error: t }; }
      }
    } catch { /* ignore */ }
  }
  const msg = String(data?.error ?? error?.message ?? "");
  const needsReconnect =
    data?.need_reconnect === true ||
    /token de usuário|ads_read|ads_management|reconecte|nonexisting field \(adaccounts\)/i.test(msg);
  if (needsReconnect && !opts?.didReconnect) {
    toast({ title: "Reconectando com o Facebook…", description: "Conceda ads_read e ads_management." });
    const ok = await reconnectFacebook().catch((e) => {
      toast({ title: "Falha ao reconectar", description: e.message, variant: "destructive" });
      return false;
    });
    if (ok) return call(action, params, { didReconnect: true });
  }
  if (error) throw new Error(msg || error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function MetaAdsManagerPage() {
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [adsets, setAdsets] = useState<AdSet[]>([]);
  const [selectedAdset, setSelectedAdset] = useState<AdSet | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState<{ id: string; name: string; current?: string } | null>(null);
  const [newCamp, setNewCamp] = useState({ name: "", objective: "OUTCOME_LEADS" });
  const [newBudget, setNewBudget] = useState("");

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const r = await call("list_campaigns");
      setCampaigns(r.data ?? []);
    } catch (e: any) {
      toast({ title: "Erro ao listar campanhas", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  const loadAdsets = async (c: Campaign) => {
    setSelectedCampaign(c); setSelectedAdset(null); setAds([]); setAdsets([]);
    try {
      const r = await call("list_adsets", { campaign_id: c.id });
      setAdsets(r.data ?? []);
    } catch (e: any) {
      toast({ title: "Erro ao listar conjuntos", description: e.message, variant: "destructive" });
    }
  };

  const loadAds = async (a: AdSet) => {
    setSelectedAdset(a); setAds([]);
    try {
      const r = await call("list_ads", { adset_id: a.id });
      setAds(r.data ?? []);
    } catch (e: any) {
      toast({ title: "Erro ao listar anúncios", description: e.message, variant: "destructive" });
    }
  };

  const toggleStatus = async (id: string, currentStatus: string, kind: "campaign" | "adset" | "ad") => {
    const next = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setBusy(id);
    try {
      await call("set_status", { object_id: id, status: next });
      toast({ title: next === "ACTIVE" ? "Reativado" : "Pausado", description: id });
      if (kind === "campaign") await loadCampaigns();
      else if (kind === "adset" && selectedCampaign) await loadAdsets(selectedCampaign);
      else if (kind === "ad" && selectedAdset) await loadAds(selectedAdset);
    } catch (e: any) {
      toast({ title: "Falhou", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const archive = async (id: string, kind: "campaign" | "adset" | "ad") => {
    if (!confirm("Arquivar este item? (não exclui, só remove da lista ativa)")) return;
    setBusy(id);
    try {
      await call("set_status", { object_id: id, status: "ARCHIVED" });
      toast({ title: "Arquivado" });
      if (kind === "campaign") await loadCampaigns();
      else if (kind === "adset" && selectedCampaign) await loadAdsets(selectedCampaign);
      else if (kind === "ad" && selectedAdset) await loadAds(selectedAdset);
    } catch (e: any) {
      toast({ title: "Falhou", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const submitCreate = async () => {
    if (!newCamp.name) return;
    setBusy("create");
    try {
      await call("create_campaign", { name: newCamp.name, objective: newCamp.objective, status: "PAUSED" });
      toast({ title: "Campanha criada (pausada)", description: "Configure conjunto e anúncio no Ads Manager." });
      setCreateOpen(false); setNewCamp({ name: "", objective: "OUTCOME_LEADS" });
      await loadCampaigns();
    } catch (e: any) {
      toast({ title: "Falhou ao criar", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const submitBudget = async () => {
    if (!budgetOpen || !newBudget) return;
    const v = Number(newBudget.replace(",", "."));
    if (!isFinite(v) || v <= 0) {
      toast({ title: "Valor inválido", variant: "destructive" }); return;
    }
    setBusy(budgetOpen.id);
    try {
      await call("update_budget", { object_id: budgetOpen.id, daily_budget: v });
      toast({ title: "Orçamento atualizado", description: `R$ ${v.toFixed(2)} / dia` });
      setBudgetOpen(null); setNewBudget("");
      await loadCampaigns();
      if (selectedCampaign) await loadAdsets(selectedCampaign);
    } catch (e: any) {
      toast({ title: "Falhou", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  useEffect(() => { loadCampaigns(); }, []);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gerenciador Meta Ads</h1>
          <p className="text-sm text-muted-foreground">
            Crie, pause e ajuste orçamento de campanhas direto da plataforma.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadCampaigns} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" /> Nova campanha</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Criar campanha</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Nome</Label>
                  <Input value={newCamp.name} onChange={(e) => setNewCamp({ ...newCamp, name: e.target.value })} placeholder="Ex.: Captação Clínicas - SP" />
                </div>
                <div>
                  <Label>Objetivo</Label>
                  <Select value={newCamp.objective} onValueChange={(v) => setNewCamp({ ...newCamp, objective: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OBJECTIVES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">A campanha é criada pausada. Configure conjunto e criativos no Ads Manager antes de ativar.</p>
              </div>
              <DialogFooter>
                <Button onClick={submitCreate} disabled={busy === "create"}>
                  {busy === "create" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Criar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Campanhas</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Carregando…</div>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma campanha encontrada. Verifique a configuração em /admin/facebook.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Objetivo</TableHead>
                  <TableHead>Orçamento/dia</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id} className={selectedCampaign?.id === c.id ? "bg-muted/40" : ""}>
                    <TableCell className="font-medium">
                      <button className="hover:underline text-left flex items-center gap-1" onClick={() => loadAdsets(c)}>
                        {c.name} <ChevronRight className="w-3 h-3" />
                      </button>
                    </TableCell>
                    <TableCell><Badge variant={statusVariant(c.effective_status)}>{c.effective_status}</Badge></TableCell>
                    <TableCell className="text-xs">{c.objective}</TableCell>
                    <TableCell>{BRL(c.daily_budget)}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" disabled={busy === c.id}
                        onClick={() => toggleStatus(c.id, c.status, "campaign")}>
                        {busy === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> :
                          c.status === "ACTIVE" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setBudgetOpen({ id: c.id, name: c.name, current: c.daily_budget }); setNewBudget(c.daily_budget ? (Number(c.daily_budget) / 100).toFixed(2) : ""); }}>
                        <DollarSign className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => archive(c.id, "campaign")}>
                        <Archive className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedCampaign && (
        <Card>
          <CardHeader><CardTitle>Conjuntos de anúncio · {selectedCampaign.name}</CardTitle></CardHeader>
          <CardContent>
            {adsets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum conjunto.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Otimização</TableHead>
                    <TableHead>Orçamento/dia</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adsets.map((a) => (
                    <TableRow key={a.id} className={selectedAdset?.id === a.id ? "bg-muted/40" : ""}>
                      <TableCell>
                        <button className="hover:underline text-left flex items-center gap-1" onClick={() => loadAds(a)}>
                          {a.name} <ChevronRight className="w-3 h-3" />
                        </button>
                      </TableCell>
                      <TableCell><Badge variant={statusVariant(a.effective_status)}>{a.effective_status}</Badge></TableCell>
                      <TableCell className="text-xs">{a.optimization_goal ?? "—"}</TableCell>
                      <TableCell>{BRL(a.daily_budget)}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => toggleStatus(a.id, a.status, "adset")}>
                          {busy === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> :
                            a.status === "ACTIVE" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setBudgetOpen({ id: a.id, name: a.name, current: a.daily_budget }); setNewBudget(a.daily_budget ? (Number(a.daily_budget) / 100).toFixed(2) : ""); }}>
                          <DollarSign className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => archive(a.id, "adset")}>
                          <Archive className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {selectedAdset && (
        <Card>
          <CardHeader><CardTitle>Anúncios · {selectedAdset.name}</CardTitle></CardHeader>
          <CardContent>
            {ads.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum anúncio.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ads.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.name}</TableCell>
                      <TableCell><Badge variant={statusVariant(a.effective_status)}>{a.effective_status}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => toggleStatus(a.id, a.status, "ad")}>
                          {busy === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> :
                            a.status === "ACTIVE" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => archive(a.id, "ad")}>
                          <Archive className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!budgetOpen} onOpenChange={(o) => !o && setBudgetOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Orçamento diário · {budgetOpen?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Novo valor (R$ por dia)</Label>
            <Input type="number" step="0.01" value={newBudget} onChange={(e) => setNewBudget(e.target.value)} placeholder="50.00" />
            <p className="text-xs text-muted-foreground">Atual: {BRL(budgetOpen?.current)}</p>
          </div>
          <DialogFooter>
            <Button onClick={submitBudget} disabled={busy === budgetOpen?.id}>
              {busy === budgetOpen?.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Atualizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
