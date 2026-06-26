import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Activity, CheckCircle2, XCircle, Loader2, RefreshCw, AlertTriangle,
  Smartphone, Search, ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";

type Tenant = { id: string; name: string; slug: string; status: string };
type Conn = {
  id: string;
  tenant_id: string;
  provider: string | null;
  instance_url: string | null;
  instance_name: string | null;
  api_key: string | null;
  status: string | null;
  updated_at: string | null;
};

type Row = {
  tenant: Tenant;
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

  const load = async () => {
    setLoading(true);
    const [{ data: tenants }, { data: conns }] = await Promise.all([
      supabase.from("tenants").select("id,name,slug,status").order("name"),
      supabase.from("zapi_connections")
        .select("id,tenant_id,provider,instance_url,instance_name,api_key,status,updated_at")
        .order("updated_at", { ascending: false }),
    ]);

    const byTenant = new Map<string, Conn>();
    (conns || []).forEach((c: any) => {
      if (c.tenant_id && !byTenant.has(c.tenant_id)) byTenant.set(c.tenant_id, c);
    });

    setRows((tenants || []).map((t: any) => ({
      tenant: t,
      conn: byTenant.get(t.id) || null,
      testing: false,
      lastTestedAt: null,
      lastError: null,
      lastState: null,
    })));
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
      if (error || data?.error) throw new Error(data?.error || data?.detail?.message || error?.message || "Falha na consulta");
      setRows(prev => prev.map((r, i) => i === idx ? {
        ...r,
        testing: false,
        lastTestedAt: new Date().toISOString(),
        lastState: data?.state || data?.status || null,
        lastError: null,
        conn: r.conn ? { ...r.conn, status: data?.status || r.conn.status, updated_at: new Date().toISOString() } : r.conn,
      } : r));
    } catch (e: any) {
      setRows(prev => prev.map((r, i) => i === idx ? {
        ...r, testing: false, lastError: e.message || "Erro", lastTestedAt: new Date().toISOString(),
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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.tenant.name.toLowerCase().includes(q) ||
      r.tenant.slug.toLowerCase().includes(q) ||
      (r.conn?.instance_name || "").toLowerCase().includes(q)
    );
  }, [rows, filter]);

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

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80 mb-1">Operação</p>
          <h1 className="text-3xl font-bold tracking-tight font-display flex items-center gap-2">
            <Activity className="w-7 h-7 text-primary" /> Status do WhatsApp por cliente
          </h1>
          <p className="text-muted-foreground">Teste a conexão Evolution de cada tenant e veja a última atualização e erros detectados.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Recarregar
          </Button>
          <Button onClick={testAll} disabled={bulkTesting || loading} className="gap-2">
            {bulkTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
            Testar todos
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Tenants", value: totals.total, cls: "text-foreground" },
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

      <Card className="card-elevated">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2"><Smartphone className="w-4 h-4 text-primary" /> Conexões</CardTitle>
              <CardDescription>Resultado individual do teste de status na Evolution API.</CardDescription>
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
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">Nenhum tenant encontrado.</p>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((r, idx) => {
                const realIdx = rows.indexOf(r);
                return (
                  <div key={r.tenant.id} className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr_1.4fr_auto] gap-3 items-center px-4 md:px-6 py-4 hover:bg-muted/30 transition">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{r.tenant.name}</p>
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
                      <Button asChild size="sm" variant="ghost" className="gap-1" title="Abrir configuração do tenant">
                        <Link to={`/app/${r.tenant.slug}/config`}>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </Button>
                      <Button size="sm" onClick={() => test(realIdx)} disabled={r.testing || !r.conn?.instance_name} className="gap-1">
                        {r.testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                        Testar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
