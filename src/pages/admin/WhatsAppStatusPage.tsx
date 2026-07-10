import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Activity, CheckCircle2, XCircle, Loader2, RefreshCw, AlertTriangle,
  Smartphone, Search, ExternalLink, Crown, Users, DownloadCloud,
} from "lucide-react";
import { Link } from "react-router-dom";

type Tenant = { id: string; name: string; slug: string; status: string };
type Conn = {
  id: string;
  tenant_id: string | null;
  provider: string | null;
  instance_url: string | null;
  instance_name: string | null;
  api_key: string | null;
  status: string | null;
  updated_at: string | null;
};

type Row = {
  isMaster: boolean;
  tenant: { id: string | null; name: string; slug: string };
  conn: Conn | null;
  testing: boolean;
  lastTestedAt: string | null;
  lastError: string | null;
  lastState: string | null;
};

const statusBadge = (s: string | null) => {
  const v = (s || "").toLowerCase();
  if (v === "connected" || v === "open")
    return <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />Conectado</Badge>;
  if (v === "connecting" || v === "pending")
    return <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Conectando</Badge>;
  if (v === "error" || v === "timeout")
    return <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30"><AlertTriangle className="w-3 h-3 mr-1" />Erro</Badge>;
  if (!s || v === "disconnected" || v === "closed")
    return <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/30"><XCircle className="w-3 h-3 mr-1" />Desconectado</Badge>;
  return <Badge variant="outline">{s}</Badge>;
};

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export default function WhatsAppStatusPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("");
  const [bulkTesting, setBulkTesting] = useState(false);

  // Import dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [importRow, setImportRow] = useState<Row | null>(null);
  const [importRunning, setImportRunning] = useState(false);
  const [optCreateLeads, setOptCreateLeads] = useState(true);
  const [optSyncChats, setOptSyncChats] = useState(true);
  const [optWithPictures, setOptWithPictures] = useState(true);
  const [optSyncMessages, setOptSyncMessages] = useState(true);
  const [optMsgLimit, setOptMsgLimit] = useState(50);
  const [optMaxChats, setOptMaxChats] = useState(500);
  const [importResult, setImportResult] = useState<string | null>(null);

  const openImportFor = (r: Row) => {
    setImportRow(r);
    setImportResult(null);
    setImportOpen(true);
  };

  const runImport = async () => {
    if (!importRow) return;
    const tenantId = importRow.tenant.id;
    setImportRunning(true);
    setImportResult(null);
    let summary: string[] = [];
    try {
      if (optCreateLeads) {
        toast.info("Importando contatos como leads…");
        const { data, error } = await supabase.functions.invoke("evolution-import-leads", {
          body: { tenant_id: tenantId },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        summary.push(`${data.created} leads criados, ${data.updated} atualizados, ${data.skipped} já existiam (${data.total_contacts} contatos vistos)`);
      }

      let syncedConversationIds: string[] = [];
      if (optSyncChats) {
        toast.info("Sincronizando conversas abertas…");
        const { data, error } = await supabase.functions.invoke("evolution-sync-chats", {
          body: { tenant_id: tenantId, with_pictures: optWithPictures },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        summary.push(`${data.upserted ?? 0} conversas sincronizadas`);

        // Fetch the conversation IDs so we can pull messages for them
        if (optSyncMessages) {
          let convQ = supabase.from("conversations").select("id").order("ultima_interacao", { ascending: false }).limit(optMaxChats);
          convQ = tenantId ? convQ.eq("tenant_id", tenantId) : convQ.is("tenant_id", null);
          const { data: convs } = await convQ;
          syncedConversationIds = (convs ?? []).map((c: any) => c.id);
        }
      }

      if (optSyncMessages && syncedConversationIds.length > 0) {
        toast.info(`Baixando últimas ${optMsgLimit} mensagens de ${syncedConversationIds.length} conversas…`);
        let ok = 0, fail = 0, totalReplayed = 0;
        for (const cid of syncedConversationIds) {
          try {
            const { data, error } = await supabase.functions.invoke("evolution-sync-messages", {
              body: { conversation_id: cid, limit: optMsgLimit },
            });
            if (error || data?.error) fail++;
            else { ok++; totalReplayed += Number(data?.replayed ?? 0); }
          } catch { fail++; }
        }
        summary.push(`${totalReplayed} mensagens replayadas em ${ok} conversas (${fail} falhas)`);
      }

      const msg = summary.join(" · ");
      setImportResult(msg);
      toast.success("Importação concluída", { description: msg });
    } catch (e: any) {
      setImportResult(`Erro: ${e.message}`);
      toast.error("Falha na importação", { description: e.message });
    } finally {
      setImportRunning(false);
    }
  };

  const load = async () => {
    setLoading(true);
    const [{ data: tenants }, { data: conns }] = await Promise.all([
      supabase.from("tenants").select("id,name,slug,status").order("name"),
      supabase.from("zapi_connections")
        .select("id,tenant_id,provider,instance_url,instance_name,api_key,status,updated_at")
        .order("updated_at", { ascending: false }),
    ]);

    // Master = most recent connection with tenant_id IS NULL
    const masterConn = (conns || []).find((c: any) => !c.tenant_id) || null;

    const byTenant = new Map<string, Conn>();
    (conns || []).forEach((c: any) => {
      if (c.tenant_id && !byTenant.has(c.tenant_id)) byTenant.set(c.tenant_id, c);
    });

    const masterRow: Row = {
      isMaster: true,
      tenant: { id: null, name: "POSION Master", slug: "admin" },
      conn: masterConn,
      testing: false, lastTestedAt: null, lastError: null, lastState: null,
    };

    const tenantRows: Row[] = (tenants || []).map((t: any) => ({
      isMaster: false,
      tenant: { id: t.id, name: t.name, slug: t.slug },
      conn: byTenant.get(t.id) || null,
      testing: false, lastTestedAt: null, lastError: null, lastState: null,
    }));

    setRows([masterRow, ...tenantRows]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const test = async (idx: number) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, testing: true, lastError: null } : r));
    const row = rows[idx];
    if (!row?.conn || !row.conn.instance_name) {
      setRows(prev => prev.map((r, i) => i === idx ? {
        ...r, testing: false, lastError: "Sem instância configurada", lastTestedAt: new Date().toISOString(),
      } : r));
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("evolution-status", {
        body: {
          connection_id: row.conn.id,
          instance_name: row.conn.instance_name,
          tenant_id: row.tenant.id,
        },
      });
      const nextStatus = data?.status || "disconnected";
      setRows(prev => prev.map((r, i) => i === idx ? {
        ...r,
        testing: false,
        lastTestedAt: new Date().toISOString(),
        lastState: data?.state || nextStatus,
        lastError: error?.message || data?.error || null,
        conn: r.conn ? { ...r.conn, status: nextStatus, updated_at: new Date().toISOString() } : r.conn,
      } : r));
    } catch (e: any) {
      setRows(prev => prev.map((r, i) => i === idx ? {
        ...r,
        testing: false,
        lastError: e.message || "Erro",
        lastTestedAt: new Date().toISOString(),
        conn: r.conn ? { ...r.conn, status: "disconnected", updated_at: new Date().toISOString() } : r.conn,
      } : r));
    }
  };

  const testAll = async () => {
    setBulkTesting(true);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].conn?.instance_name) {
        // eslint-disable-next-line no-await-in-loop
        await test(i);
      }
    }
    setBulkTesting(false);
    toast.success("Teste em lote concluído");
  };

  const masterRow = rows[0];
  const tenantRows = rows.slice(1);

  const filteredTenants = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tenantRows;
    return tenantRows.filter(r =>
      r.tenant.name.toLowerCase().includes(q) ||
      r.tenant.slug.toLowerCase().includes(q) ||
      (r.conn?.instance_name || "").toLowerCase().includes(q)
    );
  }, [tenantRows, filter]);

  const totals = useMemo(() => {
    const t = { total: rows.length, connected: 0, disconnected: 0, missing: 0, errors: 0 };
    rows.forEach(r => {
      if (!r.conn) t.missing++;
      else {
        const s = (r.conn.status || "").toLowerCase();
        if (s === "connected" || s === "open") t.connected++;
        else t.disconnected++;
      }
      if (r.lastError) t.errors++;
    });
    return t;
  }, [rows]);

  // Duplicate instance detection: same instance_name used by 2+ rows.
  const duplicates = useMemo(() => {
    const map = new Map<string, Row[]>();
    rows.forEach(r => {
      const name = (r.conn?.instance_name || "").trim().toLowerCase();
      if (!name) return;
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(r);
    });
    return Array.from(map.entries())
      .filter(([, list]) => list.length > 1)
      .map(([name, list]) => ({ name, owners: list }));
  }, [rows]);

  const renderRow = (r: Row, realIdx: number) => (
    <div key={`${r.isMaster ? "master" : r.tenant.id}`} className={`grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr_1.4fr_auto] gap-3 items-center px-4 md:px-6 py-4 transition ${r.isMaster ? "bg-gradient-to-r from-amber-500/5 via-transparent to-violet-500/5" : "hover:bg-muted/30"}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {r.isMaster && <Crown className="w-4 h-4 text-amber-400 shrink-0" />}
          <p className="font-medium truncate">{r.tenant.name}</p>
          {r.isMaster && <Badge className="bg-gradient-to-r from-amber-500/20 to-violet-500/20 text-amber-300 border-amber-500/40 text-[10px]">MASTER</Badge>}
        </div>
        <p className="text-xs text-muted-foreground truncate">/{r.tenant.slug}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Instância</p>
        {r.conn ? (
          <>
            <p className="text-sm font-mono truncate">{r.conn.instance_name || "—"}</p>
            <p className="text-[11px] text-muted-foreground truncate">{r.conn.provider || "evolution"} · {r.conn.instance_url || "sem URL"}</p>
          </>
        ) : (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">Não configurado</Badge>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Status</p>
        {statusBadge(r.conn?.status || null)}
        <p className="text-[11px] text-muted-foreground mt-1">Atualizado: {fmtDate(r.conn?.updated_at || null)}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Último teste</p>
        <p className="text-sm">
          {r.lastTestedAt ? fmtDate(r.lastTestedAt) : "—"}
          {r.lastState && <span className="ml-2 text-xs text-muted-foreground">({r.lastState})</span>}
        </p>
        {r.lastError && (
          <p className="text-xs text-rose-400 flex items-center gap-1 mt-1 truncate" title={r.lastError}>
            <AlertTriangle className="w-3 h-3 shrink-0" />{r.lastError}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 justify-end">
        {!r.isMaster && (
          <Button asChild size="sm" variant="ghost" className="gap-1" title="Abrir configuração do tenant">
            <Link to={`/app/${r.tenant.slug}/config`}>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </Button>
        )}
        <Button size="sm" onClick={() => test(realIdx)} disabled={r.testing || !r.conn?.instance_name} className="gap-1">
          {r.testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
          Testar
        </Button>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80 mb-1">Operação</p>
          <h1 className="text-3xl font-bold tracking-tight font-display flex items-center gap-2">
            <Activity className="w-7 h-7 text-primary" /> Status do WhatsApp por conta
          </h1>
          <p className="text-muted-foreground">Conta Master + todos os clientes. Teste a conexão Evolution e veja erros detectados por instância.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Recarregar
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={async () => {
              toast.info("Reassinando eventos em todas as instâncias…");
              const { data, error } = await supabase.functions.invoke("evolution-resubscribe", { body: {} });
              if (error) return toast.error("Falha ao reassinar", { description: error.message });
              const ok = (data?.results ?? []).filter((r: any) => r.ok).length;
              const total = data?.count ?? 0;
              toast.success(`Eventos reassinados: ${ok}/${total}`, {
                description: "Mensagens enviadas de outros aparelhos vão aparecer no inbox.",
              });
              load();
            }}
          >
            <Smartphone className="w-4 h-4" /> Reassinar eventos (bidirecional)
          </Button>
          <Button onClick={testAll} disabled={bulkTesting || loading} className="gap-2">
            {bulkTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
            Testar todos
          </Button>
        </div>

      </div>

      {/* KPIs (incluem master) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: `Contas (1+${tenantRows.length})`, value: totals.total, cls: "text-foreground" },
          { label: "Conectados", value: totals.connected, cls: "text-emerald-400" },
          { label: "Desconectados", value: totals.disconnected, cls: "text-rose-400" },
          { label: "Sem instância", value: totals.missing, cls: "text-amber-400" },
          { label: "Com erro no teste", value: totals.errors, cls: "text-rose-400" },
        ].map((k) => (
          <Card key={k.label} className="card-elevated">
            <CardContent className="p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{k.label}</p>
              <p className={`text-2xl font-display ${k.cls}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Alertas de duplicidade */}
      {duplicates.length > 0 && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-rose-400 text-base">
              <AlertTriangle className="w-4 h-4" /> Instância duplicada detectada
            </CardTitle>
            <CardDescription className="text-rose-300/80">
              Duas ou mais contas usam a mesma instância — isso mistura conversas e logs. Crie uma instância exclusiva para cada uma.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {duplicates.map(d => (
              <div key={d.name} className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
                <p className="text-sm font-mono text-rose-300">"{d.owners[0].conn?.instance_name}"</p>
                <ul className="mt-1 text-xs text-rose-200/80 list-disc list-inside">
                  {d.owners.map((o, i) => (
                    <li key={i}>{o.isMaster ? "Admin Master (/admin)" : `${o.tenant.name} (/${o.tenant.slug})`}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Conta Master */}
      <Card className="card-elevated border-amber-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-400" /> Conta Master
          </CardTitle>
          <CardDescription>Instância exclusiva do Admin Master — não compartilhe com tenants.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <div className="divide-y divide-border">{renderRow(masterRow, 0)}</div>
          )}
        </CardContent>
      </Card>

      {/* Clientes */}
      <Card className="card-elevated">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> Clientes ({tenantRows.length})</CardTitle>
              <CardDescription>Resultado individual do teste de status na Evolution API por cliente.</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar cliente ou instância" className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : filteredTenants.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">Nenhum cliente encontrado.</p>
          ) : (
            <div className="divide-y divide-border">
              {filteredTenants.map((r) => renderRow(r, rows.indexOf(r)))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
